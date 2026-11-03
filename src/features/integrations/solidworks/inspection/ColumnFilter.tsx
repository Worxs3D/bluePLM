import { t } from '@/lib/i18n'

import type { ColumnDef } from './inspectionColumns'

interface ColumnFilterProps {
  col: ColumnDef
  value: string
  onChange: (value: string) => void
}

export function ColumnFilter({ col, value, onChange }: ColumnFilterProps) {
  const baseClass =
    'inspection-symbols h-6 w-full rounded border border-ui-field-border bg-ui-field px-1.5 text-[12px] font-normal normal-case tracking-normal text-ui-fg outline-none focus:border-ui-accent'

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
    />
  )
}
