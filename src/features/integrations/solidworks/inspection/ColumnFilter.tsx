import { t } from '@/lib/i18n'

import { SYMBOL_FONT, type ColumnDef } from './inspectionColumns'

interface ColumnFilterProps {
  col: ColumnDef
  value: string
  onChange: (value: string) => void
}

export function ColumnFilter({ col, value, onChange }: ColumnFilterProps) {
  const baseClass =
    'w-full bg-pdm-bg border border-pdm-border rounded px-1 py-0.5 text-xs font-normal text-pdm-fg/90'

  if (col.type === 'select') {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} className={baseClass}>
        <option value="">{t('source.inspection.filterAll')}</option>
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
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={t('source.inspection.filterPlaceholder')}
      className={baseClass}
      style={{ fontFamily: SYMBOL_FONT }}
    />
  )
}
