/**
 * Turn findings into the rows the table draws, with everything about each row already decided.
 *
 * Pure so it can be run over thousands of synthetic findings in a test. The list used to build
 * these only for the first two hundred findings; it now builds them for the whole category, which
 * is what lets "select all" mean all. That is affordable because nothing here is expensive per
 * row - the string diff that highlights a conflict (`compareForDisplay`) is deliberately left to
 * the row component, so it runs for the handful of rows on screen and not for the whole list.
 */

import { t } from '@/lib/i18n'
import type { VaultAuditFinding } from '@/types/vaultAudit'

import {
  actionForFinding,
  repairCandidateIdOf,
  type VaultAuditRowAction,
} from './vaultAuditActions'
import type { VaultAuditFileAvailability } from './vaultAuditFileState'
import type { SelectionRowState } from './vaultAuditSelection'

export interface ConflictOption {
  available: boolean
  selected: boolean
  settled: boolean
  reason: string | null
}

/** One finding, with everything the table needs to draw it already decided. */
export interface VaultAuditFindingRow extends SelectionRowState {
  /** The finding's id, so a range can be taken over rows by id. */
  id: string
  finding: VaultAuditFinding
  action: VaultAuditRowAction
  /** Already written by an apply in this session. Shown, but not offered again. */
  settled: boolean
  /** Who can write this file today. Null for a finding whose file is not in the loaded list. */
  availability: VaultAuditFileAvailability | null
  /** The two explicit choices shown for a conflict row. */
  conflict: {
    useBluePlm: ConflictOption
    useFile: ConflictOption
  } | null
}

/** Everything about the session that decides what a row may do, as sets the builder can probe. */
export interface FindingRowContext {
  repairable: ReadonlySet<string>
  heldByOthers: ReadonlySet<string>
  unsavedEdits: ReadonlySet<string>
  repairSelected: ReadonlySet<string>
  repairSettled: ReadonlySet<string>
  pushSelected: ReadonlySet<string>
  pushWritten: ReadonlySet<string>
  fillSelected: ReadonlySet<string>
  fillSettled: ReadonlySet<string>
  conflictSelected: ReadonlySet<string>
  conflictSettled: ReadonlySet<string>
  availability: ReadonlyMap<string, VaultAuditFileAvailability>
  canAdoptFileValue: (finding: VaultAuditFinding) => boolean
  /** Non-null when the file's own value cannot be adopted because it is not loaded. */
  blockedReasonFor: (finding: VaultAuditFinding) => string | null
}

export function buildFindingRows(
  findings: readonly VaultAuditFinding[],
  context: FindingRowContext,
): VaultAuditFindingRow[] {
  // Translated once, not once per conflict row.
  let heldReason: string | null = null
  let notLoadedReason: string | null = null

  return findings.map((finding) => {
    const action = actionForFinding(
      finding,
      context.repairable,
      context.heldByOthers,
      context.unsavedEdits,
    )
    const candidateId = repairCandidateIdOf(finding)
    const isConflict = finding.resolution === 'choose-a-side'
    const isFill = finding.resolution === 'fill-empty-from-file'
    const toVault = !isConflict && action.available && action.kind === 'write-to-vault'
    const selectionId = isFill
      ? finding.id
      : toVault && candidateId
        ? candidateId
        : finding.fileId

    const selected = isFill
      ? context.fillSelected.has(finding.id)
      : isConflict
        ? context.pushSelected.has(finding.fileId) || context.conflictSelected.has(finding.id)
        : toVault
          ? context.repairSelected.has(selectionId)
          : context.pushSelected.has(selectionId)

    const settled = isFill
      ? context.fillSettled.has(finding.id)
      : isConflict
        ? context.pushWritten.has(finding.fileId) || context.conflictSettled.has(finding.id)
        : toVault
          ? context.repairSettled.has(selectionId)
          : context.pushWritten.has(selectionId)

    let conflict: VaultAuditFindingRow['conflict'] = null
    if (isConflict) {
      const held = context.heldByOthers.has(finding.fileId)
      if (held && heldReason === null) heldReason = t('vaultAudit.blocked.heldByAnotherUser')
      const fileChoiceBlocked = context.blockedReasonFor(finding)
      if (fileChoiceBlocked && notLoadedReason === null) {
        notLoadedReason = t('vaultAudit.blocked.fileNotLoaded')
      }

      conflict = {
        useBluePlm: {
          available: finding.field !== 'revision' && !held,
          selected: context.pushSelected.has(finding.fileId),
          settled: context.pushWritten.has(finding.fileId),
          reason: held ? heldReason : null,
        },
        useFile: {
          available: context.canAdoptFileValue(finding),
          selected: context.conflictSelected.has(finding.id),
          settled: context.conflictSettled.has(finding.id),
          reason: fileChoiceBlocked ? notLoadedReason : null,
        },
      }
    }

    return {
      id: finding.id,
      finding,
      action,
      selectionId,
      selected,
      settled,
      // Conflicts are resolved with their two buttons, never with the checkbox.
      selectable: !isConflict && action.available && !settled,
      availability: context.availability.get(finding.fileId) ?? null,
      conflict,
    }
  })
}