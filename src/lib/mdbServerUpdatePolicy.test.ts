import { describe, expect, it, vi } from 'vitest'
import { finalizeMdbServerUpdateResult, mdbServerUpdateCheckKey, shouldNotifyMdbServerUpdate } from './mdbServerUpdatePolicy'

describe('MDB startup update policy', () => {
  it('deduplicates by organization and server', () => {
    expect(mdbServerUpdateCheckKey('org-1', 'https://mdb.example.test')).toBe('org-1:https://mdb.example.test')
    expect(mdbServerUpdateCheckKey('org-1', 'https://mdb.example.test')).toBe(mdbServerUpdateCheckKey('org-1', 'https://mdb.example.test'))
  })
  it('notifies only owner/admin when an update is available', () => {
    expect(shouldNotifyMdbServerUpdate('update-available', 'owner')).toBe(true)
    expect(shouldNotifyMdbServerUpdate('update-available', 'admin')).toBe(true)
    expect(shouldNotifyMdbServerUpdate('update-available', 'member')).toBe(false)
    expect(shouldNotifyMdbServerUpdate('same-version-different', 'admin')).toBe(true)
    expect(shouldNotifyMdbServerUpdate('current', 'admin')).toBe(false)
    expect(shouldNotifyMdbServerUpdate('unknown', 'admin')).toBe(false)
  })

  it('preserves a successful server update when the capability refresh fails', async () => {
    const refresh = vi.fn().mockRejectedValue(new Error('health unavailable'))

    await expect(finalizeMdbServerUpdateResult({ success: true }, refresh)).resolves.toBe(true)
    expect(refresh).toHaveBeenCalledOnce()
  })
})
