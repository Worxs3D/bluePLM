/**
 * Native extension packages on the desktop: verify, extract, cache, prune, serve.
 *
 * Trust model (.cursor/plans/extensions-native-runtime.plan.md): native code runs
 * with full renderer trust, so it runs only from a package whose bytes match the
 * SHA-256 an org admin recorded in `org_installed_extensions.package_sha256`.
 * Everything here is keyed by that hash:
 *
 *   <cacheDir>/<sha256>.bpx   the downloaded package, re-hashed on every prepare
 *   <cacheDir>/<sha256>/      the extracted package (safe extractor, staged + renamed)
 *
 * Kept free of Electron imports so it can be unit tested; native.ts wires it to
 * IPC and the `blueplm-ext://` protocol.
 */

import * as fs from 'fs'
import * as path from 'path'
import JSZip from 'jszip'

import { extractPackageSafely, resolveEntryPath, validatePackageEntries } from './safeExtract'
import { matchesSha256, normalizeSha256, sha256Hex } from './integrity'
import {
  isValidExtensionId,
  isValidExtensionVersion,
  parseExtensionManifest,
  type ExtensionManifest,
} from './validation'

export const NATIVE_EXTENSION_SCHEME = 'blueplm-ext'

/** Written into an extracted folder once it is complete; its absence means "re-extract". */
const VERIFIED_MARKER = '.blueplm-verified'

export interface PrepareNativeRequest {
  extensionId: string
  version: string
  sha256: string
}

export interface PreparedNativePackage {
  sha256: string
  dir: string
  manifest: ExtensionManifest
  /** `blueplm-ext://<sha256>/` */
  baseUrl: string
  /** Absolute URL of the client entry (`manifest.main`). */
  clientEntryUrl: string
  /** True when the package came from the cache rather than a download. */
  cached: boolean
}

/**
 * Check a native manifest against the row it was installed for. Throws with a
 * message fit for the extension's error line.
 */
export function assertNativeManifest(
  manifest: ExtensionManifest,
  expected?: { extensionId: string; version: string },
): void {
  if (manifest.category !== 'native') {
    throw new Error(`Package ${manifest.id} is not a native extension (category must be "native")`)
  }
  if (expected && manifest.id !== expected.extensionId) {
    throw new Error(`Package id ${manifest.id} does not match the installed extension ${expected.extensionId}`)
  }
  if (expected && manifest.version !== expected.version) {
    throw new Error(
      `Package version ${manifest.version} does not match the installed version ${expected.version}`,
    )
  }
  if (typeof manifest.main !== 'string' || manifest.main.length === 0) {
    throw new Error('Native extension manifest has no "main" (client entry)')
  }
  // The entry must be a plain relative path inside the package.
  resolveEntryPath('/', manifest.main)
}

function validateRequest(request: PrepareNativeRequest): string {
  if (!isValidExtensionId(request.extensionId)) {
    throw new Error(`Invalid extension id: ${JSON.stringify(request.extensionId)}`)
  }
  if (!isValidExtensionVersion(request.version)) {
    throw new Error(`Invalid extension version: ${JSON.stringify(request.version)}`)
  }
  const sha = normalizeSha256(request.sha256)
  if (!sha) throw new Error('Invalid package SHA-256')
  return sha
}

function readManifestFromDir(dir: string): ExtensionManifest {
  return parseExtensionManifest(fs.readFileSync(path.join(dir, 'extension.json'), 'utf-8'))
}

