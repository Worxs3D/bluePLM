import { Callout } from '@/components/core/ui'
import { t } from '@/lib/i18n'
import type { TemplateLayout } from '@/lib/inspection/excel'
import { templateIssueText } from '@/lib/inspection/issueText'

import { layoutSummary } from './templateModel'

/** What `analyzeTemplate` found: where the table and drawing go, and every error and warning. */
export function TemplateAnalysisPanel({ layout }: { layout: TemplateLayout }) {
  const summary = layoutSummary(layout)
  const rows: Array<[string, string]> = [
    [t('source.inspection.tplSumTable'), summary.tableAt ?? t('source.inspection.tplSumNone')],
    [t('source.inspection.tplSumFields'), summary.fields.length > 0 ? summary.fields.join(', ') : t('source.inspection.tplSumNone')],
    [
      t('source.inspection.tplSumResults'),
      t('source.inspection.tplSumResultsValue', {
        count: summary.resultCount,
        verdict: summary.hasVerdict ? t('source.inspection.tplSumYes') : t('source.inspection.tplSumNo'),
      }),
    ],
    [t('source.inspection.tplSumDrawing'), summary.drawingAt ?? t('source.inspection.tplSumDrawingAdded')],
    [t('source.inspection.tplSumScalars'), String(summary.scalarCount)],
  ]
  if (summary.entries.length > 0) rows.push([t('source.inspection.tplSumEntries'), summary.entries.join(', ')])
  if (summary.inputs.length > 0) rows.push([t('source.inspection.tplSumInputs'), summary.inputs.join(', ')])
  if (summary.properties.length > 0) rows.push([t('source.inspection.tplSumProperties'), summary.properties.join(', ')])

  return (
    <div className="flex flex-col gap-2">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-ui-fg-secondary">{label}</dt>
            <dd className="break-words text-ui-fg">{value}</dd>
          </div>
        ))}
      </dl>
      {layout.errors.length > 0 && (
        <Callout tone="error" title={t('source.inspection.tplErrorsTitle', { count: layout.errors.length })}>
          <ul className="list-disc pl-4">
            {layout.errors.map((issue, i) => (
              <li key={`${issue.code}-${i}`}>{templateIssueText(issue)}</li>
            ))}
          </ul>
        </Callout>
      )}
      {layout.warnings.length > 0 && (
        <Callout tone="warning" title={t('source.inspection.tplWarningsTitle', { count: layout.warnings.length })}>
          <ul className="list-disc pl-4">
            {layout.warnings.map((issue, i) => (
              <li key={`${issue.code}-${i}`}>{templateIssueText(issue)}</li>
            ))}
          </ul>
        </Callout>
      )}
    </div>
  )
}
