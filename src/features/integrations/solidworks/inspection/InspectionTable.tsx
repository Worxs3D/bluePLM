import { useCallback, useRef, type KeyboardEvent } from 'react'
import { ArrowDown, ArrowUp, ChevronsUpDown, Trash2 } from 'lucide-react'

import { t } from '@/lib/i18n'
import type { InspectionRowInput, InspectionRowValues } from '@/lib/supabase'
import type { GeneralToleranceBasis } from '@/lib/inspection/generalTolerance'

import { columnLabel, isDrawingOwnedCell, type ColumnDef } from './inspectionColumns'
import { generalToleranceMarkerColumn, type SortDir } from './inspectionTableUtils'
import { InspectionCell } from './InspectionCell'
import { ColumnFilter } from './ColumnFilter'
import { generalToleranceTitle } from './generalToleranceText'

/** Header and body cells: one 32 px row height everywhere, hairline row rules. */
const HEAD_CELL =
  'h-8 border-b border-plm-border text-left align-middle text-[11px] font-semibold uppercase tracking-wide text-ui-fg-secondary'
const FILTER_CELL = 'border-b border-plm-border py-1 align-middle font-normal'
const BODY_CELL = 'h-8 border-b border-plm-border/40 align-middle'

interface InspectionTableProps {
  columns: ColumnDef[]
  rows: InspectionRowInput[]
  editable: boolean
  sortKey: keyof InspectionRowValues
  sortDir: SortDir
  onSort: (key: keyof InspectionRowValues) => void
  /** The filter row under the headers (toggled from the toolbar). */
  showFilters: boolean
  filters: Partial<Record<keyof InspectionRowValues, string>>
  onFilterChange: (key: keyof InspectionRowValues, value: string) => void
  onCellChange: (
    rowId: string,
    key: keyof InspectionRowValues,
    value: string | number | boolean | null,
  ) => void
  onDeleteRow: (rowId: string) => void
  methodOptions: string[]
  onManageMethods: () => void
  selectedIds: ReadonlySet<string>
  /** Toggle a row; `range` extends from the last clicked row (shift-click). */
  onToggleSelect: (rowId: string, range: boolean) => void
  onSelectAll: (select: boolean) => void
  /** General tolerance rule per source key, from this session's latest extraction. */
  generalBasis: ReadonlyMap<string, GeneralToleranceBasis>
}

function focusCell(table: HTMLTableElement, r: number, c: number): boolean {
  const el = table.querySelector<HTMLInputElement | HTMLSelectElement>(
    `td[data-r="${r}"][data-c="${c}"] input, td[data-r="${r}"][data-c="${c}"] select`,
  )
  if (!el) return false
  el.focus()
  if (el instanceof HTMLInputElement && el.type === 'text') el.select()
  return true
}

/**
 * The Inspection table: sortable, filterable headers, row selection, and keyboard movement
 * between editable cells (Enter / Shift+Enter and the up / down arrows move along the column,
 * left / right at the ends of a text move along the row; Tab is the browser's own).
 */
