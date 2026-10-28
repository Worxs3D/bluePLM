/**
 * Store rows by server file id, from an index built once per `files` array.
 *
 * The realtime handler looked up each event's row with `files.find(...)`, a scan of the whole
 * vault per event: a burst of 500 updates over 30k files was half a second of one task in the
 * render-perf run before anything was applied. The store replaces `files` on every write and
 * never mutates it, so an index keyed by the array stays right for as long as that array is the
 * store's, and a burst between two writes builds it once.
 *
 * Both lookups answer what the scans they replace answered: the first row in array order.
 */
import type { LocalFile } from './types'

interface Entry {
  /** The first row with this id, whatever its status. */
  first: LocalFile
  /** The first row with this id that is not a `moved_away` stub: the one with the bytes. */
  withContent?: LocalFile
}

const indexByFiles = new WeakMap<readonly LocalFile[], Map<string, Entry>>()

function indexOf(files: readonly LocalFile[]): Map<string, Entry> {
  let index = indexByFiles.get(files)
  if (index) return index
  index = new Map()
  for (const file of files) {
    const id = file?.pdmData?.id
    if (!id) continue
    let entry = index.get(id)
    if (!entry) {
      entry = { first: file }
      index.set(id, entry)
    }
    if (!entry.withContent && file.diffStatus !== 'moved_away') entry.withContent = file
  }
  indexByFiles.set(files, index)
  return index
}

/** `files.find((f) => f.pdmData?.id === id)` */
export function findFileById(files: readonly LocalFile[], id: string): LocalFile | undefined {
  return indexOf(files).get(id)?.first
}

/** `files.find((f) => f.pdmData?.id === id && f.diffStatus !== 'moved_away')` */
export function findStoredFileById(files: readonly LocalFile[], id: string): LocalFile | undefined {
  return indexOf(files).get(id)?.withContent
}
