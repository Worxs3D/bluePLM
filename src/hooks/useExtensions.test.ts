import { describe, expect, it, vi } from 'vitest'

vi.mock('@/stores/pdmStore', () => ({ usePDMStore: vi.fn() }))

import { subscribeToExtensionEvents, type ExtensionEventSource } from './useExtensions'

type Listener = Parameters<ExtensionEventSource['onStateChange']>[0]

function fakeApi() {
  const listeners = new Set<Listener>()
  const api: ExtensionEventSource = {
    onStateChange: (callback) => {
      listeners.add(callback)
      return () => listeners.delete(callback)
    },
  }
  return { api, listeners }
}

describe('subscribeToExtensionEvents', () => {
  it('forwards each state change to the store read at event time', () => {
    const { api, listeners } = fakeApi()
    const first = vi.fn()
    const second = vi.fn()
    let current = first
    const getState = () => ({ handleExtensionStateChange: current })

    subscribeToExtensionEvents(api, getState)
    for (const l of listeners) l({ extensionId: 'acme.tool', state: 'installed', timestamp: 1 })
    expect(first).toHaveBeenCalledWith('acme.tool', 'installed')

    // State changed after subscribing: the same subscription sees the new store,
    // with no resubscribe.
    current = second
    for (const l of listeners) l({ extensionId: 'acme.tool', state: 'not-installed', timestamp: 2 })
    expect(second).toHaveBeenCalledWith('acme.tool', 'not-installed')
    expect(listeners.size).toBe(1)
  })

  it('unsubscribes cleanly', () => {
    const { api, listeners } = fakeApi()
    const unsubscribe = subscribeToExtensionEvents(api, () => ({
      handleExtensionStateChange: vi.fn(),
    }))
    expect(listeners.size).toBe(1)
    unsubscribe()
    expect(listeners.size).toBe(0)
  })

  it('is a no-op without the preload API', () => {
    const unsubscribe = subscribeToExtensionEvents(undefined, () => ({
      handleExtensionStateChange: vi.fn(),
    }))
    expect(() => unsubscribe()).not.toThrow()
  })
})
