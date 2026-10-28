import type { PDMFile } from '@/types/pdm'

type Row = Partial<PDMFile>

const sameValue = (a: unknown, b: unknown) =>
  Object.is(a, b) || (typeof a === 'object' && typeof b === 'object' && JSON.stringify(a) === JSON.stringify(b))

/**
 * Keeps a queued realtime update from undoing a local write that landed after it was queued.
 *
 * Realtime updates wait in batches (useRealtimeSubscriptions.ts) before they reach the store. An
 * update queued before this machine's own checkout, and applied after it, carried the row as it
 * was before the checkout and cleared it in the store (src/test/multi/savedSequences.test.ts). The
 * update is older than the local write for every field that write changed, so those fields are
 * left as the local write set them; the rest of the update (another user's move, say) is still
 * news and applies.
 *
 * The guard snapshots the store's row when a file first enters a queue and compares it with the
 * row at flush time. Realtime's own flushes are not local writes: after one, the snapshot of a file
 * still waiting in another queue moves to the row realtime just wrote.
 */
export function createLocalWriteGuard(read: (fileId: string) => Row | undefined) {
  const snapshots = new Map<string, { row: Row | undefined; queues: Set<string> }>()

  return {
    queued(fileId: string, queue: string): void {
      const snapshot = snapshots.get(fileId)
      if (snapshot) snapshot.queues.add(queue)
      else snapshots.set(fileId, { row: read(fileId), queues: new Set([queue]) })
    },

    /** `update` without the fields a local write changed since the file was queued. */
    withoutLocalChanges<T extends Row>(fileId: string, update: T, current: Row | undefined = read(fileId)): T {
      const before = snapshots.get(fileId)?.row
      if (!before || !current || before === current) return update
      const kept = { ...update }
      for (const key of Object.keys(update) as Array<keyof Row>) {
        if (key === 'id') continue
        if (!sameValue(before[key], current[key])) delete kept[key]
      }
      return kept
    },

    flushed(fileId: string, queue: string): void {
      const snapshot = snapshots.get(fileId)
      if (!snapshot) return
      snapshot.queues.delete(queue)
      if (snapshot.queues.size === 0) snapshots.delete(fileId)
      else snapshot.row = read(fileId)
    },
  }
}
