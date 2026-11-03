import { describe, expect, it } from 'vitest'

import type { InspectionReport, InspectionTemplate } from '@/types/inspectionReports'

import type { TemplateChoice } from './reportModel'
import { templateMenuEntries } from './templateMenuModel'

const org = (id: string, name: string): TemplateChoice => ({
  kind: 'org',
  template: { id, name } as InspectionTemplate,
})
const builtin: TemplateChoice = { kind: 'builtin', key: 'fai', name: 'AS9102 FAI', reportTypes: ['fai'], defaultFor: ['fai'] }

function report(id: string, over: Partial<InspectionReport>): InspectionReport {
  return {
    id,
    fileVersionId: 'v1',
    templateId: null,
    templateName: null,
    supersedesReportId: null,
    createdAt: '2026-11-01T00:00:00Z',
    reportNumber: id,
    ...over,
  } as InspectionReport
}

const versionOf = new Map([
  ['v1', 1],
  ['v2', 2],
])

describe('templateMenuEntries', () => {
  it('names the newest listed report of each template and whether it is out of date', () => {
    const reports = [
      report('a', { templateId: 't1', fileVersionId: 'v1' }),
      report('b', { templateName: 'AS9102 FAI', fileVersionId: 'v2', createdAt: '2026-11-02T00:00:00Z' }),
    ]
    const entries = templateMenuEntries([org('t1', 'Ours'), org('t2', 'Other'), builtin], reports, versionOf, 2)
    expect(entries.map((e) => [e.name, e.report?.id ?? null, e.reportVersion, e.stale])).toEqual([
      ['Ours', 'a', 1, true],
      ['Other', null, null, false],
      ['AS9102 FAI', 'b', 2, false],
    ])
  })

  it('takes the regeneration, not the report it superseded', () => {
    const reports = [
      report('old', { templateId: 't1', fileVersionId: 'v1', createdAt: '2026-11-03T00:00:00Z' }),
      report('new', { templateId: 't1', fileVersionId: 'v2', supersedesReportId: 'old' }),
    ]
    const [entry] = templateMenuEntries([org('t1', 'Ours')], reports, versionOf, 2)
    expect([entry.report?.id, entry.stale]).toEqual(['new', false])
  })

  it('does not match an organization template by name', () => {
    const reports = [report('a', { templateId: null, templateName: 'Ours' })]
    expect(templateMenuEntries([org('t1', 'Ours')], reports, versionOf, 2)[0].report).toBeNull()
  })
})
