/**
 * The storage adapter skips a write when no persisted key changed, judged by reference. That only
 * holds if the real `partialize` returns the same references for state that did not change - a
 * derived value rebuilt on every call (a Set turned into an array, a sliced list) would defeat it
 * silently and bring back a full serialize per store write. This pins the real store to it.
 */

import { describe, expect, it, vi } from 'vitest'

import { isPersistedStateUnchanged } from './persistStorage'
import { usePDMStore } from './pdmStore'

vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

function partialized() {
  const options = usePDMStore.persist.getOptions()
  const partialize = options.partialize
  if (!partialize) throw new Error('the store has no partialize')
  return { state: partialize(usePDMStore.getState()), version: options.version ?? 0 }
}

describe('pdmStore partialize', () => {
  it('returns referentially stable values when nothing persisted changed', () => {
    const first = partialized()
    const second = partialized()

    expect(isPersistedStateUnchanged(first, second)).toBe(true)
  })

  it('stays stable across a write to state that is not persisted', () => {
    const before = partialized()
    usePDMStore.setState({ isLoading: !usePDMStore.getState().isLoading })
    const after = partialized()

    expect(isPersistedStateUnchanged(before, after)).toBe(true)
  })

  it('changes when a persisted collection changes', () => {
    const before = partialized()
    usePDMStore.setState({ expandedFolders: new Set(['A', 'B']) })
    const after = partialized()

    expect(isPersistedStateUnchanged(before, after)).toBe(false)
    expect((after.state as Record<string, unknown>).expandedFolders).toEqual(['A', 'B'])
  })
})
