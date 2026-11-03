import { AlertTriangle, ShieldAlert } from 'lucide-react'

import { Badge } from '@/components/core/ui'
import { t } from '@/lib/i18n'
import type { Json } from '@/types/supabase'

import { storedWarningText } from '@/lib/inspection/issueText'
import { parseStoredResults } from './reportModel'

/** Rows drawn before "show all"; a long table stays cheap to render. */
const MAX_ROWS = 500

/** Per balloon: requirement, measured values, verdict and flags of a returned report. */
export function ReportResultsDetail({ results }: { results: Json | null }) {
  const stored = parseStoredResults(results)
  if (!stored) {
    return <div className="px-3 py-2 text-xs text-plm-fg-muted">{t('source.inspection.rptNoResults')}</div>
  }
  const entries = Object.entries(stored.entries).filter(([, v]) => v)
  const rows = stored.rows.slice(0, MAX_ROWS)

  return (
    <div className="flex flex-col gap-2 px-3 py-2">
      {entries.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
          {entries.map(([name, value]) => (
            <div key={name} className="contents">
              <dt className="text-plm-fg-muted">{name}</dt>
              <dd className="text-plm-fg">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {stored.warnings.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-xs text-plm-warning">
          {stored.warnings.map((code) => (
            <li key={code} className="flex items-center gap-1">
              <AlertTriangle size={11} />
              {storedWarningText(code)}
            </li>
          ))}
        </ul>
      )}
      <table className="w-full text-xs">
        <thead className="text-left text-plm-fg-muted">
          <tr>
            <th className="py-1 pr-2 font-normal">{t('source.inspection.rptBalloon')}</th>
            <th className="py-1 pr-2 font-normal">{t('source.inspection.rptRequirement')}</th>
            <th className="py-1 pr-2 font-normal">{t('source.inspection.rptMeasured')}</th>
            <th className="py-1 pr-2 font-normal">{t('source.inspection.rptVerdict')}</th>
            <th className="py-1 font-normal">{t('source.inspection.rptFlags')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={`${row.rowId ?? row.sourceKey ?? 'row'}-${i}`} className="border-t border-plm-border/60">
              <td className="py-1 pr-2 font-mono">{row.balloon ?? '—'}</td>
              <td className="py-1 pr-2">{row.requirement || '—'}</td>
              <td className="py-1 pr-2 font-mono">{row.measured.filter(Boolean).join(' / ') || '—'}</td>
              <td className="py-1 pr-2">
                {row.verdict === 'pass' ? (
                  <Badge tone="success">{t('source.inspection.rptPass')}</Badge>
                ) : row.verdict === 'fail' ? (
                  <Badge tone="error">{t('source.inspection.rptFail')}</Badge>
                ) : (
                  <span className="text-plm-fg-muted">—</span>
                )}
              </td>
              <td className="py-1">
                <div className="flex flex-wrap gap-1">
                  {row.tampered && (
                    <Badge tone="error" icon={<ShieldAlert size={10} />}>
                      {t('source.inspection.rptFlagTampered')}
                    </Badge>
                  )}
                  {row.verdictConflict && (
                    <Badge tone="warning" title={row.enteredVerdict}>
                      {t('source.inspection.rptFlagConflict')}
                    </Badge>
                  )}
                  {row.unknown && <Badge tone="warning">{t('source.inspection.rptFlagUnknown')}</Badge>}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {stored.rows.length > MAX_ROWS && (
        <div className="text-xs text-plm-fg-muted">
          {t('source.inspection.rptRowsTruncated', { shown: MAX_ROWS, total: stored.rows.length })}
        </div>
      )}
      {stored.missing.length > 0 && (
        <div className="text-xs text-plm-warning">
          {t('source.inspection.rptMissingRows', { balloons: stored.missing.filter(Boolean).join(', ') || '—' })}
        </div>
      )}
    </div>
  )
}
