/**
 * A cached lazy loader that forgets a failure: a failed dynamic import (offline, a chunk missing
 * after an update) must not stay cached for a session that runs for weeks, so the next call retries.
 */
export function lazyLoader<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null
  return () => {
    if (!pending) {
      pending = load().catch((error: unknown) => {
        pending = null
        throw error
      })
    }
    return pending
  }
}
