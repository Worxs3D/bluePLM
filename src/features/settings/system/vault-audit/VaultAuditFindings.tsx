/**
 * One category's findings, and the button that resolves them.
 *
 * This used to be a read-only list with a separate repair panel underneath it, and the two were
 * different views of overlapping data: the panel had checkboxes the list did not, over a subset of
 * the same values, with nothing on screen explaining the relationship. Selecting a category and
 * acting on it are the same task, so they are now the same section, and the repair panel is what
 * this renders when the category selected is the one it always covered.
 *
 * ## What a tick means depends on the direction, and that is not smoothed over
 *
 * The database writer works per value; the document writer is the Sync Metadata command and works
 * per file. So in a `write-to-file` category, ticking any row of a file selects that whole file,
 * and every row belonging to it ticks with it. Rendering those rows as individually selectable
 * would promise a precision the command does not have.
 *
 * ## Rows that cannot be acted on are still rows
 *
 * A category is one resolution, but not every row in it has a writer - a recoverable value in a
 * column rather than in a reserved map has nowhere to go until something writes columns. Those
 * stay in the table with no checkbox and a line saying why, rather than being filtered out, so the
 * count on the category card and the count in the table agree.
 *
 * ## Every row is here, and "all" means all of them
 *
 * The list used to be cut at two hundred rows, and select-all, shift-click and the footer count
 * were all computed from the cut. A category of twelve hundred values could neither be read nor
 * selected in full. Rows are now built for the whole category and drawn lazily by the table;
 * "select all" covers every selectable row the filter lets through, so what the button writes is
 * still what the administrator could see by scrolling, and the selection summary says so.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'

import { t } from '@/lib/i18n'
import type { VaultAuditCategoryKind, VaultAuditFinding } from '@/types/vaultAudit'

import { rangeBetween } from './repairSelection'
import { VaultAuditConflictActionBar } from './VaultAuditConflictActionBar'
import { useVaultAuditPush } from './useVaultAuditPush'
import { useVaultAuditConflict } from './useVaultAuditConflict'
import { useVaultAuditRepair } from './useVaultAuditRepair'
import { useVaultAuditFill } from './useVaultAuditFill'
import { VaultAuditActionBar } from './VaultAuditActionBar'
import { VaultAuditFillActionBar } from './VaultAuditFillActionBar'
import { VaultAuditFindingsTable } from './VaultAuditFindingsTable'
import { VaultAuditSelectionBar } from './VaultAuditSelectionBar'
import { categoryDirectionOf } from './vaultAuditActions'
import { buildFindingRows, type VaultAuditFindingRow } from './vaultAuditRows'
import {
  hiddenSelectedRows,
  selectionChangeFor,
  summarizeSelection,
  type SelectionMode,
} from './vaultAuditSelection'
import {
  DEFAULT_FINDING_SORT,
  nextSort,
  sortFindings,
  type FindingSort,
  type FindingSortKey,
} from './vaultAuditSort'

interface VaultAuditFindingsProps {
  findings: VaultAuditFinding[]
  kind: VaultAuditCategoryKind | null
}

/** How long typing pauses before the filter is applied, so a long list is not re-filtered per key. */
const FILTER_DEBOUNCE_MS = 150

function haystackOf(finding: VaultAuditFinding): string {
  return [
    finding.relativePath,
    finding.configuration ?? '',
    finding.databaseValue ?? '',
    finding.fileValue ?? '',
  ]
    .join(' ')
    .toLowerCase()
}

