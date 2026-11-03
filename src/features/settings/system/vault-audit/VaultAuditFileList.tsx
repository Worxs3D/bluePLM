/**
 * The findings list, drawn like the file browser: a heading row per file, its values underneath.
 *
 * Presentational: it renders rows and reports clicks. Which rows may be ticked, what a tick means
 * and what happens when the button is pressed are all decided in `VaultAuditFindings`, because
 * they depend on which of the two writers covers the row and this component should not have an
 * opinion about that.
 *
 * ## Why grouped, and why values wrap
 *
 * The flat table repeated the path on every value and split the width nine ways, so descriptions
 * were cut to a few words and a file with six findings read as six unrelated rows. The file now
 * appears once, with its icon and folder, and each value row gives BluePLM's value and the file's
 * value half the width each. Values wrap over as many lines as they need and are never cut; the
 * span that differs is highlighted inside the whole value (`compareForDisplay` in `full` mode).
 *
 * ## It lists every row, and draws only the ones in view
 *
 * A category can hold thousands of values and an administrator has to be able to see and select
 * all of them, so the rows live in a bounded scroll area and only the ones inside it (plus a
 * little overscan) are in the DOM. Row heights differ - a wrapped description, a conflict row with
 * two buttons, a file heading - so each drawn row is measured.
 *
 * ## Ticks
 *
 * A file heading's box ticks or clears every selectable value of that file; the header box ticks
 * or clears every selectable row the filter lets through - the whole list, not the viewport. A row
 * with no checkbox says why in its resolution column.
 */

import { useEffect, useMemo, useRef, type MouseEvent } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  File as FileGlyph,
  Lock,
} from 'lucide-react'

import { Badge } from '@/components/core/ui'
import { FileIcon } from '@/components/shared'
import { t } from '@/lib/i18n'
import { resolveDescription, resolvePartNumber } from '@/lib/metadata/overlay'
import type { LocalFile } from '@/stores/pdmStore'

import type { VaultAuditActionKind } from './vaultAuditActions'
import type { VaultAuditFileAvailability } from './vaultAuditFileState'
import type { VaultAuditFileGroup, VaultAuditListItem } from './vaultAuditGroups'
import { compareForDisplay, isTrivialDifference, type ValueSegments } from './valueDifference'
import {
  blockedReasonLabel,
  countOf,
  differenceLabel,
  fieldLabel,
  resolutionDirection,
  resolutionHint,
  resolutionLabel,
  unattributedReasonLabel,
} from './vaultAuditLabels'
import type { VaultAuditFindingRow } from './vaultAuditRows'
import { useRevealInFileBrowser, type RevealInFileBrowser } from './useRevealInFileBrowser'

export type { ConflictOption, VaultAuditFindingRow } from './vaultAuditRows'

/** Same template for the column header and every value row, so the columns line up. */
const VALUE_GRID =
  'grid grid-cols-[2.5rem_minmax(8rem,13rem)_minmax(0,1fr)_1.5rem_minmax(0,1fr)]'
/** With the resolution column: conflicts, and categories whose rows resolve differently. */
const VALUE_GRID_WITH_RESOLUTION =
  'grid grid-cols-[2.5rem_minmax(7rem,11rem)_minmax(0,1fr)_1.5rem_minmax(0,1fr)_auto]'

const ESTIMATED_FILE_ROW_PX = 52
const ESTIMATED_VALUE_ROW_PX = 44
const OVERSCAN_ROWS = 12

interface VaultAuditFileListProps {
  items: VaultAuditListItem[]
  /** Show the resolution column. Off when every row resolves the same way the heading says. */
  showResolution: boolean
  /** Changes whenever the list underneath is a different list, so the view returns to the top. */
  scrollResetKey: string
  disabled: boolean
  /** Header checkbox state, over the rows the filter lets through. */
  allSelected: boolean
  someSelected: boolean
  canSelectAny: boolean
  onToggleAll: () => void
  onToggle: (row: VaultAuditFindingRow, shiftKey: boolean) => void
  onToggleFile: (group: VaultAuditFileGroup) => void
  onToggleCollapsed: (fileId: string) => void
  onChooseConflict: (
    row: VaultAuditFindingRow,
    direction: Exclude<VaultAuditActionKind, 'fill-empty'>,
  ) => void
}

