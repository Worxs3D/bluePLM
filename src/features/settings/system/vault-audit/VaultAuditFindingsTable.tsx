/**
 * The findings table.
 *
 * Presentational: it renders rows and reports clicks. Which rows may be ticked, what a tick means
 * and what happens when the button is pressed are all decided in `VaultAuditFindings`, because
 * they depend on which of the two writers covers the row and this component should not have an
 * opinion about that.
 *
 * ## It lists every row, and draws only the ones in view
 *
 * The list used to stop at two hundred rows so that the page stayed cheap. A category can hold
 * thousands of values and an administrator has to be able to see and select all of them, so the
 * cap is gone and the cost is paid differently: the rows live in a bounded scroll area and only
 * the ones inside it (plus a little overscan) are in the DOM. Row heights differ - a conflict row
 * carries two buttons and a blocked row carries a note - so each drawn row is measured.
 *
 * ## Three things this table does differently from an ordinary list
 *
 * **The value columns are built around the difference, not around the start of the string.** Two
 * descriptions that share their first thirty characters used to render as two identical truncated
 * cells, which made the conflict category unreadable and therefore unanswerable. The shared ends
 * are trimmed to a little context, the differing span is highlighted, and the full value is on the
 * title attribute. That comparison is computed per drawn row, never for the whole list.
 *
 * **A row with no checkbox says why.** An empty cell where other rows have a control reads as an
 * oversight; the reason is in the resolution column, which is where the row already explains
 * itself.
 *
 * **The header checkbox is a real tri-state control.** It ticks or clears every selectable row the
 * filter lets through - the whole list, not the viewport.
 */

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, ExternalLink } from 'lucide-react'

import { t } from '@/lib/i18n'
import type { VaultAuditFinding } from '@/types/vaultAudit'

import type { VaultAuditActionKind } from './vaultAuditActions'
import type { VaultAuditFileAvailability } from './vaultAuditFileState'
import {
  compareForDisplay,
  isTrivialDifference,
  type ValueSegments,
} from './valueDifference'
import {
  blockedReasonLabel,
  differenceLabel,
  fieldLabel,
  resolutionDirection,
  resolutionHint,
  resolutionLabel,
  unattributedReasonLabel,
} from './vaultAuditLabels'
import type { VaultAuditFindingRow } from './vaultAuditRows'
import type { FindingSort, FindingSortKey } from './vaultAuditSort'
import { useRevealInFileBrowser } from './useRevealInFileBrowser'

export type { ConflictOption, VaultAuditFindingRow } from './vaultAuditRows'

/** Same template for the header and every row, so the columns line up without a `<table>`. */
const GRID_COLUMNS =
  'grid grid-cols-[2rem_minmax(0,1.4fr)_6.5rem_6.5rem_minmax(0,1fr)_1.5rem_minmax(0,1fr)_10.5rem_2rem]'

const HEADER_HEIGHT_PX = 30
const ESTIMATED_ROW_HEIGHT_PX = 44
const OVERSCAN_ROWS = 10

interface VaultAuditFindingsTableProps {
  rows: VaultAuditFindingRow[]
  sort: FindingSort
  /** Changes whenever the list underneath is a different list, so the view returns to the top. */
  scrollResetKey: string
  disabled: boolean
  /** Header checkbox state, over the rows the filter lets through. */
  allSelected: boolean
  someSelected: boolean
  canSelectAny: boolean
  onSort: (key: FindingSortKey) => void
  onToggleAll: () => void
  onToggle: (row: VaultAuditFindingRow, shiftKey: boolean) => void
  onChooseConflict: (
    row: VaultAuditFindingRow,
    direction: Exclude<VaultAuditActionKind, 'fill-empty'>,
  ) => void
}

