import { describe, expect, it, vi } from 'vitest'

vi.mock('./reportActions', () => ({ generateReport: vi.fn(), rowsAtVersion: vi.fn() }))
vi.mock('./reportCommands', () => ({ loadReportContext: vi.fn(), publishReports: vi.fn(), regenerateTypeRequest: vi.fn() }))
vi.mock('./reportSources', () => ({ organizationLogo: vi.fn(), reportIdentity: vi.fn() }))

import type { InspectionReport } from '@/types/inspectionReports'

import type { VersionInfo } from './reportModel'
import { myWorkingCopyReports, pinTargetVersion } from './workingCopyPin'

function version(id: string, n: number, createdBy: string): VersionInfo {
  return { id, version: n, revision: null, partNumber: null, description: null, createdAt: null, createdBy }
}

// Newest first, as the report context holds them.
const versions = [version('v4', 4, 'alice'), version('v3', 3, 'bob'), version('v2', 2, 'alice'), version('v1', 1, 'admin')]
const report = { fileVersionId: 'v1', createdBy: 'alice' }

describe('pinTargetVersion', () => {
  it("is the first version the report's creator checked in after the base", () => {
    expect(pinTargetVersion(report, versions, false)?.id).toBe('v2')
    expect(pinTargetVersion({ fileVersionId: 'v2', createdBy: 'alice' }, versions, false)?.id).toBe('v4')
  })

  it('is the base version when the check-in made none and the drawing is checked in', () => {
    expect(pinTargetVersion({ fileVersionId: 'v4', createdBy: 'alice' }, versions, false)?.id).toBe('v4')
  })

  it('is none while the creator still has the drawing checked out and made no version', () => {
    expect(pinTargetVersion({ fileVersionId: 'v4', createdBy: 'alice' }, versions, true)).toBeNull()
    expect(pinTargetVersion({ fileVersionId: 'v9', createdBy: 'alice' }, versions, false)).toBeNull()
  })
})

describe('myWorkingCopyReports', () => {
  it("keeps the user's own working-copy reports only", () => {
    const r = (id: string, workingCopy: boolean, createdBy: string) => ({ id, workingCopy, createdBy }) as InspectionReport
    const list = [r('a', true, 'alice'), r('b', false, 'alice'), r('c', true, 'bob')]
    expect(myWorkingCopyReports(list, 'alice').map((x) => x.id)).toEqual(['a'])
    expect(myWorkingCopyReports(list, null)).toEqual([])
  })
})
