import { describe, expect, it } from 'vitest'

import type { LocalFile } from '@/stores/pdmStore'
import type { InspectionReport } from '@/types/inspectionReports'
import type { VersionedOutput } from '@/types/versionOutputs'
import type { OutputRowEntry } from '@/features/source/outputs/outputRowModel'

import { childTargetsUnder } from './childRowOrder'
import type { VirtualRow } from './rowTypes'

const file = (path: string) => ({ path, name: path, pdmData: { id: `id-${path}`, version: 2 } }) as unknown as LocalFile
const entry = (id: string | null) =>
  ({ kind: 'pdf', output: id ? ({ id, fileVersionId: 'v2', version: 2 } as VersionedOutput) : null }) as OutputRowEntry
const report = (id: string) => ({ id, fileVersionId: 'v1' }) as InspectionReport

describe('childTargetsUnder', () => {
  it('lists recorded outputs and reports of one file in row order, each report once', () => {
    const a = file('a.slddrw')
    const b = file('b.slddrw')
    const rows: VirtualRow[] = [
      { type: 'file-output', file: a, entry: entry('o1'), version: 2 },
      { type: 'file-output', file: a, entry: entry(null), version: 2 },
      { type: 'file-output', file: b, entry: entry('o2'), version: 2 },
      { type: 'drawing-report', file: a, report: report('r1') },
      { type: 'drawing-report', file: a, report: report('r1'), received: true },
      { type: 'drawing-report', file: a, report: report('r2') },
    ]
    const targets = childTargetsUnder(rows, 'a.slddrw', new Map([['v1', 1]]))
    expect(targets.map((t) => (t.kind === 'output' ? t.output.id : t.report.id))).toEqual(['o1', 'r1', 'r2'])
    expect(targets[1].version).toBe(1)
  })
})
