import { describe, expect, it } from 'vitest'
import { mdbServerUpdateCheckKey, shouldNotifyMdbServerUpdate } from './mdbServerUpdatePolicy'

describe('MDB startup update policy', () => {
  it('deduplicates by organization and server', () => {
    expect(mdbServerUpdateCheckKey('org-1', 'https://mdb.example.test')).toBe('org-1:https://mdb.example.test')
    expect(mdbServerUpdateCheckKey('org-1', 'https://mdb.example.test')).toBe(mdbServerUpdateCheckKey('org-1', 'https://mdb.example.test'))
  })
  it('notifies only owner/admin when an update is available', () => {
    expect(shouldNotifyMdbServerUpdate('update-available', 'owner')).toBe(true)
    expect(shouldNotifyMdbServerUpdate('update-available', 'admin')).toBe(true)
    expect(shouldNotifyMdbServerUpdate('update-available', 'member')).toBe(false)
    expect(shouldNotifyMdbServerUpdate('current', 'admin')).toBe(false)
    expect(shouldNotifyMdbServerUpdate('unknown', 'admin')).toBe(false)
  })
})
