/**
 * One SOLIDWORKS export pipeline at a time (5.13.0). Every stage-export-record run takes this
 * lock: the model exports (`exportAndRecord` in `./ensure`) and the drawing PDF render
 * (`renderAndRecord` in `src/lib/reviewPackage/pdf.ts`), so the app's output queue, Generate
 * missing on an order, reviews, inspection reports and the output request worker never drive
 * the service at once. Waiters run in arrival order. Free of imports.
 */

let held = false
const waiters: Array<() => void> = []
/** Runs of the app's own generation in progress (`holdGeneration`), between their pipelines too. */
let holds = 0

/** Whether a pipeline runs or waits, or the app's own generation is under way. The request worker claims nothing then. */
export function generationLockBusy(): boolean {
  return held || waiters.length > 0 || holds > 0
}

/**
 * Mark a run of several jobs of the user's own (Generate missing on an order) as busy for its
 * whole length, so the request worker does not slip a claim in between two of its pipelines.
 * Returns the function that ends it (idempotent).
 */
export function holdGeneration(): () => void {
  holds++
  let ended = false
  return () => {
    if (ended) return
    ended = true
    holds--
  }
}

function acquire(): Promise<void> {
  if (!held) {
    held = true
    return Promise.resolve()
  }
  return new Promise<void>((resolve) => waiters.push(resolve))
}

function release(): void {
  const next = waiters.shift()
  if (next) next()
  else held = false
}

/** Run `fn` holding the lock (waiting for it first). The lock is released however `fn` ends. */
export async function withGenerationLock<T>(fn: () => Promise<T>): Promise<T> {
  await acquire()
  try {
    return await fn()
  } finally {
    release()
  }
}
