import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

export const MDB_BUNDLE_ROOTS = ['src', 'public', 'migrations'] as const
export const MDB_BUNDLE_MANIFEST_FILE = 'bundle-manifest.json'

export interface MdbBundleManifest {
  version: 1
  digest: string
  fileCount: number
}

export interface MdbBundleEntry {
  relativePath: string
  digest: string
}

/** Hashes a sorted, normalized file identity list; timestamps and absolute paths are excluded. */
export function computeMdbBundleDigest(entries: readonly MdbBundleEntry[]): string {
  const normalized = [...entries]
    .map((entry) => ({
      relativePath: entry.relativePath.replaceAll('\\', '/').replace(/^\/+/, ''),
      digest: entry.digest.toLowerCase(),
    }))
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath))
  const hash = createHash('sha256')
  for (const entry of normalized) hash.update(`${entry.relativePath}\0${entry.digest}\n`, 'utf8')
  return hash.digest('hex')
}

async function collectFiles(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true })
  const files = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(root, entry.name)
    return entry.isDirectory() ? collectFiles(fullPath) : [fullPath]
  }))
  return files.flat()
}

export async function createMdbBundleManifest(bundleRoot: string): Promise<MdbBundleManifest> {
  const entries: MdbBundleEntry[] = []
  for (const folder of MDB_BUNDLE_ROOTS) {
    const folderRoot = path.join(bundleRoot, folder)
    for (const filePath of await collectFiles(folderRoot)) {
      const relativePath = path.relative(bundleRoot, filePath).replaceAll('\\', '/')
      const contents = await fs.readFile(filePath)
      entries.push({
        relativePath,
        digest: createHash('sha256').update(contents).digest('hex'),
      })
    }
  }
  return {
    version: 1,
    digest: computeMdbBundleDigest(entries),
    fileCount: entries.length,
  }
}

export function serializeMdbBundleManifest(manifest: MdbBundleManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`
}
