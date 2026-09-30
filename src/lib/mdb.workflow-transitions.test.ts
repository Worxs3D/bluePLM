import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { activateBackend } from './backend'
import { getMdbAvailableTransitions, saveMdbConfig } from './mdb'

describe('MDB workflow transition seam', () => {
  const storage = new Map<string, string>()

  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
    })
  })

  afterEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('calls the server route expected by the workflow client', async () => {
    activateBackend('mdb')
    saveMdbConfig({ version: 1, serverUrl: 'https://mdb.example.test', accessToken: 'session' })
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ transitions: [{
        transition_id: 'transition-1', transition_name: 'Release', to_state_id: 'state-2',
        to_state_name: 'Released', to_state_color: '#0f0', has_gates: false,
        user_can_transition: true,
      }] }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(getMdbAvailableTransitions('file-1')).resolves.toEqual([expect.objectContaining({
      transition_id: 'transition-1', has_gates: false, user_can_transition: true,
    })])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'https://mdb.example.test/files/file-1/available-transitions',
    )
  })
})
