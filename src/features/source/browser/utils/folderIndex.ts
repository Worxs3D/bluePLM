/**
 * Direct children of a folder, from an index built once per `files` array.
 *
 * `getFilesInFolder` answers "what is in this folder?" by scanning every row: normalise the
 * separators, split the path, lowercase each part, compare. On a 29k-row vault that was ~240 ms
 * per call (`getFilesInFolderMs` in the session logs), paid again for every navigation click and
 * every realtime store update. The index groups the rows by lower-cased parent folder in one pass
 * and answers each folder from a map lookup. It is built on the second lookup against the same
 * array (see `stateByFiles`); the first is the plain scan.
 *
 * The result is the same rows in the same order as `getFilesInFolder` for any row that has a
 * relative path (the tests compare them on a mixed fixture). Rows without a string path are never
 * indexed: the caller filters invalid rows anyway.
 */
import type { LocalFile } from '@/stores/pdmStore'

import { getFilesInFolder } from './filtering'

/** Key under which top-level rows (no folder part) are stored. A real parent is never ''. */
const ROOT_KEY = ''

/**
 * Per `files` array: nothing yet (never asked), `'asked'` (one lookup answered by the plain
 * scan), or the index. The index costs about as much to build as one scan, so a files array that
 * is only ever asked once - the common case while the store is changing every few hundred
 * milliseconds - is never slower than before; the second lookup (navigating to another folder)
 * builds the index and every lookup after that is a map read.
 */
const stateByFiles = new WeakMap<readonly LocalFile[], 'asked' | Map<string, LocalFile[]>>()

function normalizeSeparators(path: string): string {
  return path.includes('\\') ? path.replace(/\\/g, '/') : path
}

function parentKeyOf(relativePath: string): string | null {
  const normalized = normalizeSeparators(relativePath)
  const lastSlash = normalized.lastIndexOf('/')
  if (lastSlash === -1) return ROOT_KEY
  // "/name": the empty first part makes this two path parts, so it is not top level, and its
  // parent is the empty folder, which no folder query can name. It matches nothing.
  if (lastSlash === 0) return null
  return normalized.slice(0, lastSlash).toLowerCase()
}

function buildIndex(files: readonly LocalFile[]): Map<string, LocalFile[]> {
  const index = new Map<string, LocalFile[]>()

  // Rows from the scan come folder by folder, so most rows share the previous row's parent.
  // Remember its raw prefix ("Parts/Brackets/") and bucket: a row that starts with it and has no
  // further separator goes straight into that bucket without slicing or lowercasing its path.
  let lastPrefix = ''
  let lastBucket: LocalFile[] | null = null

  for (const file of files) {
    if (!file || typeof file.relativePath !== 'string') continue
    const path = file.relativePath

    if (
      lastBucket !== null &&
      path.startsWith(lastPrefix) &&
      path.indexOf('/', lastPrefix.length) === -1 &&
      path.indexOf('\\', lastPrefix.length) === -1
    ) {
      lastBucket.push(file)
      continue
    }

    const key = parentKeyOf(path)
    if (key === null) continue

    let bucket = index.get(key)
    if (!bucket) {
      bucket = []
      index.set(key, bucket)
    }
    bucket.push(file)

    // Only a forward-slash path with a folder part can seed the shortcut.
    const lastSlash = path.lastIndexOf('/')
    if (lastSlash > 0 && !path.includes('\\')) {
      lastPrefix = path.slice(0, lastSlash + 1)
      lastBucket = bucket
    } else {
      lastBucket = null
    }
  }

  return index
}

const EMPTY: readonly LocalFile[] = []

/**
 * Direct children of `currentPath` (empty string = vault root), in the order they appear in
 * `files`. Do not mutate the returned array: after the first lookup on a `files` array it is
 * shared between calls.
 */
export function getFolderChildren(
  files: readonly LocalFile[],
  currentPath: string,
): readonly LocalFile[] {
  const state = stateByFiles.get(files)

  if (state === undefined) {
    stateByFiles.set(files, 'asked')
    // The existing scan, on the rows that have a path (it reads `relativePath` unguarded).
    return getFilesInFolder(
      files.filter((file) => file && typeof file.relativePath === 'string') as LocalFile[],
      currentPath,
    )
  }

  let index: Map<string, LocalFile[]>
  if (state === 'asked') {
    index = buildIndex(files)
    stateByFiles.set(files, index)
  } else {
    index = state
  }

  const key = normalizeSeparators(currentPath).toLowerCase()
  return index.get(key) ?? EMPTY
}
