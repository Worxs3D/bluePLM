import { useCallback, useRef, type KeyboardEvent } from 'react'
import { ArrowDown, ArrowUp, ChevronsUpDown, Lock, Trash2 } from 'lucide-react'

import { t } from '@/lib/i18n'
import type { InspectionRowInput, InspectionRowValues } from '@/lib/supabase'
import type { GeneralToleranceBasis } from '@/lib/inspection/generalTolerance'

import { columnLabel, isDrawingOwnedCell, type ColumnDef } from './inspectionColumns'
import type { SortDir } from './inspectionTableUtils'
import { InspectionCell } from './InspectionCell'
import { ColumnFilter } from './ColumnFilter'
import { generalToleranceTitle } from './generalToleranceText'

/** Columns that carry the GT marker on a row whose tolerance came from the title block. */
const GT_MARKED = new Set<keyof InspectionRowValues>(['plus_tolerance', 'minus_tolerance'])

interface InspectionTableProps {
  columns: ColumnDef[]
  rows: InspectionRowInput[]
  editable: boolean
  sortKey: keyof InspectionRowValues
  sortDir: SortDir
  onSort: (key: keyof InspectionRowValues) => void
  filters: Partial<Record<keyof InspectionRowValues, string>>
  onFilterChange: (key: keyof InspectionRowValues, value: string) => void
  onCellChange: (rowId: string, key: keyof InspectionRowValues, value: string | number | boolean | null) => void
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
  const extraCols = editable ? 2 : 0

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTableElement>) => {
      const table = tableRef.current
      const target = event.target as HTMLElement
      if (!table || !(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return
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
      else if (isInput && target.type === 'text' && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
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
    <table ref={tableRef} onKeyDown={handleKeyDown} className="text-xs border-collapse w-max min-w-full">
      <thead className="sticky top-0 bg-plm-bg z-10">
        <tr className="border-b border-plm-border">
          {editable && (
            <th className="px-2 py-1.5 w-6">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={() => onSelectAll(!allSelected)}
                title={t('source.inspection.selectAll')}
              />
            </th>
          )}
          {columns.map((col) => (
            <th key={col.key} className={`px-2 py-1.5 text-left font-medium text-plm-fg/70 ${col.width}`}>
              <button
                type="button"
                onClick={() => onSort(col.key)}
                className="flex items-center gap-1 hover:text-plm-fg w-full text-left"
                title={t('source.inspection.sortBy')}
              >
                <span className="truncate">{columnLabel(col)}</span>
                {sortKey === col.key ? (
                  sortDir === 'asc' ? (
                    <ArrowUp size={11} className="shrink-0" />
                  ) : (
                    <ArrowDown size={11} className="shrink-0" />
                  )
                ) : (
                  <ChevronsUpDown size={11} className="shrink-0 opacity-30" />
                )}
              </button>
            </th>
          ))}
          {editable && <th className="px-2 py-1.5 w-12" />}
        </tr>
        <tr className="border-b border-plm-border">
          {editable && <th className="px-1 py-1" />}
          {columns.map((col) => (
            <th key={col.key} className="px-1 py-1 align-top">
              <ColumnFilter col={col} value={filters[col.key] ?? ''} onChange={(value) => onFilterChange(col.key, value)} />
            </th>
          ))}
          {editable && <th className="px-1 py-1" />}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={columns.length + extraCols} className="px-2 py-6 text-center text-plm-fg/50">
              {t('source.inspection.noMatches')}
            </td>
          </tr>
        ) : (
          rows.map((row, r) => {
            const linked = !!row.source_key?.trim()
            const selected = selectedIds.has(row.id)
            return (
              <tr
                key={row.id}
                className={`border-b border-plm-border/50 ${selected ? 'bg-plm-accent/10' : 'hover:bg-plm-bg/40'}`}
              >
                {editable && (
                  <td className="px-2 py-0.5">
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => undefined}
                      onClick={(e) => onToggleSelect(row.id, e.shiftKey)}
                      title={t('source.inspection.selectRow')}
                    />
                  </td>
                )}
                {columns.map((col, c) => {
                  const locked = isDrawingOwnedCell(row, col.key)
                  const gt =
                    row.tolerance_source === 'general' && GT_MARKED.has(col.key)
                      ? generalToleranceTitle(row.source_key ? generalBasis.get(row.source_key) : undefined)
                      : null
                  return (
                    <td key={col.key} className="px-1 py-0.5" data-r={r} data-c={c}>
                      <InspectionCell
                        col={col}
                        value={row[col.key]}
                        editable={editable && col.key !== 'balloon_number' && !col.readOnly}
                        locked={locked}
                        generalToleranceTitle={gt}
                        onChange={(value) => onCellChange(row.id, col.key, value)}
                        methodOptions={methodOptions}
                        onManageMethods={onManageMethods}
                      />
                    </td>
                  )
                })}
                {editable && (
                  <td className="px-1 py-0.5">
                    {linked ? (
                      <span className="flex p-1 text-plm-fg/40" title={t('source.inspection.lockedRow')}>
                        <Lock size={12} />
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onDeleteRow(row.id)}
                        className="p-1 rounded hover:bg-plm-error/20 text-plm-error"
                        title={t('source.inspection.deleteRow')}
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </td>
                )}
              </tr>
            )
          })
        )}
      </tbody>
    </table>
  )
}
