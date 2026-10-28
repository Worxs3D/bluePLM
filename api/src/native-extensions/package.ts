/**
 * Verify and extract a native extension package (.bpx) for the API.
 *
 * The sha256 recorded by the org admin's install is the authority: bytes that
 * do not hash to it are refused before anything is unzipped. Extraction goes
 * through the one shared extractor (`safeExtract.ts`) into `<root>/<sha256>`,
 * so each version gets its own directory and therefore its own module URL
 * (Node cannot unload an ES module; a new version must be a new file).
 */

import { createHash } from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import JSZip from 'jszip'
import { extractPackageSafely, resolveEntryPath } from './safeExtract.js'

const SHA256_HEX = /^[0-9a-f]{64}$/

export class PackageHashMismatchError extends Error {
  constructor(
    readonly expected: string,
    readonly actual: string,
  ) {
    super(`Package sha256 ${actual} does not match the installed sha256 ${expected}`)
    this.name = 'PackageHashMismatchError'
  }
}

export class InvalidPackageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidPackageError'
  }
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** Normalise a recorded sha256, or throw when it is not one. */
export function normalizeSha256(value: string | null | undefined): string {
  const normalized = (value ?? '').trim().toLowerCase()
  if (!SHA256_HEX.test(normalized)) {
    throw new InvalidPackageError(`Installed package_sha256 is not a sha256: ${JSON.stringify(value ?? null)}`)
  }
  return normalized
}

/** Throw unless `bytes` hash to `expectedSha256`. */
export function verifyPackageBytes(bytes: Uint8Array, expectedSha256: string): void {
  const expected = normalizeSha256(expectedSha256)
  const actual = sha256Hex(bytes)
  if (actual !== expected) throw new PackageHashMismatchError(expected, actual)
}

export interface ExtractedPackage {
  dir: string
  manifest: PackageManifest
  /** Absolute path of the server entry module. */
  serverEntry: string
}

export interface PackageManifest {
  id: string
  version?: string
  category?: string
  serverMain?: string
}

function readManifest(dir: string): PackageManifest {
  const file = path.join(dir, 'extension.json')
  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf-8'))
  } catch (err) {
    throw new InvalidPackageError(
      `Package has no readable extension.json: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  if (!parsed || typeof parsed !== 'object') throw new InvalidPackageError('extension.json is not an object')
  const record = parsed as Record<string, unknown>
  if (typeof record.id !== 'string' || record.id.length === 0) {
    throw new InvalidPackageError('extension.json has no id')
  }
  return {
    id: record.id,
    version: typeof record.version === 'string' ? record.version : undefined,
    category: typeof record.category === 'string' ? record.category : undefined,
    serverMain: typeof record.serverMain === 'string' ? record.serverMain : undefined,
  }
}

/**
 * Make `.js` files under the extraction root load as ES modules.
 *
 * Packages carry no package.json; without one Node would decide the module
 * type from the nearest package.json above the directory, which is not ours to
 * rely on. Written every time (never trusted from an earlier run). A package
 * that ships its own package.json still governs its own files, since the
 * nearest one wins.
 */
function ensureModuleRoot(root: string): void {
  fs.mkdirSync(root, { recursive: true, mode: 0o700 })
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ type: 'module', private: true }) + '\n',
  )
}

/**
 * Verify `bytes` against `expectedSha256`, extract them to `<root>/<sha256>`
 * and check the manifest belongs to `expectedId` and names a server entry.
 */
export async function verifyAndExtractPackage(
  bytes: Uint8Array,
  expectedSha256: string,
  expectedId: string,
  root: string,
): Promise<ExtractedPackage> {
  verifyPackageBytes(bytes, expectedSha256)
  const sha = normalizeSha256(expectedSha256)

  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(bytes)
  } catch (err) {
    throw new InvalidPackageError(`Package is not a valid zip: ${err instanceof Error ? err.message : String(err)}`)
  }

  ensureModuleRoot(root)
  const dir = path.join(path.resolve(root), sha)
  await extractPackageSafely(zip, dir)

  const manifest = readManifest(dir)
  if (manifest.id !== expectedId) {
    throw new InvalidPackageError(`Package id '${manifest.id}' does not match installed id '${expectedId}'`)
  }
  if (manifest.category !== 'native') {
    throw new InvalidPackageError(`Package '${manifest.id}' is not a native extension`)
  }
  if (!manifest.serverMain) {
    throw new InvalidPackageError(`Package '${manifest.id}' has no serverMain`)
  }
  const serverEntry = resolveEntryPath(dir, manifest.serverMain)
  if (!fs.existsSync(serverEntry)) {
    throw new InvalidPackageError(`Package '${manifest.id}' has no ${manifest.serverMain}`)
  }
  return { dir, manifest, serverEntry }
}
