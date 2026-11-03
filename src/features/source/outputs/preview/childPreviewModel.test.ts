import { describe, expect, it } from 'vitest'

import type { InspectionReport } from '@/types/inspectionReports'
import type { VersionOutput, VersionOutputKind } from '@/types/versionOutputs'

import {
  activeChildSelection,
  childKey,
  childSelectionParent,
  isChildSelected,
  PREVIEW_MAX_BYTES,
  previewContentOf,
  previewKindForOutput,
  previewKindOf,
  resolveLiveTarget,
  tooLargeToPreview,
  type ChildPreviewTarget,
  type ChildSelection,
} from './childPreviewModel'

const PATH = 'C:\\Vault\\A.SLDDRW'

function output(kind: VersionOutputKind, over: Partial<VersionOutput> = {}): VersionOutput {
  return {
    id: `out-${kind}`,
    kind,
    fileId: 'file-1',
    fileVersionId: 'ver-3',
    configuration: null,
    storageHash: 'a'.repeat(64),
    fileSize: 1000,
    fileName: null,
    closureExact: true,
    generatedBy: null,
    generatedAt: '2026-11-01T00:00:00Z',
    ...over,
  }
}

function report(over: Partial<InspectionReport> = {}): InspectionReport {
  return {
    id: 'rep-1',
    storageHash: 'b'.repeat(64),
    fileSize: 2000,
    returnedHash: null,
    status: 'issued',
    ...over,
  } as InspectionReport
}

const outputTarget = (o = output('pdf')): ChildPreviewTarget => ({ kind: 'output', filePath: PATH, fileId: 'file-1', version: 3, output: o })
const reportTarget = (r = report()): ChildPreviewTarget => ({ kind: 'report', filePath: PATH, fileId: 'file-1', version: 3, report: r })

describe('child row selection', () => {
  it('is active only while the file selection is the array it was anchored to', () => {
    const anchor = [PATH]
    const selection: ChildSelection = { target: outputTarget(), anchor }
    expect(activeChildSelection(selection, anchor)).toBe(selection.target)
    // A click on the parent row (or any row) writes a new array, even with the same path.
    expect(activeChildSelection(selection, [PATH])).toBeNull()
    expect(activeChildSelection(selection, [])).toBeNull()
    expect(activeChildSelection(null, anchor)).toBeNull()
  })

  it('needs the anchor to hold exactly the parent file', () => {
    const anchor = ['C:\\Vault\\Other.SLDDRW']
    expect(activeChildSelection({ target: outputTarget(), anchor }, anchor)).toBeNull()
    const two = [PATH, 'C:\\Vault\\B.SLDPRT']
    expect(activeChildSelection({ target: outputTarget(), anchor: two }, two)).toBeNull()
  })

  it('marks one row selected and the parent as the row that gives up its highlight', () => {
    const anchor = [PATH]
    const selection: ChildSelection = { target: reportTarget(), anchor }
    expect(isChildSelected(selection, anchor, 'report:rep-1')).toBe(true)
    expect(isChildSelected(selection, anchor, 'output:out-pdf')).toBe(false)
    expect(isChildSelected(selection, [PATH], 'report:rep-1')).toBe(false)
    expect(childSelectionParent(selection, anchor)).toBe(PATH)
    expect(childSelectionParent(selection, [PATH])).toBeNull()
  })

  it('keys outputs and reports apart', () => {
    expect(childKey(outputTarget())).toBe('output:out-pdf')
    expect(childKey(reportTarget())).toBe('report:rep-1')
  })
})

describe('preview kind', () => {
  it('resolves each output kind and reports', () => {
    expect(previewKindForOutput('pdf')).toEqual({ kind: 'pdf' })
    expect(previewKindForOutput('step')).toEqual({ kind: 'model', format: 'step' })
    expect(previewKindForOutput('iges')).toEqual({ kind: 'model', format: 'iges' })
    expect(previewKindForOutput('stl')).toEqual({ kind: 'model', format: 'stl' })
    expect(previewKindForOutput('dxf')).toEqual({ kind: 'none' })
    expect(previewKindOf(reportTarget())).toEqual({ kind: 'workbook' })
  })

  it('previews a returned workbook when there is one, the generated one otherwise', () => {
    expect(previewContentOf(reportTarget())).toEqual({ hash: 'b'.repeat(64), size: 2000, returned: false })
    expect(previewContentOf(reportTarget(report({ returnedHash: 'c'.repeat(64) })))).toEqual({
      hash: 'c'.repeat(64),
      size: null,
      returned: true,
    })
    expect(previewContentOf(outputTarget())).toEqual({ hash: 'a'.repeat(64), size: 1000, returned: false })
  })

  it('refuses a recorded size over the cap before downloading', () => {
    expect(tooLargeToPreview('model', PREVIEW_MAX_BYTES.model + 1)).toBe(true)
    expect(tooLargeToPreview('model', PREVIEW_MAX_BYTES.model)).toBe(false)
    expect(tooLargeToPreview('workbook', null)).toBe(false)
    expect(tooLargeToPreview('none', 10 ** 12)).toBe(false)
  })
})

describe('resolveLiveTarget', () => {
  it('follows the store to the current row and keeps the clicked one when it is gone', () => {
    const clicked = reportTarget()
    const live = report({ status: 'returned', returnedHash: 'c'.repeat(64) })
    const resolved = resolveLiveTarget(clicked, { reportsByFile: new Map([['file-1', [live]]]), outputsByVersion: new Map() })
    expect(resolved.kind === 'report' && resolved.report).toBe(live)
    expect(resolveLiveTarget(clicked, { reportsByFile: new Map(), outputsByVersion: new Map() })).toBe(clicked)

    const out = outputTarget()
    const regenerated = output('pdf', { storageHash: 'd'.repeat(64) })
    const r2 = resolveLiveTarget(out, { reportsByFile: new Map(), outputsByVersion: new Map([['ver-3', [regenerated]]]) })
    expect(r2.kind === 'output' && r2.output).toBe(regenerated)
  })
})