export function VaultAuditFindings({ findings, kind }: VaultAuditFindingsProps) {
  const [filterInput, setFilterInput] = useState('')
  const [filter, setFilter] = useState('')
  const [actionableOnly, setActionableOnly] = useState(false)
  const [sort, setSort] = useState<FindingSort>(DEFAULT_FINDING_SORT)
  const anchorId = useRef<string | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => setFilter(filterInput), FILTER_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [filterInput])

  // A different category is a different list: an anchor from the last one points at nothing.
  useEffect(() => {
    anchorId.current = null
  }, [kind])

  const repair = useVaultAuditRepair()
  const push = useVaultAuditPush(findings)
  const conflict = useVaultAuditConflict(findings)
  const fill = useVaultAuditFill(findings, push.heldByOthers)
  const { blockedReasonFor, canAdoptFileValue } = conflict

  // The proposal decides what may be written into a reserved map, and it knows two things a
  // finding does not: whether the row already carries a key for that configuration, and whether
  // derived tabs are being offered. Reduced to a set of ids so the table can ask per row.
  const repairable = useMemo(
    () => new Set(repair.candidates.map((candidate) => candidate.id)),
    [repair.candidates],
  )

  const inCategory = useMemo(
    () => (kind ? findings.filter((finding) => finding.kind === kind) : []),
    [findings, kind],
  )

  // The direction, not the availability. A category whose every file is checked out to a colleague
  // still writes into files, and the action bar has to say so rather than going blank.
  const action = useMemo(() => categoryDirectionOf(inCategory), [inCategory])

  const sorted = useMemo(() => sortFindings(inCategory, sort), [inCategory, sort])

  // Lower-cased once per category, not once per keystroke per finding.
  const haystacks = useMemo(() => {
    const map = new Map<string, string>()
    for (const finding of inCategory) map.set(finding.id, haystackOf(finding))
    return map
  }, [inCategory])

  // Every row of the category, whether or not the filter lets it through. The hidden-selection
  // count needs the rows the filter removed.
  const allRows = useMemo<VaultAuditFindingRow[]>(
    () =>
      buildFindingRows(sorted, {
        repairable,
        heldByOthers: push.heldByOthers,
        unsavedEdits: fill.unsavedEdits,
        repairSelected: repair.selectedIds,
        repairSettled: repair.settledIds,
        pushSelected: push.selectedFileIds,
        pushWritten: push.writtenFileIds,
        fillSelected: fill.selectedIds,
        fillSettled: fill.settledIds,
        conflictSelected: conflict.selectedFindingIds,
        conflictSettled: conflict.settledFindingIds,
        availability: push.availability,
        canAdoptFileValue,
        blockedReasonFor,
      }),
    [
      sorted,
      repairable,
      push.heldByOthers,
      push.selectedFileIds,
      push.writtenFileIds,
      push.availability,
      fill.unsavedEdits,
      fill.selectedIds,
      fill.settledIds,
      repair.selectedIds,
      repair.settledIds,
      conflict.selectedFindingIds,
      conflict.settledFindingIds,
      canAdoptFileValue,
      blockedReasonFor,
    ],
  )

  const visibleRows = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    if (!needle && !actionableOnly) return allRows
    return allRows.filter((row) => {
      if (actionableOnly && !row.selectable) return false
      return !needle || (haystacks.get(row.id) ?? '').includes(needle)
    })
  }, [allRows, haystacks, filter, actionableOnly])

  const summary = useMemo(() => summarizeSelection(allRows, visibleRows), [allRows, visibleRows])

  const busy = repair.applying || push.running || conflict.applying || fill.applying

  const applySelection = (targets: readonly VaultAuditFindingRow[], selected: boolean) => {
    const toVault = targets.filter(
      (row) => row.action.available && row.action.kind === 'write-to-vault',
    )
    const toFile = targets.filter(
      (row) => row.action.available && row.action.kind === 'write-to-file',
    )
    const toFill = targets.filter(
      (row) => row.action.available && row.action.kind === 'fill-empty',
    )

    if (toFill.length > 0) {
      fill.setMany(
        toFill.map((row) => row.selectionId),
        selected,
      )
    }
    if (toVault.length > 0) {
      repair.setMany(
        toVault.map((row) => row.selectionId),
        selected,
      )
    }
    if (toFile.length > 0) {
      push.setManyFiles(
        toFile.map((row) => row.selectionId),
        selected,
      )
    }
  }

  const applyBulk = (mode: SelectionMode) => {
    const change = selectionChangeFor(visibleRows, mode)
    if (change.deselect.length > 0) applySelection(change.deselect, false)
    if (change.select.length > 0) applySelection(change.select, true)
  }

  const clearHidden = () => applySelection(hiddenSelectedRows(allRows, visibleRows), false)

  const handleToggle = (row: VaultAuditFindingRow, shiftKey: boolean) => {
    const selected = !row.selected

    if (shiftKey) {
      // Over every row the filter lets through, in the order they are displayed - not over what
      // happens to be drawn, which is why a range can span hundreds of rows.
      const span = rangeBetween(
        visibleRows.map((candidate) => candidate.id),
        anchorId.current,
        row.id,
      )
      if (span) {
        const spanIds = new Set(span)
        applySelection(
          visibleRows.filter((candidate) => spanIds.has(candidate.id) && candidate.selectable),
          selected,
        )
        anchorId.current = row.id
        return
      }
    }

    applySelection([row], selected)
    anchorId.current = row.id
  }

  const handleSort = (key: FindingSortKey) => setSort((current) => nextSort(current, key))

  const handleConflictChoice = (
    row: VaultAuditFindingRow,
    direction: 'write-to-file' | 'write-to-vault',
  ) => {
    if (!row.conflict) return

    if (direction === 'write-to-file') {
      if (row.finding.field === 'revision') return
      const selected = row.conflict.useBluePlm.selected
      const fileConflictIds = inCategory
        .filter(
          (finding) =>
            finding.resolution === 'choose-a-side' && finding.fileId === row.finding.fileId,
        )
        .map((finding) => finding.id)
      conflict.setMany(fileConflictIds, false)
      push.setManyFiles([row.finding.fileId], !selected)
      return
    }

    const selected = row.conflict.useFile.selected
    push.setManyFiles([row.finding.fileId], false)
    conflict.setMany([row.finding.id], !selected)
  }

  if (!kind) {
    return <p className="text-xs text-plm-fg-muted">{t('vaultAudit.findings.selectPrompt')}</p>
  }

  const unit =
    action === 'write-to-file'
      ? t('vaultAudit.findings.unitFiles')
      : t('vaultAudit.findings.unitValues')
  const filtering = filter.trim() !== '' || actionableOnly
  const actionableTotal = allRows.filter((row) => row.selectable).length

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-plm-fg">{t('vaultAudit.findings.heading')}</h3>
        <div className="flex items-center gap-3">
          {actionableTotal > 0 && actionableTotal < allRows.length && (
            <label
              className="flex items-center gap-1.5 text-xs text-plm-fg-muted cursor-pointer"
              title={t('vaultAudit.findings.actionableOnlyHint')}
            >
              <input
                type="checkbox"
                checked={actionableOnly}
                onChange={(event) => setActionableOnly(event.target.checked)}
                className="accent-plm-accent"
              />
              {t('vaultAudit.findings.actionableOnly')}
            </label>
          )}
          <div className="relative">
            <input
              type="text"
              value={filterInput}
              placeholder={t('vaultAudit.findings.filterPlaceholder')}
              onChange={(event) => setFilterInput(event.target.value)}
              className="w-64 pl-2 pr-7 py-1 text-xs bg-plm-bg border border-plm-border rounded text-plm-fg outline-none focus:border-plm-accent"
            />
            {filterInput && (
              <button
                type="button"
                onClick={() => {
                  setFilterInput('')
                  setFilter('')
                }}
                title={t('vaultAudit.findings.clearFilter')}
                aria-label={t('vaultAudit.findings.clearFilter')}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-plm-fg-muted hover:text-plm-fg"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>
      </div>

      <p className="text-xs text-plm-fg-muted">{t('vaultAudit.findings.directionNote')}</p>

      {inCategory.length === 0 && (
        <p className="text-xs text-plm-fg-muted">{t('vaultAudit.findings.none')}</p>
      )}

      {inCategory.length > 0 && visibleRows.length === 0 && (
        <p className="text-xs text-plm-fg-muted">{t('vaultAudit.findings.noMatches')}</p>
      )}

      {inCategory.length > 0 && (
        <VaultAuditSelectionBar
          summary={summary}
          unit={unit}
          disabled={busy}
          onSelectAll={() => applyBulk('select-all')}
          onClear={() => applyBulk('clear')}
          onInvert={() => applyBulk('invert')}
          onClearHidden={clearHidden}
        />
      )}

      {visibleRows.length > 0 && (
        <>
          <VaultAuditFindingsTable
            rows={visibleRows}
            sort={sort}
            scrollResetKey={`${kind}|${filter}|${actionableOnly}|${sort.key}|${sort.direction}`}
            disabled={busy}
            allSelected={summary.allSelected}
            someSelected={summary.someSelected}
            canSelectAny={summary.selectableUnits > 0}
            onSort={handleSort}
            onToggleAll={() => applyBulk(summary.allSelected ? 'clear' : 'select-all')}
            onToggle={handleToggle}
            onChooseConflict={handleConflictChoice}
          />

          <p className="text-xs text-plm-fg-muted">
            {filtering
              ? t('vaultAudit.findings.showing', {
                  shown: visibleRows.length,
                  total: allRows.length,
                })
              : t('vaultAudit.findings.total', { count: allRows.length })}
            {summary.selectableUnits > 1 && <> {t('vaultAudit.findings.rangeHint')}</>}
          </p>

          {/* Stays at the bottom of the scrolling settings area, so the button and the count of
              what it will write are in reach however far down the list the reader has gone. */}
          <div className="sticky bottom-0 z-20 -mx-1 px-1 pt-2 pb-1 bg-plm-bg border-t border-plm-border max-h-[45vh] overflow-y-auto">
            {kind === 'conflicting' ? (
              <VaultAuditConflictActionBar conflict={conflict} push={push} />
            ) : kind === 'empty-in-database' ? (
              <VaultAuditFillActionBar fill={fill} />
            ) : (
              <VaultAuditActionBar action={action} repair={repair} push={push} />
            )}
          </div>
        </>
      )}
    </section>
  )
}
