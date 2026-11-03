/**
 * Generate > On server / Local > Inspection report: one entry per available template, and on the
 * server side the report already generated from it, if any. Pure: the menu and the tests call it.
 *
 * A template's report is the newest report the file list shows (`reportHeads`) that was made from
 * it: an organization template by id, a built-in by name. Clicking an entry with an out-of-date
 * report regenerates it for the latest version (the new report replaces it); an up-to-date one is
 * not generated again, it opens; an entry without a report generates one.
 */
import { reportHeads } from '@/features/source/browser/components/FileList/childRowStatus'
import type { InspectionReport } from '@/types/inspectionReports'

import type { TemplateChoice } from './reportModel'

export interface TemplateMenuEntry {
  choice: TemplateChoice
  name: string
  /** The newest listed report made from this template; null when there is none. */
  report: InspectionReport | null
  /** That report's version number, when known. */
  reportVersion: number | null
  /** The report is of an older version than the drawing's latest. */
  stale: boolean
}

export function templateChoiceName(choice: TemplateChoice): string {
  return choice.kind === 'org' ? choice.template.name : choice.name
}

function madeFrom(report: InspectionReport, choice: TemplateChoice): boolean {
  if (choice.kind === 'org') return report.templateId === choice.template.id
  return report.templateId === null && report.templateName === choice.name
}

export function templateMenuEntries(
  choices: readonly TemplateChoice[],
  reports: readonly InspectionReport[],
  versionOf: ReadonlyMap<string, number>,
  latestVersion: number | null,
): TemplateMenuEntry[] {
  // Newest first, so the first match is the template's current report.
  const heads = reportHeads(reports).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return choices.map((choice) => {
    const report = heads.find((r) => madeFrom(r, choice)) ?? null
    const reportVersion = report ? (versionOf.get(report.fileVersionId) ?? null) : null
    return {
      choice,
      name: templateChoiceName(choice),
      report,
      reportVersion,
      stale: reportVersion !== null && latestVersion !== null && reportVersion < latestVersion,
    }
  })
}