function buildPrepared(
  sha: string,
  dir: string,
  manifest: ExtensionManifest,
  cached: boolean,
): PreparedNativePackage {
  const baseUrl = `${NATIVE_EXTENSION_SCHEME}://${sha}/`
  const main = (manifest.main as string).replace(/\\/g, '/').replace(/^\.\//, '')
  return { sha256: sha, dir, manifest, baseUrl, clientEntryUrl: baseUrl + main, cached }
}

/**
 * Make a package ready to run: reuse the cached copy when its bytes still hash to
 * `sha256`, otherwise download, verify and extract. Refuses on any mismatch.
 */
export async function prepareNativePackage(
  cacheDir: string,
  request: PrepareNativeRequest,
  download: () => Promise<Uint8Array>,
): Promise<PreparedNativePackage> {
  const sha = validateRequest(request)
  fs.mkdirSync(cacheDir, { recursive: true })
  const bpxPath = path.join(cacheDir, `${sha}.bpx`)
  const dir = path.join(cacheDir, sha)

  let data: Uint8Array | null = null
  let cached = false
  if (fs.existsSync(bpxPath)) {
    const onDisk = fs.readFileSync(bpxPath)
    if (matchesSha256(onDisk, sha)) {
      data = onDisk
      cached = true
    } else {
      // A cached copy that no longer matches is discarded, never used.
      fs.rmSync(bpxPath, { force: true })
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }

  if (!data) {
    const downloaded = await download()
    if (!matchesSha256(downloaded, sha)) {
      throw new Error(
        `Package for ${request.extensionId} does not match the SHA-256 recorded at install (got ${sha256Hex(downloaded)})`,
      )
    }
    data = downloaded
    const tmp = `${bpxPath}.${process.pid}.tmp`
    fs.writeFileSync(tmp, data)
    fs.renameSync(tmp, bpxPath)
  }

  if (cached && fs.existsSync(path.join(dir, VERIFIED_MARKER))) {
    const manifest = readManifestFromDir(dir)
    assertNativeManifest(manifest, request)
    return buildPrepared(sha, dir, manifest, true)
  }

  const zip = await JSZip.loadAsync(data)
  const manifestFile = zip.file('extension.json')
  if (!manifestFile) throw new Error('Invalid extension package: missing extension.json')
  const manifest = parseExtensionManifest(await manifestFile.async('string'))
  assertNativeManifest(manifest, request)

  await extractPackageSafely(zip, dir, {
    beforeCommit: (staging) => {
      fs.writeFileSync(path.join(staging, VERIFIED_MARKER), sha)
    },
  })
  return buildPrepared(sha, dir, manifest, cached)
}

/**
 * Remove every cached package and extracted folder whose hash is not in `keep`.
 * Returns the hashes removed. Anything that is not a hash-named entry is left alone.
 */
export function pruneNativeCache(cacheDir: string, keep: Iterable<string>): string[] {
  if (!fs.existsSync(cacheDir)) return []
  const keepSet = new Set<string>()
  for (const k of keep) {
    const n = normalizeSha256(k)
    if (n) keepSet.add(n)
  }
  const removed = new Set<string>()
  for (const entry of fs.readdirSync(cacheDir)) {
    const match = /^([0-9a-f]{64})(\.bpx)?$/.exec(entry)
    const staging = /^\.([0-9a-f]{64})\.(staging|previous)-/.exec(entry)
    const sha = match?.[1] ?? staging?.[1]
    if (!sha || keepSet.has(sha)) continue
    fs.rmSync(path.join(cacheDir, entry), { recursive: true, force: true })
    removed.add(sha)
  }
  return [...removed]
}

// ─── blueplm-ext:// ──────────────────────────────────────────────────────────

const MIME_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
}

export type AssetResolution =
  | { ok: true; filePath: string; mimeType: string }
  | { ok: false; status: 400 | 403 | 404 }

/**
 * Map a `blueplm-ext://<sha256>/<path>` URL to a file. Serves only from folders
 * prepared (verified) in this session, only regular files inside them, and never
 * the cache's own marker or package files.
 */
export function resolveNativeAsset(
  cacheDir: string,
  verifiedShas: ReadonlySet<string>,
  requestUrl: string,
): AssetResolution {
  let url: URL
  try {
    url = new URL(requestUrl)
  } catch {
    return { ok: false, status: 400 }
  }
  if (url.protocol !== `${NATIVE_EXTENSION_SCHEME}:`) return { ok: false, status: 400 }
  const sha = normalizeSha256(url.hostname)
  if (!sha || sha !== url.hostname) return { ok: false, status: 400 }
  if (!verifiedShas.has(sha)) return { ok: false, status: 403 }

  let relative: string
  try {
    relative = decodeURIComponent(url.pathname).replace(/^\/+/, '')
  } catch {
    return { ok: false, status: 400 }
  }
  if (relative.length === 0 || relative === VERIFIED_MARKER) return { ok: false, status: 404 }

  const root = path.join(cacheDir, sha)
  let filePath: string
  try {
    filePath = resolveEntryPath(root, relative)
  } catch {
    return { ok: false, status: 403 }
  }

  let stat: fs.Stats
  try {
    stat = fs.lstatSync(filePath)
  } catch {
    return { ok: false, status: 404 }
  }
  if (!stat.isFile()) return { ok: false, status: 404 }

  const mimeType = MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream'
  return { ok: true, filePath, mimeType }
}

// ─── Admin upload: inspect a .bpx before it is uploaded ──────────────────────

export interface InspectedNativePackage {
  manifest: ExtensionManifest
  sha256: string
  size: number
  /** `sql/*.sql` files, in name order, for the admin to apply in the SQL editor. */
  sqlFiles: Array<{ name: string; content: string }>
  /** The package bytes, so the renderer uploads exactly what was inspected. */
  data: Uint8Array
}

/**
 * Minimal semver range check for `engines.blueplm`: `*`, `x.y.z`, `^x.y.z`,
 * `~x.y.z`, `>=x.y.z`, and space-separated combinations of those (all must hold).
 * Prerelease tags are ignored.
 */
export function satisfiesEngineRange(range: string, version: string): boolean {
  const parse = (v: string): [number, number, number] | null => {
    const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v.trim())
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
  }
  const cmp = (a: [number, number, number], b: [number, number, number]): number =>
    a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
  const current = parse(version)
  if (!current) return false
  const parts = range.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return false
  return parts.every((part) => {
    if (part === '*' || part === 'x') return true
    const op = /^(\^|~|>=|<=|>|<|=)?(.*)$/.exec(part)
    const target = op ? parse(op[2]) : null
    if (!op || !target) return false
    const c = cmp(current, target)
    switch (op[1]) {
      case '^':
        if (c < 0) return false
        if (target[0] > 0) return current[0] === target[0]
        if (target[1] > 0) return current[0] === 0 && current[1] === target[1]
        return current[0] === 0 && current[1] === 0 && current[2] === target[2]
      case '~':
        return c >= 0 && current[0] === target[0] && current[1] === target[1]
      case '>=':
        return c >= 0
      case '>':
        return c > 0
      case '<=':
        return c <= 0
      case '<':
        return c < 0
      default:
        return c === 0
    }
  })
}

