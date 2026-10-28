/**
 * Files this machine just wrote, so their own realtime echo is not applied over the local state.
 * An entry matters for `RECENTLY_MODIFIED_WINDOW_MS`; each mark drops the entries past it, so the
 * map holds only the files written in the last window however long the session runs.
 */
export const RECENTLY_MODIFIED_WINDOW_MS = 15_000

export function markRecentlyModified(
  current: ReadonlyMap<string, number>,
  fileId: string,
  now: number,
): Map<string, number> {
  const next = new Map<string, number>()
  for (const [id, at] of current) {
    if (now - at < RECENTLY_MODIFIED_WINDOW_MS) next.set(id, at)
  }
  next.set(fileId, now)
  return next
}

export function isRecentlyModified(map: ReadonlyMap<string, number>, fileId: string, now: number): boolean {
  const at = map.get(fileId)
  return at !== undefined && now - at < RECENTLY_MODIFIED_WINDOW_MS
}
