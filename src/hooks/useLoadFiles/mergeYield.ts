/**
 * Merge phases hand the thread back after this long. The merge runs as one
 * synchronous block, so a 25k-file vault produced single 9-second tasks during
 * which hover, scrolling and the cursor shape all stopped responding.
 */
const MERGE_YIELD_INTERVAL_MS = 50

/** Items processed between clock checks. Reading the clock per item is itself measurable. */
export const YIELD_CHECK_STRIDE = 256

/**
 * Returns a gate that hands the main thread back once it has been held for
 * MERGE_YIELD_INTERVAL_MS, and does nothing before that.
 *
 * Yielding mid-merge is safe because the epoch check immediately before
 * setFiles discards any merge that a file operation landed during, so an
 * interleaved checkout cannot be reverted by a merge that started before it.
 */
export function createYieldGate(): () => Promise<void> {
  let lastYieldAt = performance.now()

  return async () => {
    if (performance.now() - lastYieldAt < MERGE_YIELD_INTERVAL_MS) return
    await new Promise((resolve) => setTimeout(resolve, 0))
    lastYieldAt = performance.now()
  }
}

export async function mapYielding<T, R>(
  items: T[],
  transform: (item: T) => R,
  yieldIfSlow: () => Promise<void>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)

  for (let index = 0; index < items.length; index++) {
    results[index] = transform(items[index])
    if (index % YIELD_CHECK_STRIDE === YIELD_CHECK_STRIDE - 1) await yieldIfSlow()
  }

  return results
}
