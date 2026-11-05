import { describe, expect, it } from 'vitest'

import { outdatedReportVersion, reportHeads } from './childRowStatus'

const report = (id: string, version: string, reportType: 'fai' | 'production' | null, createdAt = '2026-01-01') => ({
  id,
  fileVersionId: version,
  reportType,
  createdAt,
})
const versions = new Map([
  ['v1', 1],
  ['v2', 2],
  ['v3', 3],
])

describe('outdatedReportVersion', () => {
  it('flags the newest report of a type made of an older version', () => {
    const fai = report('a', 'v2', 'fai')
    expect(outdatedReportVersion(fai, [fai], versions, 3)).toBe(3)
  })

  it('does not flag a report of the latest version, or one of an unknown version', () => {
    const fai = report('a', 'v3', 'fai')
    expect(outdatedReportVersion(fai, [fai], versions, 3)).toBeNull()
    const unknown = report('b', 'v9', 'fai')
    expect(outdatedReportVersion(unknown, [unknown], versions, 3)).toBeNull()
    expect(outdatedReportVersion(report('c', 'v2', 'fai'), [], versions, null)).toBeNull()
  })

  it('never flags a report of a checked-out copy, nor counts one as newer', () => {
    const copy = { ...report('w', 'v2', 'fai', '2026-02-01'), workingCopy: true }
    expect(outdatedReportVersion(copy, [copy], versions, 3)).toBeNull()
    const fai = report('a', 'v2', 'fai')
    expect(outdatedReportVersion(fai, [fai, copy], versions, 3)).toBe(3)
  })

  it('does not flag a report superseded by a newer one of the same type', () => {
    const old = report('a', 'v1', 'fai')
    const newer = report('b', 'v2', 'fai')
    const all = [old, newer]
    expect(outdatedReportVersion(old, all, versions, 3)).toBeNull()
    expect(outdatedReportVersion(newer, all, versions, 3)).toBe(3)
  })

  it('breaks a tie on the same version by creation time', () => {
    const first = report('a', 'v2', 'fai', '2026-01-01')
    const second = report('b', 'v2', 'fai', '2026-01-02')
    const all = [first, second]
    expect(outdatedReportVersion(first, all, versions, 3)).toBeNull()
    expect(outdatedReportVersion(second, all, versions, 3)).toBe(3)
  })

  it('judges each type on its own; untyped reports form their own group', () => {
    const fai = report('a', 'v3', 'fai')
    const production = report('b', 'v2', 'production')
    const legacy = report('c', 'v1', null)
    const all = [fai, production, legacy]
    expect(outdatedReportVersion(production, all, versions, 3)).toBe(3)
    expect(outdatedReportVersion(legacy, all, versions, 3)).toBe(3)
  })
})

describe('reportHeads', () => {
  const r = (id: string, supersedesReportId: string | null = null) => ({ id, supersedesReportId })

  it('drops a report another listed report supersedes, keeping copies and pre-508 reports', () => {
    const heads = reportHeads([r('new', 'old'), r('old'), r('copy'), r('legacy')])
    expect(heads.map((x) => x.id)).toEqual(['new', 'copy', 'legacy'])
  })

  it('follows a chain of regenerations to its newest report', () => {
    expect(reportHeads([r('c', 'b'), r('b', 'a'), r('a')]).map((x) => x.id)).toEqual(['c'])
  })

  it('keeps a report whose successor is not listed', () => {
    expect(reportHeads([r('b', 'gone')]).map((x) => x.id)).toEqual(['b'])
  })
})