function ValueCell({ value, segments }: { value: string | null; segments: ValueSegments | null }) {
  if (value === null) {
    return <span className="text-plm-fg-muted/50">{t('vaultAudit.findings.empty')}</span>
  }

  if (!segments) {
    return (
      <span className="text-plm-fg break-words" title={value}>
        {value}
      </span>
    )
  }

  return (
    <span className="text-plm-fg-muted break-words" title={value}>
      {segments.elidedStart && '…'}
      {segments.head}
      {/* One value being a prefix of the other leaves nothing to highlight, and an unmarked cell
          would read as no difference at all. The marker stands in for the missing span. */}
      {segments.middle === '' ? (
        <mark className="inline-block w-1 h-3 align-middle bg-plm-warning/50 rounded-sm" />
      ) : (
        <mark className="bg-plm-warning/25 text-plm-fg rounded-sm px-0.5">{segments.middle}</mark>
      )}
      {segments.tail}
      {segments.elidedEnd && '…'}
    </span>
  )
}

/**
 * Naming the colleague where the row knows the name.
 *
 * "Someone else has it" tells the reader the row is blocked and nothing about what to do next;
 * a name is what turns it into a message they can act on.
 */
function heldByLabel(availability: VaultAuditFileAvailability | null): string {
  const holder = availability?.state === 'held-by-other' ? availability.holder : null
  return holder
    ? t('vaultAudit.blocked.heldBy', { user: holder })
    : t('vaultAudit.blocked.heldByAnotherUser')
}

function DirectionCell({ finding }: { finding: VaultAuditFinding }) {
  const direction = resolutionDirection(finding.resolution)
  if (!direction) return null

  const Icon = direction === 'file-to-vault' ? ArrowLeft : ArrowRight
  return (
    <span
      className="flex justify-center text-plm-accent"
      title={resolutionHint(finding.resolution)}
    >
      <Icon size={12} />
    </span>
  )
}

/** The folder dimmed and the file name leading, with the whole path on hover. */
function PathCell({ relativePath }: { relativePath: string }) {
  const split = Math.max(relativePath.lastIndexOf('\\'), relativePath.lastIndexOf('/'))
  const folder = split === -1 ? '' : relativePath.slice(0, split + 1)
  const name = relativePath.slice(split + 1)

  return (
    <span className="block truncate font-mono" title={relativePath}>
      <span className="text-plm-fg">{name}</span>
      {folder && <span className="block truncate text-plm-fg-muted/70 text-[11px]">{folder}</span>}
    </span>
  )
}

function SortHeader({
  label,
  sortKey,
  sort,
  onSort,
}: {
  label: string
  sortKey: FindingSortKey
  sort: FindingSort
  onSort: (key: FindingSortKey) => void
}) {
  const active = sort.key === sortKey
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      title={t('vaultAudit.findings.sortBy', { column: label })}
      className={`flex items-center gap-1 text-left hover:text-plm-fg transition-colors ${
        active ? 'text-plm-fg' : ''
      }`}
    >
      {label}
      {active && (sort.direction === 'asc' ? <ArrowUp size={10} /> : <ArrowDown size={10} />)}
    </button>
  )
}

function ConflictButton({
  label,
  hint,
  selected,
  disabled,
  onClick,
}: {
  label: string
  hint: string
  selected: boolean
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      title={hint}
      className={`px-1.5 py-0.5 rounded border transition-colors disabled:opacity-40 ${
        selected
          ? 'border-plm-accent bg-plm-accent/20 text-plm-accent'
          : 'border-plm-border text-plm-fg-muted hover:text-plm-fg hover:bg-plm-bg-lighter'
      }`}
    >
      {label}
    </button>
  )
}

interface FindingRowViewProps {
  row: VaultAuditFindingRow
  index: number
  disabled: boolean
  localPath: string | null
  onReveal: (relativePath: string) => void
  onToggle: VaultAuditFindingsTableProps['onToggle']
  onChooseConflict: VaultAuditFindingsTableProps['onChooseConflict']
}

