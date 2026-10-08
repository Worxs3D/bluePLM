/**
 * What "select all", "clear", "invert" and the selection summary mean for the findings list.
 *
 * Pure: no React, no store. The list used to derive all of this from the rows it had rendered,
 * which was capped at two hundred, so a category of twelve hundred values could never be selected
 * in full. These functions take the whole category and the subset the filter lets through as two
 * lists, so "all" means every row the administrator could scroll to and nothing outside it.
 *
 * ## Units
 *
 * A tick adds to a unit, and the unit is not always the row: the document writer is per file, so
 * several rows of one file are one thing being selected. Everything here counts and flips by
 * `selectionId` rather than by row, for the same reason the action bar counts files and not
 * values - describing the click by what was clicked rather than by what happens would promise a
 * precision the writer does not have.
 */

/** The part of a findings row that selection needs to know. */
export interface SelectionRowState {
  /** What a tick on this row adds to: a value, a finding, or a whole file. */
  selectionId: string
  /** Has a checkbox that can be ticked now: actionable, not a conflict, not already written. */
  selectable: boolean
  selected: boolean
}

export interface SelectionSummary {
  /** Distinct units among the visible selectable rows. */
  selectableUnits: number
  /** Of those, how many are ticked. */
  selectedUnits: number
  allSelected: boolean
  someSelected: boolean
  /** Ticked units in this category that the current filter is hiding. */
  hiddenSelectedUnits: number
}

export type SelectionMode = 'select-all' | 'clear' | 'invert'

export interface SelectionChange<T extends SelectionRowState> {
  select: T[]
  deselect: T[]
}

function selectableOf<T extends SelectionRowState>(rows: readonly T[]): T[] {
  return rows.filter((row) => row.selectable)
}

/** Unit id to whether it is ticked, over the selectable rows only. */
function unitStates(rows: readonly SelectionRowState[]): Map<string, boolean> {
  const units = new Map<string, boolean>()
  for (const row of rows) {
    if (!row.selectable) continue
    units.set(row.selectionId, units.get(row.selectionId) === true || row.selected)
  }
  return units
}

/**
 * Selected rows of the category that the filter has hidden.
 *
 * A unit is hidden only when none of its rows is visible. One file with a row on screen and a row
 * filtered away is on screen, and reporting it as hidden would count it twice.
 */
export function hiddenSelectedRows<T extends SelectionRowState>(
  allRows: readonly T[],
  visibleRows: readonly T[],
): T[] {
  const visibleUnits = new Set(visibleRows.map((row) => row.selectionId))
  return allRows.filter(
    (row) => row.selectable && row.selected && !visibleUnits.has(row.selectionId),
  )
}

export function summarizeSelection(
  allRows: readonly SelectionRowState[],
  visibleRows: readonly SelectionRowState[],
): SelectionSummary {
  const units = unitStates(visibleRows)
  let selectedUnits = 0
  for (const selected of units.values()) {
    if (selected) selectedUnits += 1
  }

  const hiddenUnits = new Set(hiddenSelectedRows(allRows, visibleRows).map((row) => row.selectionId))
  const allSelected = units.size > 0 && selectedUnits === units.size

  return {
    selectableUnits: units.size,
    selectedUnits,
    allSelected,
    someSelected: selectedUnits > 0 && !allSelected,
    hiddenSelectedUnits: hiddenUnits.size,
  }
}

/**
 * Which rows to tick and which to untick for one bulk action over the visible rows.
 *
 * Invert flips by unit: a file ticked through one of its rows is unticked through all of them,
 * and a file with no ticked row is ticked through all of them. Flipping per row would tick a file
 * that was already ticked by the sibling row that is unticking it.
 */
export function selectionChangeFor<T extends SelectionRowState>(
  visibleRows: readonly T[],
  mode: SelectionMode,
): SelectionChange<T> {
  const rows = selectableOf(visibleRows)

  if (mode === 'select-all') return { select: rows, deselect: [] }
  if (mode === 'clear') return { select: [], deselect: rows }

  const units = unitStates(rows)
  const select: T[] = []
  const deselect: T[] = []
  for (const row of rows) {
    if (units.get(row.selectionId)) deselect.push(row)
    else select.push(row)
  }
  return { select, deselect }
}