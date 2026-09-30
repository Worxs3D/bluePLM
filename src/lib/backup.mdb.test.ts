import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({
  getSupabaseClient: vi.fn(() => {
    throw new Error('Supabase must not be initialized in MDB mode')
  }),
}))

describe('backup MDB adapter', () => {
  beforeEach(() => {
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

  it('reads and writes backup configuration through MDB without probing Supabase', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ config: { provider: 'aws_s3' } }), { status: 200 }),
    )
    const { getBackupConfig, saveBackupConfig } = await import('./backup')

    await expect(getBackupConfig('org-1')).resolves.toMatchObject({ provider: 'aws_s3' })
    await expect(saveBackupConfig('org-1', { provider: 'aws_s3' }, 'user-1')).resolves.toEqual({
      success: true,
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      'https://mdb.example.test/backup/config',
      'https://mdb.example.test/backup/config',
    ])
  })
})
