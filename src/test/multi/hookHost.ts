/**
 * Runs a machine's hooks without React's scheduler.
 *
 * React schedules renders and passive effects on its own task queue, so an effect could run in
 * whichever machine's context posted the queue's first task (the smoke test caught
 * `subscribeToFiles` running outside any machine). This host is a minimal React dispatcher
 * instead: hooks are called in order, effects run right after the render that changed their
 * deps, and a store change re-renders on a microtask in the machine that owns the host. The
 * hooks under test only use refs, callbacks, memos, effects and `useSyncExternalStore` (through
 * zustand), which is what it implements.
 *
 * The dispatcher is installed on every React copy that can reach a hook: the machine graph's own
 * copy and the one Node resolves for externalized packages (zustand).
 */
import { createRequire } from 'node:module'

import { runOn, type MachineContext } from './context'

type Deps = readonly unknown[] | undefined
type Cleanup = void | (() => void)

interface ReactInternals {
  H: unknown
}

const INTERNALS = '__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE'

const nodeReact = createRequire(import.meta.url)('react') as Record<string, unknown>

function internalsOf(react: Record<string, unknown>): ReactInternals {
  const internals = react[INTERNALS] as ReactInternals | undefined
  if (!internals) throw new Error('hookHost: this React has no client internals')
  return internals
}

const changed = (a: Deps, b: Deps) => !a || !b || a.length !== b.length || a.some((x, i) => !Object.is(x, b[i]))

export class HookHost<T> {
  private slots: unknown[] = []
  private index = 0
  private effects: Array<{ deps: Deps; cleanup: Cleanup }> = []
  private pendingEffects: Array<{ slot: number; run: () => Cleanup; deps: Deps }> = []
  private unsubscribers: Array<() => void> = []
  private scheduled = false
  private mounted = true
  current!: T

  constructor(
    private readonly ctx: MachineContext,
    private readonly reacts: Array<Record<string, unknown>>,
    private readonly hook: () => T,
  ) {
    this.render()
  }

  private dispatcher(): Record<string, unknown> {
    const slot = <S>(init: () => S): { value: S; slot: number } => {
      const i = this.index++
      if (i >= this.slots.length) this.slots.push(init())
      return { value: this.slots[i] as S, slot: i }
    }
    const memo = <V>(factory: () => V, deps: Deps): V => {
      const i = this.index++
      const prev = this.slots[i] as { value: V; deps: Deps } | undefined
      if (prev && !changed(prev.deps, deps)) return prev.value
      const value = factory()
      this.slots[i] = { value, deps }
      return value
    }
    const effect = (run: () => Cleanup, deps: Deps) => {
      const i = this.index++
      const prev = this.slots[i] as { deps: Deps } | undefined
      if (prev && !changed(prev.deps, deps)) return
      this.slots[i] = { deps }
      this.pendingEffects.push({ slot: i, run, deps })
    }
    return {
      useRef: <V>(initial: V) => slot(() => ({ current: initial })).value,
      useCallback: <F>(fn: F, deps: Deps) => memo(() => fn, deps),
      useMemo: memo,
      useState: <S>(initial: S | (() => S)) => {
        const { value } = slot(() => {
          const box = {
            state: typeof initial === 'function' ? (initial as () => S)() : initial,
            set: (next: S | ((s: S) => S)) => {
              const resolved = typeof next === 'function' ? (next as (s: S) => S)(box.state) : next
              if (Object.is(resolved, box.state)) return
              box.state = resolved
              this.schedule()
            },
          }
          return box
        })
        return [value.state, value.set]
      },
      useEffect: effect,
      useLayoutEffect: effect,
      useInsertionEffect: effect,
      useSyncExternalStore: <S>(subscribe: (cb: () => void) => () => void, getSnapshot: () => S) => {
        slot(() => {
          this.unsubscribers.push(subscribe(() => this.schedule()))
          return true
        })
        return getSnapshot()
      },
      useDebugValue: () => {},
      useContext: (context: { _currentValue: unknown }) => context._currentValue,
      useId: () => slot(() => `sim-${Math.random().toString(36).slice(2)}`).value,
    }
  }

  private render(): void {
    if (!this.mounted) return
    this.index = 0
    const dispatcher = this.dispatcher()
    const saved = this.reacts.map((r) => internalsOf(r).H)
    for (const r of this.reacts) internalsOf(r).H = dispatcher
    try {
      this.current = runOn(this.ctx, this.hook)
    } finally {
      this.reacts.forEach((r, i) => {
        internalsOf(r).H = saved[i]
      })
    }
    const effects = this.pendingEffects
    this.pendingEffects = []
    runOn(this.ctx, () => {
      for (const { slot, run, deps } of effects) {
        const previous = this.effects[slot]
        if (typeof previous?.cleanup === 'function') previous.cleanup()
        this.effects[slot] = { deps, cleanup: run() }
      }
    })
  }

  private schedule(): void {
    if (this.scheduled || !this.mounted) return
    this.scheduled = true
    runOn(this.ctx, () =>
      queueMicrotask(() => {
        this.scheduled = false
        this.render()
      }),
    )
  }

  unmount(): void {
    this.mounted = false
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe()
    runOn(this.ctx, () => {
      for (const e of this.effects) if (typeof e?.cleanup === 'function') e.cleanup()
    })
    this.effects = []
  }
}

export function hostHook<T>(ctx: MachineContext, graphReact: Record<string, unknown>, hook: () => T): HookHost<T> {
  const reacts = graphReact[INTERNALS] === nodeReact[INTERNALS] ? [nodeReact] : [graphReact, nodeReact]
  return new HookHost(ctx, reacts, hook)
}
