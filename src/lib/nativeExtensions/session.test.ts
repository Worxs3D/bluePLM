import { describe, expect, it, vi } from 'vitest'

import { NativeExtensionSession, type SessionDeps } from './session'
import { createDebouncer } from './realtime'
import type { OrgNativeExtensionRow } from '@/types/nativeExtensions'

vi.mock('@/lib/supabase/client', () => ({ getSupabaseClient: vi.fn() }))

function row(orgId: string, sha: string): OrgNativeExtensionRow {
  return {
    orgId,
    extensionId: 'acme.tool',
    version: '1.0.0',
    enabled: true,
    sha256: sha,
    packagePath: `${orgId}/acme.tool/1.0.0-${sha}.bpx`,
    manifest: { id: 'acme.tool', name: 'Tool', version: '1.0.0' },
    installedAt: null,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

function harness() {
  const events: string[] = []
  const pending = new Map<string, ReturnType<typeof deferred<OrgNativeExtensionRow[]>>>()
  const deps: SessionDeps = {
    fetchRows: (orgId) => {
      events.push(`fetch:${orgId}`)
      const d = deferred<OrgNativeExtensionRow[]>()
      pending.set(orgId, d)
      return d.promise
    },
    sync: async (rows) => {
      events.push(`sync:${rows.map((r) => r.orgId).join(',')}`)
    },
    deactivateAll: async () => {
      events.push('deactivateAll')
    },
    setRows: () => {},
    prune: async (keep) => {
      events.push(`prune:${keep.join(',')}`)
    },
    onError: (error) => events.push(`error:${String(error)}`),
  }
  return { deps, events, pending }
}

/** Let queued microtasks run. */
const flush = () => new Promise((r) => setTimeout(r, 0))

describe('NativeExtensionSession', () => {
  it('activates an org and prunes to its packages after the fetch succeeds', async () => {
    const h = harness()
    const session = new NativeExtensionSession(h.deps)
    const done = session.activate('A')
    await flush()
    h.pending.get('A')!.resolve([row('A', 'a'.repeat(64))])
    await done
    expect(h.events).toEqual(['deactivateAll', 'fetch:A', 'sync:A', `prune:${'a'.repeat(64)}`])
  })

  it("drops a stale fetch: org A's rows never sync after a switch to org B", async () => {
    const h = harness()
    const session = new NativeExtensionSession(h.deps)
    const first = session.activate('A')
    await flush()
    const second = session.activate('B') // queued behind A's fetch
    h.pending.get('A')!.resolve([row('A', 'a'.repeat(64))])
    await first
    await flush()
    h.pending.get('B')!.resolve([row('B', 'b'.repeat(64))])
    await second

    expect(h.events).not.toContain('sync:A')
    expect(h.events).toContain('sync:B')
    // Switching org deactivates everything before B's fetch.
    expect(h.events.slice(1)).toEqual(['fetch:A', 'deactivateAll', 'fetch:B', 'sync:B', `prune:${'b'.repeat(64)}`])
  })

  it("drops a stale fetch on sign-out, and sign-out never prunes", async () => {
    const h = harness()
    const session = new NativeExtensionSession(h.deps)
    const first = session.activate('A')
    await flush()
    const out = session.deactivate()
    h.pending.get('A')!.resolve([row('A', 'a'.repeat(64))])
    await first
    await out

    expect(h.events).toEqual(['deactivateAll', 'fetch:A', 'deactivateAll'])
    expect(h.events.some((e) => e.startsWith('prune'))).toBe(false)
    expect(session.orgId).toBeNull()
  })

  it('does not prune when the fetch fails', async () => {
    const h = harness()
    const session = new NativeExtensionSession(h.deps)
    const done = session.activate('A')
    await flush()
    h.pending.get('A')!.resolve(Promise.reject(new Error('offline')) as never)
    await done
    expect(h.events.some((e) => e.startsWith('prune'))).toBe(false)
    expect(h.events.some((e) => e.startsWith('sync'))).toBe(false)
    expect(h.events.at(-1)).toMatch(/^error:/)
  })

  it('refreshing the same org does not deactivate first', async () => {
    const h = harness()
    const session = new NativeExtensionSession(h.deps)
    const one = session.activate('A')
    await flush()
    h.pending.get('A')!.resolve([])
    await one
    const two = session.activate('A')
    await flush()
    h.pending.get('A')!.resolve([])
    await two
    expect(h.events.filter((e) => e === 'deactivateAll')).toHaveLength(1)
  })
})

describe('createDebouncer', () => {
  it('collapses a burst into one call and can be cancelled', () => {
    vi.useFakeTimers()
    try {
      const onChange = vi.fn()
      const d = createDebouncer(onChange, 1000)
      d.notify()
      d.notify()
      vi.advanceTimersByTime(999)
      d.notify()
      vi.advanceTimersByTime(1000)
      expect(onChange).toHaveBeenCalledTimes(1)
      d.notify()
      d.cancel()
      vi.advanceTimersByTime(2000)
      expect(onChange).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
