/**
 * A report's type as the Reports view and the file list show it: the chip (FAIR, PIR, RIR, RIN;
 * IR for a report from before types), its full name, and a one-line detail (scope and baseline,
 * lot and sampling, supplier and purchase order, NCR).
 */
import { t } from '@/lib/i18n'
import type { InspectionReport } from '@/types/inspectionReports'

import { reportTypeChipKey, reportTypeKey } from './reportTypeModel'

export function reportTypeChip(report: Pick<InspectionReport, 'reportType' | 'faiScope'>): string {
  return t(reportTypeChipKey(report.reportType))
}

/** Full name, with the FAI scope (`First article inspection · Partial FAI`). */
export function reportTypeName(report: Pick<InspectionReport, 'reportType' | 'faiScope'>): string {
  const name = t(reportTypeKey(report.reportType))
  return report.reportType === 'fai' && report.faiScope
    ? `${name} · ${t(`source.inspection.rptFaiScope_${report.faiScope}`)}`
    : name
}

/** What distinguishes this report of its type, or '' (a report from before types). */
export function reportTypeDetail(report: InspectionReport, versionNumberOf: (fileVersionId: string) => number | null): string {
  const parts: string[] = []
  switch (report.reportType) {
    case 'fai': {
      if (report.faiScope) parts.push(t(`source.inspection.rptFaiScope_${report.faiScope}`))
      const baseline = report.faiBaselineVersionId ? versionNumberOf(report.faiBaselineVersionId) : null
      if (report.faiScope === 'partial' && baseline !== null) parts.push(t('source.inspection.rptTypeBaseline', { version: baseline }))
      if (report.faiReason) parts.push(t(`source.inspection.rptFaiReason_${report.faiReason}`))
      break
    }
    case 'production':
    case 'receiving': {
      if (report.reportType === 'receiving' && report.supplierName) parts.push(report.supplierName)
      if (report.reportType === 'receiving' && report.poNumber) parts.push(report.poNumber)
      if (report.lotNumber) parts.push(t('source.inspection.rptTypeLot', { lot: report.lotNumber }))
      if (report.sampling) {
        parts.push(
          report.sampling.plan === '100'
            ? t('source.inspection.rptSampling_100')
            : t('source.inspection.rptSampling_fixed', { n: report.sampling.n }),
        )
      }
      break
    }
    case 'reinspection':
      if (report.ncrReference) parts.push(t('source.inspection.rptTypeNcr', { ncr: report.ncrReference }))
      break
    default:
      break
  }
  return parts.join(' · ')
}
