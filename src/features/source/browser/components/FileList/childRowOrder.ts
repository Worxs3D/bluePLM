/**
 * The selectable child rows (recorded outputs and inspection reports) under one file, in list
 * order, for Shift-click ranges (`nextChildSelection`). Pure: the file list and the tests call it.
 * A report listed twice (Inspection reports and Received inspections) counts once.
 */
import { childKey, type ChildPreviewTarget } from '@/features/source/outputs/preview/childPreviewModel'

import type { VirtualRow } from './rowTypes'

export function childTargetsUnder(
  rows: readonly VirtualRow[],
  filePath: string,
  reportVersionNumbers: ReadonlyMap<string, number>,
): ChildPreviewTarget[] {
  const out: ChildPreviewTarget[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    if (row.type !== 'file-output' && row.type !== 'drawing-report') continue
    if (row.file.path !== filePath) continue
    const fileId = row.file.pdmData?.id
    if (!fileId) continue
    const target: ChildPreviewTarget | null =
      row.type === 'file-output'
        ? row.entry.output
          ? { kind: 'output', filePath, fileId, version: row.version, output: row.entry.output }
          : null
        : {
            kind: 'report',
            filePath,
            fileId,
            version: reportVersionNumbers.get(row.report.fileVersionId) ?? null,
            report: row.report,
          }
    if (!target || seen.has(childKey(target))) continue
    seen.add(childKey(target))
    out.push(target)
  }
  return out
}