function FindingRowView({
  row,
  index,
  disabled,
  localPath,
  onReveal,
  onToggle,
  onChooseConflict,
}: FindingRowViewProps) {
  const { finding } = row
  const isConflict = finding.resolution === 'choose-a-side'

  // The string diff is the one per-row cost worth deferring, and it is why this runs here.
  const comparison = useMemo(
    () => compareForDisplay(finding.databaseValue, finding.fileValue),
    [finding.databaseValue, finding.fileValue],
  )
  const trivialNote =
    comparison && isTrivialDifference(comparison.kind) ? differenceLabel(comparison.kind) : null

  return (
    <div
      role="row"
      aria-rowindex={index + 2}
      className={`${GRID_COLUMNS} border-t border-plm-border/60 items-start text-xs ${
        row.selected && !row.settled ? 'bg-plm-highlight/40' : ''
      }`}
    >
      <div role="cell" className="px-2 py-1.5">
        {row.settled ? (
          <Check
            size={12}
            className="text-plm-success"
            aria-label={t('vaultAudit.findings.settled')}
          />
        ) : row.selectable ? (
          <input
            type="checkbox"
            checked={row.selected}
            disabled={disabled}
            onChange={() => undefined}
            onClick={(event) => onToggle(row, event.shiftKey)}
            className="accent-plm-accent"
            aria-label={resolutionLabel(finding.resolution)}
          />
        ) : null}
      </div>
      <div role="cell" className="px-2 py-1.5 min-w-0">
        <PathCell relativePath={finding.relativePath} />
      </div>
      <div role="cell" className="px-2 py-1.5 text-plm-fg-muted truncate min-w-0">
        {finding.configuration ?? t('vaultAudit.findings.fileScope')}
      </div>
      <div role="cell" className="px-2 py-1.5 text-plm-fg-muted min-w-0">
        {fieldLabel(finding.field)}
        {finding.unattributedReason && (
          <span className="block text-plm-fg-muted/70">
            {unattributedReasonLabel(finding.unattributedReason)}
          </span>
        )}
      </div>
      <div role="cell" className="px-2 py-1.5 min-w-0">
        <ValueCell value={finding.databaseValue} segments={comparison?.database ?? null} />
      </div>
      <div role="cell" className="py-1.5">
        <DirectionCell finding={finding} />
      </div>
      <div role="cell" className="px-2 py-1.5 min-w-0">
        <ValueCell value={finding.fileValue} segments={comparison?.file ?? null} />
      </div>
      <div role="cell" className="px-2 py-1.5 text-plm-fg min-w-0">
        <span title={resolutionHint(finding.resolution)}>{resolutionLabel(finding.resolution)}</span>
        {isConflict && row.conflict && (
          <div className="mt-1 flex flex-wrap gap-1">
            {finding.field !== 'revision' && (
              <ConflictButton
                label={t('vaultAudit.conflict.useBluePlm')}
                hint={
                  row.conflict.useBluePlm.reason ?? t('vaultAudit.resolution.pushVaultValueHint')
                }
                selected={row.conflict.useBluePlm.selected}
                disabled={
                  disabled ||
                  row.conflict.useBluePlm.settled ||
                  !row.conflict.useBluePlm.available
                }
                onClick={() => onChooseConflict(row, 'write-to-file')}
              />
            )}
            <ConflictButton
              label={t('vaultAudit.conflict.useFile')}
              hint={row.conflict.useFile.reason ?? t('vaultAudit.resolution.adoptFileValueHint')}
              selected={row.conflict.useFile.selected}
              disabled={
                disabled || row.conflict.useFile.settled || !row.conflict.useFile.available
              }
              onClick={() => onChooseConflict(row, 'write-to-vault')}
            />
          </div>
        )}
        {!row.action.available && (
          <span className="block text-plm-fg-muted/70">
            {row.action.reason === 'held-by-another-user'
              ? heldByLabel(row.availability)
              : blockedReasonLabel(row.action.reason)}
          </span>
        )}
        {trivialNote && <span className="block text-plm-warning/80">{trivialNote}</span>}
      </div>
      <div role="cell" className="px-2 py-1.5">
        <div className="flex items-center gap-1 justify-end">
          <button
            onClick={() => onReveal(finding.relativePath)}
            disabled={!localPath}
            title={
              localPath
                ? t('vaultAudit.findings.reveal')
                : t('vaultAudit.findings.revealUnavailable')
            }
            className="p-1 rounded text-plm-fg-muted hover:text-plm-fg hover:bg-plm-bg-lighter transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <ExternalLink size={12} />
          </button>
        </div>
      </div>
    </div>
  )
}

