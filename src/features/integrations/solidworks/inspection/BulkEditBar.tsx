import { useState } from 'react'
import { X } from 'lucide-react'

import { t } from '@/lib/i18n'

import {
  BULK_EDIT_FIELDS,
  COLUMNS,
  columnLabel,
  type BulkEditField,
} from './inspectionColumns'
import { InspectionCell } from './InspectionCell'

interface BulkEditBarProps {
  count: number
  methodOptions: string[]
  onManageMethods: () => void
  onApply: (field: BulkEditField, value: string | number | null) => void
  onClear: () => void
}

/** Shown while rows are selected: set one user-owned column on every selected row. */
export function BulkEditBar({ count, methodOptions, onManageMethods, onApply, onClear }: BulkEditBarProps) {
  const [field, setField] = useState<BulkEditField>('inspection_method')
  const [value, setValue] = useState<string | number | null>(null)
  const col = COLUMNS.find((c) => c.key === field)

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-plm-border bg-plm-accent/10 text-xs shrink-0">
      <span className="font-medium text-plm-fg">{t('source.inspection.selectedCount', { count })}</span>
      <span className="text-plm-fg/70">{t('source.inspection.bulkField')}</span>
      <select
        value={field}
        onChange={(e) => {
          setField(e.target.value as BulkEditField)
          setValue(null)
        }}
        className="bg-plm-bg border border-plm-border rounded px-1 py-0.5 text-xs"
      >
        {BULK_EDIT_FIELDS.map((key) => {
          const def = COLUMNS.find((c) => c.key === key)
          return (
            <option key={key} value={key}>
              {def ? columnLabel(def) : key}
            </option>
          )
        })}
      </select>
      <span className="text-plm-fg/70">{t('source.inspection.bulkValue')}</span>
      {col && (
        <div className="w-40">
          <InspectionCell
            key={field}
            col={col}
            value={value}
            editable
            onChange={(next) => setValue(typeof next === 'boolean' ? null : next)}
            methodOptions={methodOptions}
            onManageMethods={onManageMethods}
          />
        </div>
      )}
      <button
        type="button"
        onClick={() => onApply(field, value)}
        className="btn btn-primary btn-sm"
      >
        {t('source.inspection.bulkApply')}
      </button>
      <div className="flex-1" />
      <button
        type="button"
        onClick={onClear}
        className="flex items-center gap-1 text-plm-fg/70 hover:text-plm-fg"
        title={t('source.inspection.bulkClear')}
      >
        <X size={12} />
        {t('source.inspection.bulkClear')}
      </button>
    </div>
  )
}