/** A checkbox whose third state is set on the element, since `indeterminate` has no attribute. */
function TriStateBox({
  checked,
  indeterminate,
  disabled,
  label,
  onClick,
}: {
  checked: boolean
  indeterminate: boolean
  disabled: boolean
  label: string
  onClick: (event: MouseEvent<HTMLInputElement>) => void
}) {
  return (
    <input
      ref={(element) => {
        if (element) element.indeterminate = indeterminate
      }}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={() => undefined}
      onClick={onClick}
      className="accent-ui-accent"
      aria-label={label}
      title={label}
    />
  )
}

function ValueCell({ value, segments }: { value: string | null; segments: ValueSegments | null }) {
  if (value === null) {
    return (
      <span className="inline-block rounded border border-dashed border-ui-divider px-1.5 text-[12px] italic leading-5 text-ui-fg-tertiary">
        {t('vaultAudit.findings.emptyValue')}
      </span>
    )
  }

  const text = 'whitespace-pre-wrap break-words text-ui-fg'
  if (!segments) return <span className={text}>{value}</span>

  return (
    <span className={text}>
      {segments.head}
      {/* One value being a prefix of the other leaves nothing to highlight, and an unmarked cell
          would read as no difference at all. The marker stands in for the missing span. */}
      {segments.middle === '' ? (
        <mark className="inline-block w-1 h-3 align-middle bg-ui-warning/50 rounded-sm" />
      ) : (
        <mark className="bg-ui-warning/25 text-ui-fg rounded-sm px-0.5">{segments.middle}</mark>
      )}
      {segments.tail}
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

function DirectionCell({ row }: { row: VaultAuditFindingRow }) {
  const { finding } = row
  // A conflict has no direction until someone picks a side; then the arrow shows the pick.
  const direction = row.conflict
    ? row.conflict.useFile.selected
      ? 'file-to-vault'
      : row.conflict.useBluePlm.selected
        ? 'vault-to-file'
        : null
    : resolutionDirection(finding.resolution)
  if (!direction) return null

  const Icon = direction === 'file-to-vault' ? ArrowLeft : ArrowRight
  return (
    <span
      className="flex justify-center pt-0.5 text-ui-accent"
      title={resolutionHint(finding.resolution)}
    >
      <Icon size={14} />
    </span>
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
      className={`h-6 rounded-md border px-2 text-[12px] transition-colors disabled:opacity-40 ${
        selected
          ? 'border-ui-selected-border bg-ui-selected font-medium text-ui-fg'
          : 'border-transparent text-ui-fg-secondary hover:bg-ui-hover hover:text-ui-fg'
      }`}
    >
      {selected && <Check size={11} className="mr-1 inline" />}
      {label}
    </button>
  )
}

/**
 * The file's part number and description, so a heading names the part and not only its path.
 *
 * Read through the overlay like the file browser does. A file with no local row (not loaded) falls
 * back to the database values its own file-scope findings carry.
 */
function identityOf(
  file: LocalFile | null,
  group: VaultAuditFileGroup,
): { partNumber: string | null; description: string | null } {
  const fromFindings = (field: 'part_number' | 'description') =>
    group.rows.find((row) => row.finding.field === field && row.finding.scope === 'file')?.finding
      .databaseValue ?? null
  return {
    partNumber: (file ? resolvePartNumber(file).value : null) || fromFindings('part_number'),
    description: (file ? resolveDescription(file).value : null) || fromFindings('description'),
  }
}

/** What is wrong with the file, as the fields at issue: "Description, Config tab ×3". */
function issueSummaryOf(group: VaultAuditFileGroup): string {
  const counts = new Map<string, number>()
  for (const row of group.rows) {
    const label = fieldLabel(row.finding.field)
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  return [...counts]
    .map(([label, count]) => (count > 1 ? `${label} ×${count}` : label))
    .join(', ')
}

function splitPath(relativePath: string): { folder: string; name: string } {
  const split = Math.max(relativePath.lastIndexOf('\\'), relativePath.lastIndexOf('/'))
  return {
    folder: split === -1 ? '' : relativePath.slice(0, split),
    name: relativePath.slice(split + 1),
  }
}

interface FileRowViewProps {
  group: VaultAuditFileGroup
  collapsed: boolean
  disabled: boolean
  /** Built once for the list: the index behind it covers every loaded file. */
  browser: RevealInFileBrowser
  onToggleFile: VaultAuditFileListProps['onToggleFile']
  onToggleCollapsed: VaultAuditFileListProps['onToggleCollapsed']
}

function FileRowView({
  group,
  collapsed,
  disabled,
  browser,
  onToggleFile,
  onToggleCollapsed,
}: FileRowViewProps) {
  const { resolveFile, reveal } = browser
  const file = resolveFile(group.relativePath)
  const { folder, name } = splitPath(group.relativePath)
  const { partNumber, description } = identityOf(file, group)
  const issues = issueSummaryOf(group)
  const availability = group.rows[0]?.availability ?? null
  const heldByOther = availability?.state === 'held-by-other'
  const allSettled = group.settledCount === group.rows.length
  const Chevron = collapsed ? ChevronRight : ChevronDown

  return (
    <div
      role="row"
      className="group flex items-center gap-2 border-t border-ui-divider bg-ui-nav/60 py-1.5 pl-2 pr-2 hover:bg-ui-hover"
    >
      <button
        type="button"
        onClick={() => onToggleCollapsed(group.fileId)}
        aria-expanded={!collapsed}
        title={
          collapsed ? t('vaultAudit.findings.expandFile') : t('vaultAudit.findings.collapseFile')
        }
        className="rounded p-0.5 text-ui-fg-tertiary hover:text-ui-fg"
      >
        <Chevron size={14} />
      </button>

      <span className="flex w-4 flex-shrink-0 justify-center">
        {group.selectableCount > 0 ? (
          <TriStateBox
            checked={group.selectedCount === group.selectableCount}
            indeterminate={group.selectedCount > 0 && group.selectedCount < group.selectableCount}
            disabled={disabled}
            label={t('vaultAudit.findings.selectFile')}
            onClick={() => onToggleFile(group)}
          />
        ) : allSettled ? (
          <Check
            size={13}
            className="text-ui-success"
            aria-label={t('vaultAudit.findings.settled')}
          />
        ) : null}
      </span>

      <span className="flex flex-shrink-0 items-center">
        {file ? (
          <FileIcon file={file} size={18} />
        ) : (
          <FileGlyph size={16} className="text-ui-fg-tertiary" />
        )}
      </span>

      <button
        type="button"
        onClick={() => onToggleCollapsed(group.fileId)}
        onDoubleClick={() => reveal(group.relativePath)}
        title={group.relativePath}
        className="flex min-w-0 flex-1 flex-col text-left"
      >
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-[13px] font-medium text-ui-fg">{name}</span>
          {folder && (
            <span className="min-w-0 truncate text-[12px] text-ui-fg-tertiary">
              {folder.replace(/[\\/]/g, ' / ')}
            </span>
          )}
        </span>
        <span className="flex min-w-0 items-baseline gap-2 text-[12px]">
          <span
            className={`flex-shrink-0 font-mono ${partNumber ? 'text-ui-fg' : 'italic text-ui-fg-tertiary'}`}
            title={t('vaultAudit.findings.partNumber')}
          >
            {partNumber ?? t('vaultAudit.findings.noPartNumber')}
          </span>
          <span
            className={`min-w-0 truncate ${description ? 'text-ui-fg-secondary' : 'italic text-ui-fg-tertiary'}`}
            title={description ?? undefined}
          >
            {description ?? t('vaultAudit.findings.noDescription')}
          </span>
          <span
            className="ml-auto flex-shrink-0 text-ui-warning"
            title={t('vaultAudit.findings.issuesHint')}
          >
            {issues}
          </span>
        </span>
      </button>

      {heldByOther && (
        <Badge tone="warning" icon={<Lock size={10} />}>
          {heldByLabel(availability)}
        </Badge>
      )}

      {group.rows.length > 1 && <Badge>{countOf('values', group.rows.length)}</Badge>}

      <button
        type="button"
        onClick={() => reveal(group.relativePath)}
        disabled={!file}
        title={file ? t('vaultAudit.findings.reveal') : t('vaultAudit.findings.revealUnavailable')}
        aria-label={t('vaultAudit.findings.reveal')}
        className="flex-shrink-0 rounded-md p-1 text-ui-fg-tertiary opacity-0 transition hover:bg-ui-selected hover:text-ui-fg focus-visible:opacity-100 group-hover:opacity-100 disabled:hidden"
      >
        <ExternalLink size={13} />
      </button>
    </div>
  )
}

interface ValueRowViewProps {
  row: VaultAuditFindingRow
  disabled: boolean
  showResolution: boolean
  onToggle: VaultAuditFileListProps['onToggle']
  onChooseConflict: VaultAuditFileListProps['onChooseConflict']
}

function ValueRowView({
  row,
  disabled,
  showResolution,
  onToggle,
  onChooseConflict,
}: ValueRowViewProps) {
  const { finding } = row
  const isConflict = finding.resolution === 'choose-a-side'

  // The string diff is the one per-row cost worth deferring, and it is why this runs here.
  const comparison = useMemo(
    () => compareForDisplay(finding.databaseValue, finding.fileValue, 'full'),
    [finding.databaseValue, finding.fileValue],
  )
  const trivialNote =
    comparison && isTrivialDifference(comparison.kind) ? differenceLabel(comparison.kind) : null
  const blockedNote = row.action.available
    ? null
    : row.action.reason === 'held-by-another-user'
      ? heldByLabel(row.availability)
      : blockedReasonLabel(row.action.reason)
  // In a category with nothing to write, "nothing to write" on every row repeats the footer.
  const showBlocked =
    blockedNote !== null && !row.action.available && row.action.reason !== 'no-write-resolves-it'

  return (
    <div
      role="row"
      className={`${showResolution ? VALUE_GRID_WITH_RESOLUTION : VALUE_GRID} items-start border-t border-ui-divider/50 text-[13px] leading-5 transition-colors ${
        row.selected && !row.settled ? 'bg-ui-accent/[0.06]' : 'hover:bg-ui-hover/50'
      } ${row.settled ? 'opacity-60' : ''}`}
    >
      <div role="cell" className="flex justify-end py-2 pr-2">
        {row.settled ? (
          <Check
            size={12}
            className="mt-1 text-ui-success"
            aria-label={t('vaultAudit.findings.settled')}
          />
        ) : row.selectable ? (
          <input
            type="checkbox"
            checked={row.selected}
            disabled={disabled}
            onChange={() => undefined}
            onClick={(event) => onToggle(row, event.shiftKey)}
            className="mt-1 accent-ui-accent"
            aria-label={resolutionLabel(finding.resolution)}
          />
        ) : null}
      </div>
      <div role="cell" className="min-w-0 py-2 pl-5 pr-2">
        <span className="block break-words text-ui-fg">{fieldLabel(finding.field)}</span>
        {finding.configuration && (
          <span
            className="mt-0.5 inline-block max-w-full truncate rounded bg-ui-field px-1.5 font-mono text-[11.5px] leading-5 text-ui-fg-secondary"
            title={finding.configuration}
          >
            {finding.configuration}
          </span>
        )}
        {finding.unattributedReason && (
          <span className="block text-[12px] text-ui-fg-tertiary">
            {unattributedReasonLabel(finding.unattributedReason)}
          </span>
        )}
        {showBlocked && !showResolution && (
          <span className="mt-0.5 flex items-start gap-1 text-[12px] text-ui-warning">
            <Lock size={10} className="mt-1 flex-shrink-0" />
            {blockedNote}
          </span>
        )}
      </div>
      <div role="cell" className="min-w-0 px-2 py-2">
        <ValueCell value={finding.databaseValue} segments={comparison?.database ?? null} />
      </div>
      <div role="cell" className="py-2">
        <DirectionCell row={row} />
      </div>
      <div role="cell" className="min-w-0 px-2 py-2">
        <ValueCell value={finding.fileValue} segments={comparison?.file ?? null} />
        {trivialNote && <span className="block text-[12px] text-ui-warning/80">{trivialNote}</span>}
      </div>
      {showResolution && (
        <div role="cell" className="min-w-0 py-1.5 pl-2 pr-3 text-ui-fg-secondary">
          {isConflict && row.conflict ? (
            <div className="inline-flex gap-0.5 rounded-lg border border-ui-divider bg-ui-field p-0.5">
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
          ) : (
            <span className="block pt-0.5" title={resolutionHint(finding.resolution)}>
              {resolutionLabel(finding.resolution)}
            </span>
          )}
          {showBlocked && <span className="block text-[12px] text-ui-warning">{blockedNote}</span>}
        </div>
      )}
    </div>
  )
}

export function VaultAuditFileList({
  items,
  showResolution,
  scrollResetKey,
  disabled,
  allSelected,
  someSelected,
  canSelectAny,
  onToggleAll,
  onToggle,
  onToggleFile,
  onToggleCollapsed,
  onChooseConflict,
}: VaultAuditFileListProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const browser = useRevealInFileBrowser()

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) =>
      items[index]?.kind === 'file' ? ESTIMATED_FILE_ROW_PX : ESTIMATED_VALUE_ROW_PX,
    overscan: OVERSCAN_ROWS,
    // Keyed by item, so a sort or a filter does not hand one row's measured height to another.
    getItemKey: (index) => items[index]?.key ?? index,
  })

  // A different list starts at its top. Staying at row nine hundred of a list that now has twelve
  // rows reads as an empty table.
  useEffect(() => {
    virtualizer.scrollToOffset(0)
    // The virtualizer instance is stable; the key is the only thing that should trigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollResetKey])

  return (
    <div role="table" className="flex min-h-0 flex-col overflow-hidden">
      <div
        role="row"
        className={`${showResolution ? VALUE_GRID_WITH_RESOLUTION : VALUE_GRID} flex-shrink-0 items-center border-b border-ui-divider py-2 text-[12px] font-medium text-ui-fg-secondary`}
      >
        <div role="columnheader" className="flex justify-end pr-2">
          <TriStateBox
            checked={allSelected}
            indeterminate={someSelected}
            disabled={disabled || !canSelectAny}
            label={t('vaultAudit.findings.selectAllRows')}
            onClick={onToggleAll}
          />
        </div>
        <div role="columnheader" className="pl-5 pr-2">
          {t('vaultAudit.findings.columnField')}
        </div>
        <div role="columnheader" className="px-2">
          {t('vaultAudit.findings.columnDatabase')}
        </div>
        <div role="columnheader" />
        <div role="columnheader" className="px-2">
          {t('vaultAudit.findings.columnFile2')}
        </div>
        {showResolution && (
          <div role="columnheader" className="px-2">
            {t('vaultAudit.findings.columnResolution')}
          </div>
        )}
      </div>

      {/* Sized to its rows up to most of the window, so a short category is not a tall empty
          box and a long one fills the screen once scrolled to. */}
      <div ref={scrollRef} className="max-h-[calc(100vh-22rem)] min-h-[3rem] overflow-y-auto">
        <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const item = items[virtualRow.index]
            if (!item) return null

            return (
              <div
                key={virtualRow.key}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                className="absolute left-0 top-0 w-full"
                style={{ transform: `translateY(${virtualRow.start}px)` }}
              >
                {item.kind === 'file' ? (
                  <FileRowView
                    group={item.group}
                    collapsed={item.collapsed}
                    disabled={disabled}
                    browser={browser}
                    onToggleFile={onToggleFile}
                    onToggleCollapsed={onToggleCollapsed}
                  />
                ) : (
                  <ValueRowView
                    row={item.row}
                    disabled={disabled}
                    showResolution={showResolution}
                    onToggle={onToggle}
                    onChooseConflict={onChooseConflict}
                  />
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
