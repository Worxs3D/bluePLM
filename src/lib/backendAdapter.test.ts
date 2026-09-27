import { beforeEach, describe, expect, it, vi } from 'vitest'

import { activateBackend, clearBackendProfile } from './backend'
import {
  activeBackendSupports,
  activeBackendSupportsSettingsTab,
  mapMdbRole,
  routeBackend,
} from './backendAdapter'

const storage = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
  clear: () => storage.clear(),
})

describe('backend capabilities', () => {
  beforeEach(() => {
    localStorage.clear()
    clearBackendProfile()
  })

  it('exposes SOLIDWORKS license management in MDB mode through its adapter', () => {
    activateBackend('community')

    expect(activeBackendSupports('solidworks-license-management')).toBe(true)
  })

  it('keeps SOLIDWORKS license management available in Supabase mode', () => {
    activateBackend('supabase')

    expect(activeBackendSupports('solidworks-license-management')).toBe(true)
  })

  it('exposes only settings with an MDB implementation in community mode', () => {
    activateBackend('community')

    expect(activeBackendSupportsSettingsTab('item-designations')).toBe(true)
    expect(activeBackendSupportsSettingsTab('recovery-codes')).toBe(true)
    expect(activeBackendSupportsSettingsTab('delete-account')).toBe(true)
    expect(activeBackendSupportsSettingsTab('module-access')).toBe(true)
    expect(activeBackendSupportsSettingsTab('auth-providers')).toBe(true)
    expect(activeBackendSupportsSettingsTab('serialization')).toBe(true)
    expect(activeBackendSupportsSettingsTab('export')).toBe(true)
    expect(activeBackendSupportsSettingsTab('rfq')).toBe(true)
    expect(activeBackendSupportsSettingsTab('metadata-columns')).toBe(true)
    expect(activeBackendSupportsSettingsTab('profile')).toBe(false)
  })

  it('keeps the complete settings surface available in Supabase mode', () => {
    activateBackend('supabase')

    expect(activeBackendSupportsSettingsTab('item-designations')).toBe(true)
    expect(activeBackendSupportsSettingsTab('profile')).toBe(true)
    expect(activeBackendSupportsSettingsTab('recovery-codes')).toBe(true)
  })

  it('maps MDB viewer and guest accounts to the least-privileged client role', () => {
    expect(mapMdbRole('owner')).toBe('admin')
    expect(mapMdbRole('admin')).toBe('admin')
    expect(mapMdbRole('member')).toBe('engineer')
    expect(mapMdbRole('viewer')).toBe('viewer')
    expect(mapMdbRole('guest')).toBe('viewer')
    expect(mapMdbRole('unexpected')).toBeNull()
  })

  it('executes only the selected backend implementation', () => {
    const mdb = vi.fn(() => 'mdb')
    const supabase = vi.fn(() => 'supabase')
    activateBackend('community')

    expect(routeBackend({ mdb, supabase })).toBe('mdb')
    expect(mdb).toHaveBeenCalledOnce()
    expect(supabase).not.toHaveBeenCalled()
  })
})
