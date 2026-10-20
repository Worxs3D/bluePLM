/**
 * Synthetic vault for the load-pipeline harness (loadPipeline.alloc.harness.test.ts).
 *
 * Shaped like the real thing as far as it matters for allocation: Windows absolute paths on the
 * local side, forward-slash relative paths, a few thousand folders, ~28k files, server rows with
 * the full `get_vault_files_fast` column set (long hash and description strings, a
 * `custom_properties` object), a few percent cloud-only, a few percent checked out.
 */
import type { CachedServerFile } from '@/lib/cache/vaultFileCache'

export const FIXTURE_VAULT_ROOT = 'C:\\Users\\harness\\BluePLM\\vault'
export const FIXTURE_USER_ID = 'user-harness-0001'

const PROJECT_COUNT = 20
const ASSEMBLIES_PER_PROJECT = 12
const FOLDERS_PER_ASSEMBLY = 10
const CLOUD_ONLY_EVERY = 33
const CHECKED_OUT_EVERY = 40
const EXTENSIONS = ['.sldprt', '.sldasm', '.slddrw', '.pdf', '.step'] as const
const HASH_LENGTH = 64

/** The shape `listWorkingFiles` returns for each entry (see src/electron.d.ts FilesListResult). */
export interface FixtureLocalEntry {
  name: string
  path: string
  relativePath: string
  isDirectory: boolean
  extension: string
  size: number
  modifiedTime: string
  hash?: string
  ino: number
}

export interface SyntheticVault {
  serverRows: CachedServerFile[]
  localEntries: FixtureLocalEntry[]
  folderPaths: string[]
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0')
}

function hex(seed: number): string {
  let out = ''
  let state = seed * 2654435761
  while (out.length < HASH_LENGTH) {
    state = (state * 1103515245 + 12345) >>> 0
    out += state.toString(16).padStart(8, '0')
  }
  return out.slice(0, HASH_LENGTH)
}

export function buildSyntheticVault(fileCount: number): SyntheticVault {
  const folderPaths: string[] = []
  const leafFolders: string[] = []
  for (let p = 0; p < PROJECT_COUNT; p++) {
    const project = `P${pad(p, 2)}`
    folderPaths.push(project)
    for (let a = 0; a < ASSEMBLIES_PER_PROJECT; a++) {
      const assembly = `${project}/Assy-${pad(a, 2)}`
      folderPaths.push(assembly)
      for (let f = 0; f < FOLDERS_PER_ASSEMBLY; f++) {
        const leaf = `${assembly}/Sub-${pad(f, 2)}`
        folderPaths.push(leaf)
        leafFolders.push(leaf)
      }
    }
  }

  const localModified = '2026-10-01T12:00:00.000Z'
  const serverUpdated = '2026-10-10T12:00:00.000Z'
  const serverRows: CachedServerFile[] = []
  const localEntries: FixtureLocalEntry[] = []

  folderPaths.forEach((folderPath, index) => {
    const name = folderPath.slice(folderPath.lastIndexOf('/') + 1)
    localEntries.push({
      name,
      path: `${FIXTURE_VAULT_ROOT}\\${folderPath.replace(/\//g, '\\')}`,
      relativePath: folderPath,
      isDirectory: true,
      extension: '',
      size: 0,
      modifiedTime: localModified,
      ino: 100_000 + index,
    })
  })

  for (let i = 0; i < fileCount; i++) {
    const folder = leafFolders[i % leafFolders.length]
    const extension = EXTENSIONS[i % EXTENSIONS.length]
    const fileName = `BR-${pad(100_000 + i, 6)}-Bracket-Mounting-Plate-Rev-A${extension}`
    const relativePath = `${folder}/${fileName}`
    const checkedOut = i % CHECKED_OUT_EVERY === 0
    const cloudOnly = i % CLOUD_ONLY_EVERY === 1

    serverRows.push({
      id: `00000000-0000-4000-8000-${pad(i, 12)}`,
      file_path: relativePath,
      file_name: fileName,
      extension,
      file_type: extension === '.sldprt' ? 'part' : extension === '.sldasm' ? 'assembly' : 'other',
      part_number: `BR-${pad(100_000 + i, 6)}`,
      description: `Bracket, mounting plate, 6061-T6 aluminium, anodised, item ${i}`,
      revision: 'A',
      version: 1 + (i % 7),
      content_hash: hex(i),
      file_size: 40_000 + (i % 5000),
      state: 'In Work',
      checked_out_by: checkedOut ? (i % 2 === 0 ? FIXTURE_USER_ID : 'user-other-0002') : null,
      checked_out_at: checkedOut ? serverUpdated : null,
      updated_at: serverUpdated,
      custom_properties: {
        Material: '6061-T6',
        Vendor: 'Acme Metals',
        Project: `P${pad(i % PROJECT_COUNT, 2)}`,
        Weight: i % 997,
        Finish: { process: 'anodise', colour: 'clear' },
      },
      checked_out_file_path: checkedOut ? relativePath : null,
      checked_out_file_name: checkedOut ? fileName : null,
    })

    if (cloudOnly) continue
    localEntries.push({
      name: fileName,
      path: `${FIXTURE_VAULT_ROOT}\\${relativePath.replace(/\//g, '\\')}`,
      relativePath,
      isDirectory: false,
      extension,
      size: 40_000 + (i % 5000),
      modifiedTime: localModified,
      ino: 1_000_000 + i,
    })
  }

  return { serverRows, localEntries, folderPaths }
}
