import { t } from '@/lib/i18n'

import { ADD_METHOD_OPTION, SYMBOL_FONT, type ColumnDef } from './inspectionColumns'

interface InspectionCellProps {
  col: ColumnDef
  value: string | number | boolean | null
  editable: boolean
  onChange: (value: string | number | boolean | null) => void
  methodOptions?: string[]
  onManageMethods?: () => void
}

export function InspectionCell({
  col,
  value,
  editable,
  onChange,
  methodOptions,
  onManageMethods,
}: InspectionCellProps) {
  if (!editable) {
    const display = value === null || value === undefined || value === '' ? '—' : String(value)
    return (
      <span
        className="block px-1 py-0.5 text-plm-fg/90 truncate"
        style={{ fontFamily: SYMBOL_FONT }}
      >
        {display}
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
        className="w-full bg-plm-bg border border-plm-border rounded px-1 py-0.5 text-xs"
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
        className="w-full bg-plm-bg border border-plm-border rounded px-1 py-0.5 text-xs"
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
      className="w-full bg-plm-bg border border-plm-border rounded px-1 py-0.5 text-xs"
      style={col.type === 'text' ? { fontFamily: SYMBOL_FONT } : undefined}
    />
  )
}
