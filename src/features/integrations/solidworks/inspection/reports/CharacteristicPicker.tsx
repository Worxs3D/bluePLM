import { Loader2 } from 'lucide-react'

import { Badge, Callout, SegmentedControl } from '@/components/core/ui'
import { t } from '@/lib/i18n'
import { formatSpec, type InspectionReportRow } from '@/lib/inspection/excel'
import { isClassified } from '@/lib/inspection/reportTypes'

import type { CharacteristicMode } from './generateDialogModel'

interface CharacteristicPickerProps {
  /** The version's characteristics; null while they load. */
  rows: readonly InspectionReportRow[] | null
  loadError: string | null
  ticked: ReadonlySet<string>
  /** Partial FAI: ids changed since the baseline (marked); null for other types. */
  changedIds: readonly string[] | null
  editable: boolean
  /** Lot reports: how characteristics are picked; null for other types. */
  mode: CharacteristicMode | null
  modes: { value: CharacteristicMode; label: string }[]
  onMode: (mode: CharacteristicMode) => void
  onToggle: (id: string) => void
  onSetAll: (all: boolean) => void
  error?: string
}

/**
 * The characteristics a report includes, as a compact checklist: balloon, requirement and class
 * per row. Read-only when the type decides (a full FAI, a lot report by class), editable when the
 * user chooses (partial FAI, re-inspection, a lot report set to Choose).
 */
export function CharacteristicPicker({
  rows,
  loadError,
  ticked,
  changedIds,
  editable,
  mode,
  modes,
  onMode,
  onToggle,
  onSetAll,
  error,
}: CharacteristicPickerProps) {
  const changed = new Set(changedIds ?? [])
  const total = rows?.length ?? 0
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex min-h-7 items-center gap-2">
        <span className="text-[12px] text-ui-fg-secondary">{t('source.inspection.rptCharacteristics')}</span>
        {rows && (
          <span className="whitespace-nowrap text-[12px] font-medium text-ui-fg">
            {t('source.inspection.rptCharIncluded', { count: ticked.size, total })}
          </span>
        )}
        {changedIds && rows && (
          <span className="text-[12px] text-ui-fg-tertiary">
            · {t('source.inspection.rptCharChangedCount', { count: changedIds.length })}
          </span>
        )}
        <div className="flex-1" />
        {editable && rows && rows.length > 0 && (
          <div className="flex items-center gap-1 text-[12px]">
            <button type="button" className="rounded px-1.5 py-0.5 text-ui-accent hover:bg-ui-accent/10" onClick={() => onSetAll(true)}>
              {t('source.inspection.rptCharSelectAll')}
            </button>
            <button type="button" className="rounded px-1.5 py-0.5 text-ui-accent hover:bg-ui-accent/10" onClick={() => onSetAll(false)}>
              {t('source.inspection.rptCharSelectNone')}
            </button>
          </div>
        )}
        {mode && (
          <SegmentedControl<CharacteristicMode>
            value={mode}
            options={modes.map((m) => ({
              ...m,
              title: m.value === 'classified' ? t('source.inspection.rptCharClassifiedTitle') : undefined,
            }))}
            onChange={onMode}
            size="sm"
            aria-label={t('source.inspection.rptCharacteristics')}
          />
        )}
      </div>
      <div className="max-h-52 overflow-y-auto overflow-x-hidden rounded-lg border border-ui-border bg-ui-field/40">
        {loadError ? (
          <div className="p-2">
            <Callout tone="error">{loadError}</Callout>
          </div>
        ) : !rows ? (
          <div className="flex h-16 items-center justify-center gap-2 text-[12px] text-ui-fg-secondary">
            <Loader2 size={14} className="animate-spin" />
            {t('source.inspection.rptCharLoading')}
          </div>
        ) : rows.length === 0 ? (
          <div className="px-3 py-4 text-center text-[12px] text-ui-fg-secondary">{t('source.inspection.rptCharNone')}</div>
        ) : (
          // A partial FAI lists the changed characteristics first, the rest after them.
          (changedIds ? [...rows].sort((a, b) => Number(changed.has(b.id)) - Number(changed.has(a.id))) : rows).map((row) => {
            const on = ticked.has(row.id)
            return (
              <label
                key={row.id}
                className={`flex h-7 items-center gap-2 border-b border-ui-border/60 px-2 text-[12px] last:border-b-0 ${
                  editable ? 'cursor-pointer hover:bg-ui-hover/60' : ''
                } ${on ? 'text-ui-fg' : 'text-ui-fg-tertiary'}`}
              >
                <input
                  type="checkbox"
                  checked={on}
                  disabled={!editable}
                  onChange={() => onToggle(row.id)}
                  className="align-middle"
                />
                <span className="w-9 shrink-0 text-right font-medium tabular-nums">{row.balloon_number ?? '—'}</span>
                <span className="inspection-symbols min-w-0 flex-1 truncate" title={formatSpec(row)}>
                  {formatSpec(row) || row.char_type || '—'}
                </span>
                {changed.has(row.id) && (
                  <Badge tone="info" className="!text-[11px] !py-0">
                    {t('source.inspection.rptCharChanged')}
                  </Badge>
                )}
                {row.classification && (
                  <span className={`w-16 shrink-0 truncate text-right ${isClassified(row) ? 'font-medium text-ui-warning' : 'text-ui-fg-tertiary'}`}>
                    {row.classification}
                  </span>
                )}
              </label>
            )
          })
        )}
      </div>
      {error && <span className="text-[11px] text-ui-danger">{t(error)}</span>}
    </div>
  )
}
