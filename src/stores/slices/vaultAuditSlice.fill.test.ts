import { describe, expect, it } from 'vitest'
import { create, type StateCreator } from 'zustand'

import { createVaultAuditSlice, type VaultAuditSlice } from './vaultAuditSlice'

function store() {
  const creator = createVaultAuditSlice as unknown as StateCreator<VaultAuditSlice>
  return create<VaultAuditSlice>()((...args) => creator(...args))
}

const OUTCOME = { filled: 1, alreadySet: 1, refused: 0, heldByOther: 0, failed: 0 }

describe('vault audit fill state', () => {
  it('takes requested findings out of the selection and keeps the written ones as settled', () => {
    const audit = store()
    audit.getState().setVaultAuditFillSelection(['a', 'b', 'c'])
    audit.getState().startVaultAuditFill()
    expect(audit.getState().vaultAuditFill.applying).toBe(true)

    audit.getState().finishVaultAuditFill({
      requestedFindingIds: ['a', 'b'],
      settledFindingIds: ['a'],
      outcome: OUTCOME,
    })

    const fill = audit.getState().vaultAuditFill
    expect(fill.applying).toBe(false)
    expect([...fill.selectedFindingIds]).toEqual(['c'])
    expect([...fill.settledFindingIds]).toEqual(['a'])
    expect(fill.outcome).toEqual(OUTCOME)
  })

  it('forgets the receipt when the selection changes, and everything on a new run', () => {
    const audit = store()
    audit.getState().finishVaultAuditFill({
      requestedFindingIds: [],
      settledFindingIds: ['a'],
      outcome: OUTCOME,
    })
    audit.getState().setVaultAuditFillSelection(['b'])
    expect(audit.getState().vaultAuditFill.outcome).toBeNull()

    audit.getState().clearVaultAuditRun()
    expect([...audit.getState().vaultAuditFill.settledFindingIds]).toEqual([])
    expect([...audit.getState().vaultAuditFill.selectedFindingIds]).toEqual([])
  })
})
