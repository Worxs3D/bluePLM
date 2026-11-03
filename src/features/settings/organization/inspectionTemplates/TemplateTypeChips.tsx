import { Star } from 'lucide-react'

import { t } from '@/lib/i18n'
import { INSPECTION_REPORT_TYPES, type InspectionReportType } from '@/types/inspectionReports'
import {
  reportTypeChipKey,
  reportTypeKey,
} from '@/features/integrations/solidworks/inspection/reports/reportTypeModel'

interface TemplateTypeChipsProps {
  reportTypes: readonly InspectionReportType[]
  defaultFor: readonly InspectionReportType[]
  /** Administrators toggle the types; null shows them read-only. */
  onToggle: ((type: InspectionReportType) => void) | null
  disabled?: boolean
}

/**
 * The report types a template serves, as chips (FAIR, PIR, RIR, RIN): filled when it serves the
 * type, with a star when it is the organization's default for it. No type selected means any
 * type. Administrators click a chip to add or remove the type.
 */
export function TemplateTypeChips({ reportTypes, defaultFor, onToggle, disabled }: TemplateTypeChipsProps) {
  const any = reportTypes.length === 0
  const shown = onToggle ? INSPECTION_REPORT_TYPES : reportTypes
  return (
    <div className="flex flex-wrap items-center gap-1" aria-label={t('source.inspection.tplTypes')}>
      <span className="mr-0.5 text-[11px] text-ui-fg-tertiary" title={t('source.inspection.tplTypesHint')}>
        {any ? t('source.inspection.tplTypesAny') : t('source.inspection.tplTypes')}
      </span>
      {shown.map((type) => {
        const on = reportTypes.includes(type)
        const isDefault = defaultFor.includes(type)
        const title = [
          t(reportTypeKey(type)),
          isDefault ? t('source.inspection.tplDefaultForType', { type: t(reportTypeChipKey(type)) }) : null,
        ]
          .filter(Boolean)
          .join(' · ')
        const className = `inline-flex h-5 items-center gap-0.5 rounded px-1.5 text-[11px] font-medium tracking-wide transition-colors ${
          on
            ? 'bg-ui-accent/15 text-ui-fg'
            : 'border border-dashed border-ui-field-border text-ui-fg-tertiary'
        }`
        const content = (
          <>
            {isDefault && <Star size={10} className="fill-current text-ui-accent" aria-hidden />}
            {t(reportTypeChipKey(type))}
          </>
        )
        return onToggle ? (
          <button
            key={type}
            type="button"
            aria-pressed={on}
            title={title}
            disabled={disabled}
            onClick={() => onToggle(type)}
            className={`${className} hover:border-ui-accent/50 hover:text-ui-fg disabled:opacity-50`}
          >
            {content}
          </button>
        ) : (
          <span key={type} title={title} className={className}>
            {content}
          </span>
        )
      })}
    </div>
  )
}
