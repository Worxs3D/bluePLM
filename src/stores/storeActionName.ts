/**
 * Name the store action behind a slow `set()`, from the stack captured inside the timed wrapper.
 *
 * `Slow store mutation` used to log only the raw stack, and the frames that name the action sit
 * well below the timing wrapper. The first frame outside the wrapper is the action
 * (`setCheckoutHydrationStatus`, `setFiles`, ...), which is what a reader scanning a log wants.
 * Minified builds mangle the name; the stack stays in the log for those.
 */

const WRAPPER_FRAME_NAMES: ReadonlySet<string> = new Set(['timedSet', 'Error'])

/** `at Object.setFiles (file:///...)` / `at setFiles (...)` / `at async setFiles (...)`. */
const NAMED_FRAME = /^\s*at\s+(?:async\s+)?(?:new\s+)?([^\s(]+)\s+\(/

export function getStoreActionName(stack: string | undefined): string | undefined {
  if (!stack) return undefined

  for (const line of stack.split('\n')) {
    const match = NAMED_FRAME.exec(line)
    if (!match) continue

    // "Object.setFiles" and "Array.map" style qualifiers: keep the member name.
    const name = match[1].split('.').pop() ?? match[1]
    if (!name || WRAPPER_FRAME_NAMES.has(name)) continue
    return name
  }

  return undefined
}
