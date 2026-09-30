import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({
  getSupabaseClient: vi.fn(() => {
    throw new Error('Supabase must not be initialized in MDB mode')
  }),
}))

describe('backup MDB adapter', () => {
  beforeEach(() => {
    vi.resetModules()
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
    })
    localStorage.clear()
    vi.restoreAllMocks()
    localStorage.setItem('blueplm-backend-profile', JSON.stringify({ version: 1, kind: 'mdb' }))
    localStorage.setItem(
      'blueplm-mdb-config',
      JSON.stringify({ version: 1, serverUrl: 'https://mdb.example.test', accessToken: 'token' }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reads and writes backup configuration through MDB without probing Supabase', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input).endsWith('/health')) {
        return new Response(JSON.stringify({ ok: true, supabase: false, apiVersion: 2, capabilities: ['backup'] }), { status: 200 })
      }
      return new Response(JSON.stringify({ config: { provider: 'aws_s3' } }), { status: 200 })
    })
    const { getBackupConfig, saveBackupConfig } = await import('./backup')

    await expect(getBackupConfig('org-1')).resolves.toMatchObject({ provider: 'aws_s3' })
    await expect(saveBackupConfig('org-1', { provider: 'aws_s3' }, 'user-1')).resolves.toEqual({
      success: true,
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      'https://mdb.example.test/health',
      'https://mdb.example.test/backup/config',
      'https://mdb.example.test/backup/config',
    ])
  })

  it('treats a legacy MDB server without backup capability as update-required without polling backup routes or starting a heartbeat', async () => {
    const performMdbBackupDeviceAction = vi.fn().mockResolvedValue({ active: true })
    vi.stubGlobal('window', { electronAPI: { performMdbBackupDeviceAction } })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true, supabase: false, apiVersion: 2, capabilities: [] }), { status: 200 }),
    )
    const { getBackupStatus, updateHeartbeat } = await import('./backup')

    await expect(getBackupStatus('org-1')).resolves.toMatchObject({
      isConfigured: false,
      updateRequired: true,
      error: 'MDB_SERVER_UPDATE_REQUIRED',
    })
    await expect(getBackupStatus('org-1')).resolves.toMatchObject({ updateRequired: true })
    await expect(updateHeartbeat('org-1')).resolves.toBe(false)

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      'https://mdb.example.test/health',
    ])
    expect(performMdbBackupDeviceAction).not.toHaveBeenCalled()
  })
})
