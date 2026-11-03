import { Lock } from 'lucide-react'

import { t } from '@/lib/i18n'

import { ADD_METHOD_OPTION, type ColumnDef } from './inspectionColumns'

interface InspectionCellProps {
  col: ColumnDef
  value: string | number | boolean | null
  editable: boolean
  onChange: (value: string | number | boolean | null) => void
  methodOptions?: string[]
  onManageMethods?: () => void
  /** The drawing owns this cell (extracted row, geometry column): read-only with a lock. */
  locked?: boolean
  /** Tooltip of the "GT" marker, shown when the value is a general (title block) tolerance. */
  generalToleranceTitle?: string | null
  /** Tooltip of the cell itself (the general tolerance rule on the Tol. Source cell). */
  hint?: string | null
}

/**
 * One density for every cell: a 24 px line. Inputs look like text until hovered or focused, so
 * editable and read-only rows line up; `inspection-symbols` renders GD&T glyphs.
 */
const FIELD_CLASS =
  'inspection-symbols h-6 w-full min-w-0 rounded border border-transparent bg-transparent px-1.5 py-0 text-[12px] leading-[22px] text-ui-fg outline-none transition-colors hover:border-ui-field-border focus:border-ui-accent focus:bg-ui-field'

function displayText(col: ColumnDef, value: string | number | boolean | null): string {
  if (value === null || value === undefined || value === '') return ''
  if (col.key === 'tolerance_source') {
    if (value === 'drawing') return t('source.inspection.toleranceSourceDrawing')
    if (value === 'general') return t('source.inspection.toleranceSourceGeneral')
  }
  return String(value)
}

export function InspectionCell({
  col,
  value,
  editable,
  onChange,
  methodOptions,
  onManageMethods,
  locked,
  generalToleranceTitle,
  hint,
}: InspectionCellProps) {
  if (!editable || locked) {
    const text = displayText(col, value)
    // The full value (a cell may truncate it), then why it cannot be edited here.
    const title = [text, hint, locked && editable ? t('source.inspection.lockedFromDrawing') : null]
      .filter(Boolean)
      .join('\n')
    return (
      <div
        className="inspection-symbols group/cell flex h-6 min-w-0 items-center gap-1 px-[7px] text-[12px] text-ui-fg"
        title={title || undefined}
      >
        {text === '' ? (
          <span className="text-ui-fg-tertiary">—</span>
        ) : (
          <span className="truncate">{text}</span>
        )}
        {generalToleranceTitle && (
          <span
            className="shrink-0 rounded-sm bg-ui-accent/15 px-1 text-[9px] font-semibold leading-[14px] text-ui-accent"
            title={generalToleranceTitle}
          >
            {t('source.inspection.generalToleranceBadge')}
          </span>
        )}
        {locked && editable && (
          <Lock
            size={10}
            aria-label={t('source.inspection.lockedFromDrawing')}
            className="ml-auto shrink-0 text-ui-fg-tertiary opacity-0 transition-opacity group-hover/cell:opacity-100"
          />
        )}
      </div>
    )
  }

  const current = value === null || value === undefined ? '' : String(value)

  // Method is a controlled vocabulary: built-in + org methods, with a "manage" option that
  // opens the method manager modal (add/edit/remove).
  if (col.key === 'inspection_method') {
    const options = methodOptions ?? []
    const currentInOptions =
      current !== '' && options.some((m) => m.toLowerCase() === current.toLowerCase())
    return (
      <select
        value={current}
        title={current || undefined}
        onChange={(e) => {
          const next = e.target.value
          if (next === ADD_METHOD_OPTION) {
            onManageMethods?.()
            return
          }
          onChange(next === '' ? null : next)
        }}
        className={`${FIELD_CLASS} cursor-pointer ${current === '' ? 'text-ui-fg-tertiary' : ''}`}
      >
        <option value="">—</option>
        {!currentInOptions && current !== '' && <option value={current}>{current}</option>}
        {options.map((method) => (
          <option key={method} value={method}>
            {method}
          </option>
        ))}
        <option value={ADD_METHOD_OPTION}>{t('source.inspection.manageMethods')}</option>
      </select>
    )
  }

  if (col.type === 'select') {
    return (
      <select
        value={current}
        title={current || undefined}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        className={`${FIELD_CLASS} cursor-pointer ${current === '' ? 'text-ui-fg-tertiary' : ''}`}
      >
        <option value="">—</option>
        {col.options?.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    )
  }

  return (
    <input
      type={col.type === 'number' ? 'number' : 'text'}
      value={current}
      title={current || undefined}
      placeholder="—"
      onChange={(e) => {
        if (col.type === 'number') {
          const raw = e.target.value
          onChange(raw === '' ? null : Number(raw))
        } else {
          onChange(e.target.value === '' ? null : e.target.value)
        }
      }}
      className={`${FIELD_CLASS} placeholder:text-ui-fg-tertiary`}
    />
  )
}
