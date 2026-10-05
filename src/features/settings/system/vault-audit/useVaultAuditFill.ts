/**
 * "Fill empty from file": write a part or assembly's own part number or description into an empty
 * BluePLM column, for the values an administrator approved.
 *
 * The same guarded writer as `restore-metadata-from-files`: one conditional UPDATE per value that
 * only lands while the column is still empty, no version, a skip for files another user holds
 * (checked again on the row at write time), and an activity entry. Fields the current user has an
 * unsaved edit for are never selectable, and are dropped again here in case the edit appeared
 * after they were ticked.
 */

import { useCallback, useMemo } from 'react'

import { t } from '@/lib/i18n'
import { log } from '@/lib/logger'
import { restoreStatesOf } from '@/lib/metadata/metadataRestorePlan'
import {
  fillEmptyFileMetadataBatch,
  type FillableMetadataField,
  type FillEmptyMetadataRequest,
} from '@/lib/supabase/files/fillEmptyMetadata'
import { usePDMStore } from '@/stores/pdmStore'
import type { VaultAuditFillOutcome, VaultAuditFinding } from '@/types/vaultAudit'

import { unsavedEditKeyOf } from './vaultAuditActions'

/** The approved values, grouped per file the way the writer takes them. */
export interface VaultAuditFillPlan {
  requests: FillEmptyMetadataRequest[]
  /** `${fileId}:${field}` to the finding it came from, to settle findings from the receipt. */
  findingIdByKey: Map<string, string>
  valueCount: number
}

function isFillableField(field: string): field is FillableMetadataField {
  return field === 'part_number' || field === 'description'
}

/**
 * Group the selected fill findings by file, leaving out anything a guard now refuses.
 *
 * Pure, so the guards can be pinned in a test without a store or a database.
 */
export function buildVaultAuditFillPlan(
  findings: readonly VaultAuditFinding[],
  selectedIds: ReadonlySet<string>,
  heldByOthers: ReadonlySet<string>,
  unsavedEdits: ReadonlySet<string>,
): VaultAuditFillPlan {
  const byFile = new Map<string, FillEmptyMetadataRequest>()
  const findingIdByKey = new Map<string, string>()
  let valueCount = 0

  for (const finding of findings) {
    if (!selectedIds.has(finding.id)) continue
    if (finding.resolution !== 'fill-empty-from-file') continue
    if (!isFillableField(finding.field)) continue
    const value = finding.repairValue?.trim()
    if (!value) continue
    if (heldByOthers.has(finding.fileId)) continue
    const key = unsavedEditKeyOf(finding.fileId, finding.field)
    if (unsavedEdits.has(key)) continue

    let request = byFile.get(finding.fileId)
    if (!request) {
      request = { fileId: finding.fileId, relativePath: finding.relativePath, values: {} }
      byFile.set(finding.fileId, request)
    }
    request.values[finding.field] = value
    findingIdByKey.set(key, finding.id)
    valueCount += 1
  }

  return { requests: [...byFile.values()], findingIdByKey, valueCount }
}

export interface UseVaultAuditFillResult {
  selectedIds: ReadonlySet<string>
  settledIds: ReadonlySet<string>
  /** `${fileId}:${field}` for every field the current user has an unsaved edit to. */
  unsavedEdits: ReadonlySet<string>
  /** What Apply would write right now, for the preview. */
  plan: VaultAuditFillPlan
  applying: boolean
  error: string | null
  outcome: VaultAuditFillOutcome | null
  isAdmin: boolean
  canApply: boolean
  setMany: (findingIds: readonly string[], selected: boolean) => void
  apply: () => Promise<void>
}

export function useVaultAuditFill(
  findings: readonly VaultAuditFinding[],
  heldByOthers: ReadonlySet<string>,
): UseVaultAuditFillResult {
  const loadedFiles = usePDMStore((state) => state.files)
  const user = usePDMStore((state) => state.user)
  const fill = usePDMStore((state) => state.vaultAuditFill)
  const setSelection = usePDMStore((state) => state.setVaultAuditFillSelection)
  const startFill = usePDMStore((state) => state.startVaultAuditFill)
  const finishFill = usePDMStore((state) => state.finishVaultAuditFill)
  const updateFilePdmData = usePDMStore((state) => state.updateFilePdmData)
  const addToast = usePDMStore((state) => state.addToast)

  const selectedIds = useMemo(() => new Set(fill.selectedFindingIds), [fill.selectedFindingIds])
  const settledIds = useMemo(() => new Set(fill.settledFindingIds), [fill.settledFindingIds])

  const unsavedEdits = useMemo(() => {
    const keys = new Set<string>()
    for (const [fileId, state] of restoreStatesOf(loadedFiles)) {
      for (const field of state.pendingFields) keys.add(unsavedEditKeyOf(fileId, field))
    }
    return keys
  }, [loadedFiles])

  const plan = useMemo(
    () => buildVaultAuditFillPlan(findings, selectedIds, heldByOthers, unsavedEdits),
    [findings, selectedIds, heldByOthers, unsavedEdits],
  )

  const isAdmin = user?.role === 'admin'

  const setMany = useCallback(
    (findingIds: readonly string[], shouldSelect: boolean) => {
      const next = new Set(fill.selectedFindingIds)
      for (const id of findingIds) {
        if (shouldSelect) next.add(id)
        else next.delete(id)
      }
      setSelection([...next])
    },
    [fill.selectedFindingIds, setSelection],
  )

  const apply = useCallback(async () => {
    if (usePDMStore.getState().vaultAuditFill.applying) return
    if (!user?.id || !isAdmin) {
      finishFill({
        requestedFindingIds: [],
        settledFindingIds: [],
        outcome: null,
        error: t('vaultAudit.fill.adminOnly'),
      })
      return
    }
    if (plan.requests.length === 0) return

    startFill()
    const receipt = await fillEmptyFileMetadataBatch(plan.requests, user.id)
    for (const { fileId, row } of receipt.updatedRows) updateFilePdmData(fileId, row)

    const settled = receipt.filledKeys
      .map((key) => plan.findingIdByKey.get(key))
      .filter((id): id is string => id !== undefined)
    const outcome: VaultAuditFillOutcome = {
      filled: receipt.filled,
      alreadySet: receipt.alreadySet,
      refused: receipt.refused,
      heldByOther: receipt.heldByOther.length,
      failed: receipt.failed.length,
    }
    const error =
      receipt.failed.length > 0
        ? receipt.failed.map((failure) => `${failure.relativePath}: ${failure.reason}`).join(' ')
        : null

    finishFill({
      requestedFindingIds: [...plan.findingIdByKey.values()],
      settledFindingIds: settled,
      outcome,
      error,
    })

    log.info('[VaultAudit]', 'Filled empty metadata from files', { ...outcome })
    if (receipt.filled > 0) {
      addToast(
        error || outcome.heldByOther > 0 || outcome.refused > 0 ? 'warning' : 'success',
        t('vaultAudit.fill.appliedToast', { count: receipt.filled }),
      )
    }
  }, [addToast, finishFill, isAdmin, plan, startFill, updateFilePdmData, user?.id])

  return {
    selectedIds,
    settledIds,
    unsavedEdits,
    plan,
    applying: fill.applying,
    error: fill.error,
    outcome: fill.outcome,
    isAdmin,
    canApply: isAdmin && !fill.applying && plan.valueCount > 0,
    setMany,
    apply,
  }
}
