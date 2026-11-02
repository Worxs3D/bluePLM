import { Lock } from 'lucide-react'

import { t } from '@/lib/i18n'

import { ADD_METHOD_OPTION, SYMBOL_FONT, type ColumnDef } from './inspectionColumns'

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
}

const INPUT_CLASS = 'w-full bg-plm-bg border border-plm-border rounded px-1 py-0.5 text-xs'

function displayText(col: ColumnDef, value: string | number | boolean | null): string {
  if (value === null || value === undefined || value === '') return '—'
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
}: InspectionCellProps) {
  if (!editable || locked) {
    return (
      <span
        className="group flex items-center gap-1 px-1 py-0.5 text-plm-fg/90 min-w-0"
        style={{ fontFamily: SYMBOL_FONT }}
        title={locked ? t('source.inspection.lockedFromDrawing') : undefined}
      >
        <span className="truncate">{displayText(col, value)}</span>
        {generalToleranceTitle && (
          <span
            className="shrink-0 rounded px-0.5 text-[9px] font-semibold leading-tight bg-plm-accent/20 text-plm-accent"
            title={generalToleranceTitle}
          >
            {t('source.inspection.generalToleranceBadge')}
          </span>
        )}
        {locked && editable && (
          <Lock size={9} className="ml-auto shrink-0 opacity-0 group-hover:opacity-50" />
        )}
      </span>
    )
  }

  // Method is a controlled vocabulary: built-in + org methods, with a "manage" option that
  // opens the method manager modal (add/edit/remove).
  if (col.key === 'inspection_method') {
    const current = value === null || value === undefined ? '' : String(value)
    const options = methodOptions ?? []
    const currentInOptions =
      current !== '' && options.some((m) => m.toLowerCase() === current.toLowerCase())
    return (
      <select
        value={current}
        onChange={(e) => {
          const next = e.target.value
          if (next === ADD_METHOD_OPTION) {
            onManageMethods?.()
            return
          }
          onChange(next === '' ? null : next)
        }}
        className={INPUT_CLASS}
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
        value={value === null || value === undefined ? '' : String(value)}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        className={INPUT_CLASS}
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
      value={value === null || value === undefined ? '' : String(value)}
      onChange={(e) => {
        if (col.type === 'number') {
          const raw = e.target.value
          onChange(raw === '' ? null : Number(raw))
        } else {
          onChange(e.target.value === '' ? null : e.target.value)
        }
      }}
      className={INPUT_CLASS}
      style={col.type === 'text' ? { fontFamily: SYMBOL_FONT } : undefined}
    />
  )
}