export function InspectionTable({
  columns,
  rows,
  editable,
  sortKey,
  sortDir,
  onSort,
  showFilters,
  filters,
  onFilterChange,
  onCellChange,
  onDeleteRow,
  methodOptions,
  onManageMethods,
  selectedIds,
  onToggleSelect,
  onSelectAll,
  generalBasis,
}: InspectionTableProps) {
  const tableRef = useRef<HTMLTableElement | null>(null)
  const allSelected = rows.length > 0 && rows.every((r) => selectedIds.has(r.id))
  const visibleKeys = new Set(columns.map((c) => c.key))

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTableElement>) => {
      const table = tableRef.current
      const target = event.target as HTMLElement
      if (!table || !(target instanceof HTMLInputElement || target instanceof HTMLSelectElement))
        return
      const cell = target.closest('td')
      const r = Number(cell?.dataset.r)
      const c = Number(cell?.dataset.c)
      if (!cell || Number.isNaN(r) || Number.isNaN(c)) return

      const isInput = target instanceof HTMLInputElement
      let dr = 0
      let dc = 0
      if (event.key === 'Enter') dr = event.shiftKey ? -1 : 1
      else if (isInput && event.key === 'ArrowDown') dr = 1
      else if (isInput && event.key === 'ArrowUp') dr = -1
      else if (
        isInput &&
        target.type === 'text' &&
        (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
      ) {
        const atStart = target.selectionStart === 0 && target.selectionEnd === 0
        const atEnd = target.selectionStart === target.value.length
        if (event.key === 'ArrowLeft' && atStart) dc = -1
        else if (event.key === 'ArrowRight' && atEnd) dc = 1
      }
      if (dr === 0 && dc === 0) return

      // Step past locked and read-only cells to the next editable one in that direction.
      for (
        let nr = r + dr, nc = c + dc;
        nr >= 0 && nr < rows.length && nc >= 0 && nc < columns.length;
        nr += dr, nc += dc
      ) {
        if (focusCell(table, nr, nc)) {
          event.preventDefault()
          return
        }
      }
    },
    [rows.length, columns.length],
  )

  return (
    <table
      ref={tableRef}
      onKeyDown={handleKeyDown}
      className="w-max min-w-full border-separate border-spacing-0 text-[12px]"
    >
      <thead className="sticky top-0 z-10 bg-plm-bg">
        <tr>
          {/* The same gutter columns in every view, so editable and read-only tables line up. */}
          <th className={`${HEAD_CELL} w-8 px-2`}>
            {editable && (
              <input
                type="checkbox"
                checked={allSelected}
                onChange={() => onSelectAll(!allSelected)}
                title={t('source.inspection.selectAll')}
                aria-label={t('source.inspection.selectAll')}
                className="align-middle"
              />
            )}
          </th>
          {columns.map((col) => (
            <th key={col.key} className={`${HEAD_CELL} px-1 ${col.width}`}>
              <button
                type="button"
                onClick={() => onSort(col.key)}
                className="flex h-6 w-full items-center gap-1 rounded px-[7px] text-left hover:text-ui-fg"
                title={t('source.inspection.sortBy')}
              >
                <span className="truncate">{columnLabel(col)}</span>
                {sortKey === col.key ? (
                  sortDir === 'asc' ? (
                    <ArrowUp size={11} className="shrink-0 text-ui-fg" />
                  ) : (
                    <ArrowDown size={11} className="shrink-0 text-ui-fg" />
                  )
                ) : (
                  <ChevronsUpDown size={11} className="shrink-0 opacity-30" />
                )}
              </button>
            </th>
          ))}
          <th className={`${HEAD_CELL} w-8`} />
        </tr>
        {showFilters && (
          <tr>
            <th className={FILTER_CELL} />
            {columns.map((col) => (
              <th key={col.key} className={`${FILTER_CELL} px-1`}>
                <ColumnFilter
                  col={col}
                  value={filters[col.key] ?? ''}
                  onChange={(value) => onFilterChange(col.key, value)}
                />
              </th>
            ))}
            <th className={FILTER_CELL} />
          </tr>
        )}
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td
              colSpan={columns.length + 2}
              className="px-2 py-8 text-center text-[12px] text-ui-fg-secondary"
            >
              {t('source.inspection.noMatches')}
            </td>
          </tr>
        ) : (
          rows.map((row, r) => {
            const linked = !!row.source_key?.trim()
            const selected = selectedIds.has(row.id)
            const general = row.tolerance_source === 'general'
            const basis = general
              ? generalToleranceTitle(row.source_key ? generalBasis.get(row.source_key) : undefined)
              : null
            // The GT marker once per row (generalToleranceMarkerColumn).
            const gtKey = generalToleranceMarkerColumn(row, visibleKeys)
            return (
              <tr
                key={row.id}
                className={`group ${selected ? 'bg-ui-accent/10' : 'hover:bg-ui-hover/60'}`}
              >
                <td className={`${BODY_CELL} px-2`}>
                  {editable && (
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => undefined}
                      onClick={(e) => onToggleSelect(row.id, e.shiftKey)}
                      title={t('source.inspection.selectRow')}
                      aria-label={t('source.inspection.selectRow')}
                      className="align-middle"
                    />
                  )}
                </td>
                {columns.map((col, c) => (
                  <td key={col.key} className={`${BODY_CELL} px-1`} data-r={r} data-c={c}>
                    <InspectionCell
                      col={col}
                      value={row[col.key]}
                      editable={editable && col.key !== 'balloon_number' && !col.readOnly}
                      locked={isDrawingOwnedCell(row, col.key)}
                      generalToleranceTitle={gtKey === col.key ? basis : null}
                      hint={col.key === 'tolerance_source' && general ? basis : null}
                      onChange={(value) => onCellChange(row.id, col.key, value)}
                      methodOptions={methodOptions}
                      onManageMethods={onManageMethods}
                    />
                  </td>
                ))}
                <td className={`${BODY_CELL} pr-1`}>
                  {editable && !linked && (
                    <button
                      type="button"
                      onClick={() => onDeleteRow(row.id)}
                      className="flex h-6 w-6 items-center justify-center rounded text-ui-fg-tertiary opacity-0 transition-opacity hover:bg-ui-danger/15 hover:text-ui-danger focus:opacity-100 group-hover:opacity-100"
                      title={t('source.inspection.deleteRow')}
                      aria-label={t('source.inspection.deleteRow')}
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </td>
              </tr>
            )
          })
        )}
      </tbody>
    </table>
  )
}
