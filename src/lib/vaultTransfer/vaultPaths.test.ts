import { describe, expect, it } from 'vitest'

import { vaultFoldersOverlap } from './vaultPaths'

describe('vaultFoldersOverlap', () => {
  it('sees the same folder however it is spelled', () => {
    expect(vaultFoldersOverlap('C:\\Vaults\\Main', 'c:/vaults/main/')).toBe(true)
  })

  it('sees one folder inside the other, in either direction', () => {
    expect(vaultFoldersOverlap('C:\\Vaults', 'C:\\Vaults\\Main')).toBe(true)
    expect(vaultFoldersOverlap('C:\\Vaults\\Main', 'C:\\Vaults')).toBe(true)
  })

  it('does not treat a shared name prefix as containment', () => {
    expect(vaultFoldersOverlap('C:\\Vaults\\Main', 'C:\\Vaults\\Main2')).toBe(false)
    expect(vaultFoldersOverlap('C:\\Vaults\\Main', 'D:\\Vaults\\Main')).toBe(false)
  })

  it('has no opinion about a vault with no folder', () => {
    expect(vaultFoldersOverlap('', 'C:\\Vaults\\Main')).toBe(false)
    expect(vaultFoldersOverlap('C:\\Vaults\\Main', '')).toBe(false)
  })
})