export function VaultAuditFindingsTable({
  rows,
  sort,
  scrollResetKey,
  disabled,
  allSelected,
  someSelected,
  canSelectAny,
  onSort,
  onToggleAll,
  onToggle,
  onChooseConflict,
}: VaultAuditFindingsTableProps) {
  const { resolve, reveal } = useRevealInFileBrowser()
  const scrollRef = useRef<HTMLDivElement>(null)
  const headerCheckboxRef = useRef<HTMLInputElement>(null)

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT_PX,
    overscan: OVERSCAN_ROWS,
    scrollMargin: HEADER_HEIGHT_PX,
    // Keyed by finding, so a sort or a filter does not hand one row's measured height to another.
    getItemKey: (index) => rows[index]?.id ?? index,
  })

  // `indeterminate` has no attribute; it can only be set on the element.
  useLayoutEffect(() => {
    if (headerCheckboxRef.current) headerCheckboxRef.current.indeterminate = someSelected
  }, [someSelected])

  // A different list starts at its top. Staying at row nine hundred of a list that now has twelve
  // rows reads as an empty table.
  useEffect(() => {
    virtualizer.scrollToOffset(0)
    // The virtualizer instance is stable; the key is the only thing that should trigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollResetKey])

  return (
    <div
      ref={scrollRef}
      role="table"
      aria-rowcount={rows.length + 1}
      className="border border-plm-border rounded-md overflow-auto max-h-[60vh] min-h-[12rem] bg-plm-bg"
    >
      <div className="min-w-[52rem]">
        <div
          role="row"
          aria-rowindex={1}
          style={{ height: HEADER_HEIGHT_PX }}
          className={`${GRID_COLUMNS} sticky top-0 z-10 items-center text-xs bg-plm-bg-lighter text-plm-fg-muted border-b border-plm-border`}
        >
          <div role="columnheader" className="px-2">
            <input
              ref={headerCheckboxRef}
              type="checkbox"
              checked={allSelected}
              disabled={disabled || !canSelectAny}
              onChange={() => undefined}
              onClick={onToggleAll}
              className="accent-plm-accent"
              aria-label={t('vaultAudit.findings.selectAllRows')}
              title={t('vaultAudit.findings.selectAllRows')}
            />
          </div>
          <div
            role="columnheader"
            className="px-2"
            aria-sort={sort.key === 'file' ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
          >
            <SortHeader
              label={t('vaultAudit.findings.columnFile')}
              sortKey="file"
              sort={sort}
              onSort={onSort}
            />
          </div>
          <div role="columnheader" className="px-2">
            <SortHeader
              label={t('vaultAudit.findings.columnConfiguration')}
              sortKey="configuration"
              sort={sort}
              onSort={onSort}
            />
          </div>
          <div role="columnheader" className="px-2">
            <SortHeader
              label={t('vaultAudit.findings.columnField')}
              sortKey="field"
              sort={sort}
              onSort={onSort}
            />
          </div>
          <div role="columnheader" className="px-2">
            {t('vaultAudit.findings.columnDatabase')}
          </div>
          <div role="columnheader" />
          <div role="columnheader" className="px-2">
            {t('vaultAudit.findings.columnFile2')}
          </div>
          <div role="columnheader" className="px-2">
            <SortHeader
              label={t('vaultAudit.findings.columnResolution')}
              sortKey="resolution"
              sort={sort}
              onSort={onSort}
            />
          </div>
          <div role="columnheader" />
        </div>

        {/* The virtualizer's total already excludes the header offset it was given. */}
        <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index]
            if (!row) return null

            return (
              <div
                key={virtualRow.key}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                className="absolute left-0 top-0 w-full"
                style={{
                  transform: `translateY(${virtualRow.start - virtualizer.options.scrollMargin}px)`,
                }}
              >
                <FindingRowView
                  row={row}
                  index={virtualRow.index}
                  disabled={disabled}
                  localPath={resolve(row.finding.relativePath)}
                  onReveal={reveal}
                  onToggle={onToggle}
                  onChooseConflict={onChooseConflict}
                />
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