/** Read and validate a native package an admin picked. Throws with a user-facing reason. */
export async function inspectNativePackage(
  data: Uint8Array,
  appVersion: string,
): Promise<InspectedNativePackage> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(data)
  } catch {
    throw new Error('Not a valid extension package (.bpx is a zip archive)')
  }
  validatePackageEntries(zip)
  const manifestFile = zip.file('extension.json')
  if (!manifestFile) throw new Error('Invalid extension package: missing extension.json')
  const manifest = parseExtensionManifest(await manifestFile.async('string'))
  assertNativeManifest(manifest)
  if (!zip.file((manifest.main as string).replace(/^\.\//, ''))) {
    throw new Error(`Package is missing its client entry ${String(manifest.main)}`)
  }
  if (typeof manifest.serverMain === 'string' && !zip.file(manifest.serverMain.replace(/^\.\//, ''))) {
    throw new Error(`Package is missing its server entry ${manifest.serverMain}`)
  }
  const engines = manifest.engines as { blueplm?: unknown } | undefined
  const range = typeof engines?.blueplm === 'string' ? engines.blueplm : null
  if (!range) throw new Error('Manifest has no engines.blueplm range')
  if (!satisfiesEngineRange(range, appVersion)) {
    throw new Error(`Extension requires BluePLM ${range}; this is ${appVersion}`)
  }

  const sqlFiles: Array<{ name: string; content: string }> = []
  for (const entry of Object.values(zip.files)) {
    if (entry.dir || !/^sql\/[^/]+\.sql$/i.test(entry.name)) continue
    sqlFiles.push({ name: entry.name, content: await entry.async('string') })
  }
  sqlFiles.sort((a, b) => a.name.localeCompare(b.name))

  return { manifest, sha256: sha256Hex(data), size: data.byteLength, sqlFiles, data }
}
