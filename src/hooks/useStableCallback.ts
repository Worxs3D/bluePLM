/**
 * useStableCallback - Returns a callback with a stable identity that always
 * invokes the latest version of the provided function.
 *
 * This lets us pass handlers into React.memo'd children without breaking
 * memoization (the identity never changes) while still always running the
 * most up-to-date closure (no stale pan/zoom/state captures).
 *
 * It also keeps a memoized child from holding on to old renders. A child whose
 * comparator skips a render keeps the props of the last render it did take; a
 * handler created in the parent's render closes over everything that render saw
 * (every closure of one function call shares its scope), so a skipped row held a
 * whole old file list, tree and folder metrics map alive. The wrapper closes over
 * only the ref.
 */
import { useCallback, useRef } from 'react'

export function useStableCallback<Args extends unknown[], R>(
  fn: (...args: Args) => R,
): (...args: Args) => R {
  const fnRef = useRef(fn)
  fnRef.current = fn

  return useCallback((...args: Args) => fnRef.current(...args), [])
}
