/**
 * Keep formulas and conditional formats of a template pointing at the table after the row
 * template has been repeated. exceljs moves cells when rows are inserted but never rewrites the
 * references in formulas, so a summary such as `=COUNTIF(J11:J11,"PASS")` would keep counting one
 * row. The rule follows Excel's own insert-rows behaviour, plus one addition: a range whose bottom
 * is the row template row grows with the table (the template row stands for the whole table).
 *
 * Limits: only unqualified A1 references are rewritten (`Sheet!A1` and R1C1 are left alone),
 * shared formulas are left to exceljs, and formulas on other sheets are not touched.
 */
import type { Worksheet } from 'exceljs'

/** `A1`, `$A$1`, `A1:B2`; not part of a name, a function call or a sheet-qualified reference. */
const REF_RE = /(?<![A-Za-z0-9_.!$'])(\$?[A-Z]{1,3}\$?)(\d+)(?::(\$?[A-Z]{1,3}\$?)(\d+))?(?![A-Za-z0-9_(!])/g

function shiftRow(r: number, t: number, extra: number): number {
  return r > t ? r + extra : r
}

/** Rewrite the references of one formula (string literals are kept as they are). */
export function shiftFormula(formula: string, t: number, extra: number): string {
  if (extra <= 0) return formula
  return formula
    .split('"')
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part.replace(REF_RE, (_whole: string, c1: string, r1: string, c2?: string, r2?: string) => {
            const top = Number(r1)
            if (c2 === undefined || r2 === undefined) return `${c1}${shiftRow(top, t, extra)}`
            const bottom = Number(r2)
            const newBottom = bottom >= t ? bottom + extra : bottom
            return `${c1}${shiftRow(top, t, extra)}:${c2}${newBottom}`
          }),
    )
    .join('"')
}

/** Space-separated ranges (a conditional format's `ref`). */
export function shiftRef(ref: string, t: number, extra: number): string {
  return ref
    .split(/\s+/)
    .filter(Boolean)
    .map((r) => shiftFormula(r, t, extra))
    .join(' ')
}

interface FormulaValue {
  formula: string
  result?: unknown
}

/** Rewrite every plain formula outside row `t` and every conditional format of the sheet. */
export function shiftSheetReferences(ws: Worksheet, t: number, extra: number): void {
  if (extra <= 0) return
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber >= t && rowNumber <= t + extra) return
    row.eachCell({ includeEmpty: false }, (cell) => {
      const value = cell.value
      if (!value || typeof value !== 'object' || !('formula' in value) || typeof value.formula !== 'string') return
      const shifted = shiftFormula(value.formula, t, extra)
      // The cached result is stale once the range changed; Excel recalculates on load.
      if (shifted !== value.formula) cell.value = { formula: shifted } as FormulaValue as typeof cell.value
    })
  })
  const cfs = (ws as unknown as { conditionalFormattings?: { ref: string; rules: { formulae?: unknown[] }[] }[] }).conditionalFormattings ?? []
  for (const cf of cfs) {
    cf.ref = shiftRef(cf.ref, t, extra)
    for (const rule of cf.rules) {
      if (Array.isArray(rule.formulae)) rule.formulae = rule.formulae.map((f) => (typeof f === 'string' ? shiftFormula(f, t, extra) : f))
    }
  }
}
