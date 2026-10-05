/**
 * The guards in front of "Fill empty from file": which findings offer the fill, and what the plan
 * built from a selection would actually write.
 */

import { describe, expect, it, vi } from 'vitest'

import type { VaultAuditFinding } from '@/types/vaultAudit'

import { buildVaultAuditFillPlan } from './useVaultAuditFill'
import { actionForFinding, categoryDirectionOf, unsavedEditKeyOf } from './vaultAuditActions'

vi.mock('@/stores/pdmStore', () => ({ usePDMStore: () => undefined }))

const NONE = new Set<string>()

function fillFinding(overrides: Partial<VaultAuditFinding> = {}): VaultAuditFinding {
  return {
    id: 'f1:file:part_number',
    kind: 'empty-in-database',
    resolution: 'fill-empty-from-file',
    fileId: 'f1',
    relativePath: 'ELEC/FATHOM-X-ELEC-PCB-R1.SLDPRT',
    fileName: 'FATHOM-X-ELEC-PCB-R1.SLDPRT',
    fileType: 'part',
    field: 'part_number',
    scope: 'file',
    configuration: null,
    databaseValue: null,
    fileValue: 'FATHOM-X-ELEC-PCB-R1',
    repairValue: 'FATHOM-X-ELEC-PCB-R1',
    unattributedReason: null,
    ...overrides,
  }
}

const description = fillFinding({
  id: 'f1:file:description',
  field: 'description',
  fileValue: 'Main PCB',
  repairValue: 'Main PCB',
})

describe('actionForFinding - fill empty from file', () => {
  it('offers the fill for a value the file holds and BluePLM does not', () => {
    expect(actionForFinding(fillFinding(), NONE)).toEqual({ available: true, kind: 'fill-empty' })
    expect(categoryDirectionOf([fillFinding()])).toBe('fill-empty')
  })

  it('refuses a file someone else has checked out', () => {
    expect(actionForFinding(fillFinding(), NONE, new Set(['f1']))).toEqual({
      available: false,
      reason: 'held-by-another-user',
    })
  })

  it('refuses a field the user has an unsaved edit to, and only that field', () => {
    const unsaved = new Set([unsavedEditKeyOf('f1', 'part_number')])
    expect(actionForFinding(fillFinding(), NONE, NONE, unsaved)).toEqual({
      available: false,
      reason: 'unsaved-local-edit',
    })
    expect(actionForFinding(description, NONE, NONE, unsaved)).toEqual({
      available: true,
      kind: 'fill-empty',
    })
  })
})

describe('buildVaultAuditFillPlan', () => {
  const findings = [fillFinding(), description]
  const both = new Set(findings.map((finding) => finding.id))

  it('groups the selected values per file, the way the writer takes them', () => {
    const plan = buildVaultAuditFillPlan(findings, both, NONE, NONE)
    expect(plan.valueCount).toBe(2)
    expect(plan.requests).toEqual([
      {
        fileId: 'f1',
        relativePath: 'ELEC/FATHOM-X-ELEC-PCB-R1.SLDPRT',
        values: { part_number: 'FATHOM-X-ELEC-PCB-R1', description: 'Main PCB' },
      },
    ])
    expect(plan.findingIdByKey.get('f1:description')).toBe('f1:file:description')
  })

  it('writes nothing that was not selected', () => {
    const plan = buildVaultAuditFillPlan(findings, new Set(['f1:file:description']), NONE, NONE)
    expect(plan.requests[0].values).toEqual({ description: 'Main PCB' })
  })

  it('drops a held file and an unsaved field even if they were ticked before', () => {
    expect(buildVaultAuditFillPlan(findings, both, new Set(['f1']), NONE).valueCount).toBe(0)
    const plan = buildVaultAuditFillPlan(
      findings,
      both,
      NONE,
      new Set([unsavedEditKeyOf('f1', 'description')]),
    )
    expect(plan.requests[0].values).toEqual({ part_number: 'FATHOM-X-ELEC-PCB-R1' })
  })

  it('ignores findings of other kinds and blank values', () => {
    const other = fillFinding({ id: 'x', resolution: 'adopt-file-value', kind: 'recoverable' })
    const blank = fillFinding({ id: 'y', repairValue: '   ' })
    const plan = buildVaultAuditFillPlan([other, blank], new Set(['x', 'y']), NONE, NONE)
    expect(plan.valueCount).toBe(0)
    expect(plan.requests).toEqual([])
  })
})
