/**
 * The renderer's health monitor: notices the slow failures of a session left open for weeks and
 * recovers from them without a restart.
 *
 * - Realtime silently dead: a channel that has not been joined for `realtimeDeadAfterMs` while the
 *   machine is online, which supabase-js did not bring back. It is subscribed again, and the files
 *   channel catches up through the reload a rejoin triggers.
 * - IndexedDB broken mid-session: the vault cache is probed every `vaultCacheProbeEveryMs`; a
 *   failed open starts the cache's own repair (vaultFileCache.ts).
 * - Heap past its high-water mark: rebuildable caches are dropped first (cacheRegistry.ts) and a
 *   diagnostic of what the store and caches hold is logged, so the cause can be found later.
 *
 * The SolidWorks service has its own check in the main process (electron/handlers/swServiceHealth.ts),
 * which restarts it between jobs. Every recovery is logged and kept in a short ring buffer.
 */

export type RecoveryKind = 'realtime-resubscribed' | 'vault-cache-probe-failed' | 'heap-caches-dropped'

export interface Recovery {
  at: number
  kind: RecoveryKind
  detail: string
}

export interface HealthMonitorDeps {
  now(): number
  online(): boolean
  realtimeStates(): Array<{ kind: string; state: string }>
  resubscribe(kinds: readonly string[]): string[]
  probeVaultCache(): Promise<boolean>
  /** Live JS heap and its limit, in MB; null where the browser does not say. */
  heap(): { usedMB: number; limitMB: number } | null
  dropCaches(): string[]
  /** Sizes worth logging when the heap is high: store collections, cache entries. */
  diagnostics(): Record<string, number>
  log: {
    info(message: string, data?: Record<string, unknown>): void
    warn(message: string, data?: Record<string, unknown>): void
  }
}

export interface HealthMonitorOptions {
  intervalMs: number
  realtimeDeadAfterMs: number
  resubscribeCooldownMs: number
  vaultCacheProbeEveryMs: number
  /** The heap is high past this fraction of its limit... */
  heapHighWaterFraction: number
  /** ...or past this many MB, whichever is lower. */
  heapHighWaterMB: number
  heapCooldownMs: number
}

export const DEFAULT_HEALTH_OPTIONS: HealthMonitorOptions = {
  intervalMs: 60_000,
  realtimeDeadAfterMs: 3 * 60_000,
  resubscribeCooldownMs: 5 * 60_000,
  vaultCacheProbeEveryMs: 30 * 60_000,
  heapHighWaterFraction: 0.7,
  heapHighWaterMB: 2048,
  heapCooldownMs: 10 * 60_000,
}

export const MAX_RECOVERIES_KEPT = 50

export interface HealthMonitor {
  start(): void
  stop(): void
  /** One round of checks; returns the recoveries it made. */
  tick(): Promise<Recovery[]>
  recoveries(): Recovery[]
  counts(): Record<RecoveryKind, number>
}

export function createHealthMonitor(
  deps: HealthMonitorDeps,
  options: HealthMonitorOptions = DEFAULT_HEALTH_OPTIONS,
): HealthMonitor {
  const recent: Recovery[] = []
  const counts: Record<RecoveryKind, number> = {
    'realtime-resubscribed': 0,
    'vault-cache-probe-failed': 0,
    'heap-caches-dropped': 0,
  }
  /** When each channel kind was first seen not joined, in this run of bad readings. */
  const badSince = new Map<string, number>()
  let lastResubscribeAt = -Infinity
  let lastProbeAt = -Infinity
  let lastHeapDropAt = -Infinity
  let timer: ReturnType<typeof setInterval> | null = null
  let ticking = false

  const record = (kind: RecoveryKind, detail: string, data?: Record<string, unknown>): Recovery => {
    const recovery = { at: deps.now(), kind, detail }
    recent.push(recovery)
    if (recent.length > MAX_RECOVERIES_KEPT) recent.splice(0, recent.length - MAX_RECOVERIES_KEPT)
    counts[kind]++
    deps.log.warn(detail, { kind, ...data })
    return recovery
  }

  const checkRealtime = (now: number): Recovery | null => {
    const states = deps.realtimeStates()
    const live = new Set(states.map((s) => s.kind))
    for (const kind of [...badSince.keys()]) if (!live.has(kind)) badSince.delete(kind)
    for (const { kind, state } of states) {
      if (state === 'joined') badSince.delete(kind)
      else if (!badSince.has(kind)) badSince.set(kind, now)
    }
    // Offline, nothing can join; the rejoin when the network returns is supabase-js's job.
    if (!deps.online()) return null
    const dead = [...badSince].filter(([, since]) => now - since >= options.realtimeDeadAfterMs).map(([k]) => k)
    if (!dead.length || now - lastResubscribeAt < options.resubscribeCooldownMs) return null
    lastResubscribeAt = now
    const done = deps.resubscribe(dead)
    for (const kind of done) badSince.delete(kind)
    if (!done.length) return null
    return record('realtime-resubscribed', `Realtime channels not joined for minutes; resubscribed ${done.join(', ')}`, {
      states: Object.fromEntries(states.map((s) => [s.kind, s.state])),
    })
  }

  const checkVaultCache = async (now: number): Promise<Recovery | null> => {
    if (now - lastProbeAt < options.vaultCacheProbeEveryMs) return null
    lastProbeAt = now
    if (await deps.probeVaultCache()) return null
    return record('vault-cache-probe-failed', 'Vault cache could not be opened; its repair has been started')
  }

  const checkHeap = (now: number): Recovery | null => {
    const heap = deps.heap()
    if (!heap || now - lastHeapDropAt < options.heapCooldownMs) return null
    const highWater = Math.min(heap.limitMB * options.heapHighWaterFraction, options.heapHighWaterMB)
    if (heap.usedMB < highWater) return null
    lastHeapDropAt = now
    const diagnostics = deps.diagnostics()
    const dropped = deps.dropCaches()
    return record(
      'heap-caches-dropped',
      `Heap ${Math.round(heap.usedMB)} MB is over its ${Math.round(highWater)} MB high-water mark; dropped ${dropped.length} rebuildable caches`,
      { dropped, diagnostics },
    )
  }

  const tick = async (): Promise<Recovery[]> => {
    if (ticking) return []
    ticking = true
    try {
      const now = deps.now()
      const made: Array<Recovery | null> = []
      for (const check of [() => checkRealtime(now), () => checkHeap(now), () => checkVaultCache(now)]) {
        try {
          made.push(await check())
        } catch (error) {
          deps.log.warn('A health check failed', { error: String(error) })
        }
      }
      return made.filter((r): r is Recovery => r !== null)
    } finally {
      ticking = false
    }
  }

  return {
    start() {
      if (timer) return
      deps.log.info('Health monitor started', { intervalMs: options.intervalMs })
      timer = setInterval(() => void tick(), options.intervalMs)
    },
    stop() {
      if (timer) clearInterval(timer)
      timer = null
    },
    tick,
    recoveries: () => [...recent],
    counts: () => ({ ...counts }),
  }
}
