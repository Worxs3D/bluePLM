import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('MDB capability cache', () => {
  beforeEach(() => {
    vi.resetModules()
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    })
    vi.stubGlobal('window', { electronAPI: {} })
    localStorage.setItem(
      'blueplm-mdb-config',
      JSON.stringify({ version: 1, serverUrl: 'https://mdb.example.test' }),
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('does not let an invalidated old probe overwrite or clear the newer same-URL probe', async () => {
    let resolveOld!: (response: Response) => void
    const oldResponse = new Promise<Response>((resolve) => {
      resolveOld = resolve
    })
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => oldResponse)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ supabase: false, capabilities: ['backup'] }), {
          status: 200,
        }),
      )
    const mdb = await import('./mdb')

    const oldProbe = mdb.getMdbServerCapabilities()
    mdb.invalidateMdbServerCapabilities()
    const newProbe = mdb.getMdbServerCapabilities()
    await expect(newProbe).resolves.toEqual(new Set(['backup']))
    resolveOld(new Response(JSON.stringify({ supabase: false, capabilities: [] }), { status: 200 }))
    await expect(oldProbe).rejects.toThrow('MDB_SERVER_UPDATE_REQUIRED')

    await expect(mdb.getMdbServerCapabilities()).resolves.toEqual(new Set(['backup']))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('never lets an old server capability probe authorize a backup request on a new server', async () => {
    let resolveOld!: (response: Response) => void
    const oldResponse = new Promise<Response>((resolve) => {
      resolveOld = resolve
    })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url === 'https://mdb.example.test/health') return oldResponse
      if (url === 'https://other.example.test/backup/config') {
        return new Response(JSON.stringify({ config: null }), { status: 200 })
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    const mdb = await import('./mdb')
    mdb.saveMdbConfig({ version: 1, serverUrl: 'https://mdb.example.test', accessToken: 'fixture-token-a' })

    const pendingBackupRequest = mdb.getMdbBackupConfig()
    mdb.saveMdbConfig({ version: 1, serverUrl: 'https://other.example.test', accessToken: 'fixture-token-b' })
    resolveOld(new Response(JSON.stringify({ supabase: false, capabilities: ['backup'] }), { status: 200 }))

    await expect(pendingBackupRequest).rejects.toThrow('MDB_SERVER_UPDATE_REQUIRED')
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      'https://mdb.example.test/health',
    ])
  })
})
