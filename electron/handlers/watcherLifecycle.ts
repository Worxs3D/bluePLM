// The vault watcher's lifecycle: at most one watcher open, starts and stops run one at a time.
//
// Before this, two vault switches close together interleaved across `await watcher.close()`:
// the second start saw no watcher and made one, then the first resumed and overwrote it. The
// overwritten watcher could never be closed and kept sending `files-changed` for the wrong vault.

import type { VaultWatcher } from './fsWatcher'

/** How long a stop waits for a close that may never settle before letting the next start run. */
export const WATCHER_CLOSE_TIMEOUT_MS = 5_000

export interface WatcherLifecycle {
  start(dirPath: string): Promise<void>
  stop(): Promise<void>
  /** The open watcher, if any (callers only test it for presence). */
  current(): VaultWatcher | null
  /** Close for app exit: not queued, bounded by `timeoutMs`, never throws. */
  closeForExit(timeoutMs: number): Promise<void>
}

export function createWatcherLifecycle(
  create: (dirPath: string) => VaultWatcher,
  log: (message: string) => void,
  closeTimeoutMs = WATCHER_CLOSE_TIMEOUT_MS,
): WatcherLifecycle {
  let watcher: VaultWatcher | null = null
  let watchedPath: string | null = null
  let queue: Promise<void> = Promise.resolve()

  const queued = (change: () => Promise<void>): Promise<void> => {
    const run = queue.then(change)
    queue = run.catch(() => undefined)
    return run
  }

  /** Detach the open watcher and close it, giving up after `timeoutMs`. True when it closed. */
  const closeOpen = async (timeoutMs: number): Promise<boolean> => {
    const closing = watcher
    watcher = null
    watchedPath = null
    if (!closing) return true
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        closing.close().then(() => true),
        new Promise<false>((resolve) => {
          timer = setTimeout(() => resolve(false), timeoutMs)
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
  }

  const stopNow = async () => {
    if (!watcher) return
    log('Stopping file watcher')
    const closed = await closeOpen(closeTimeoutMs)
    log(closed ? 'File watcher closed' : 'File watcher close timed out; going on without it')
  }

  return {
    start: (dirPath) =>
      queued(async () => {
        // Skip if already watching this exact path (prevents rapid restarts during HMR)
        if (watcher && watchedPath === dirPath) {
          log('File watcher already active for: ' + dirPath)
          return
        }
        await stopNow()
        log('Starting file watcher for: ' + dirPath)
        watcher = create(dirPath)
        watchedPath = dirPath
      }),
    stop: () => queued(stopNow),
    current: () => watcher,
    async closeForExit(timeoutMs) {
      if (!watcher) return
      log('Stopping file watcher for cleanup')
      try {
        log((await closeOpen(timeoutMs)) ? 'File watcher closed successfully' : 'File watcher close timed out')
      } catch (error) {
        log(`Error closing file watcher (continuing with cleanup): ${String(error)}`)
      }
    },
  }
}
