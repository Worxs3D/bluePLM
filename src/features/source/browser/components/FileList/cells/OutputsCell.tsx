/**
 * Outputs column cell: on a checked-in drawing, one icon each for its PDF, its STEP and its newest
 * inspection report (the column is first by default). An up-to-date one is coloured and a click
 * shows it in the Preview tab; one of an older version than the drawing has an amber mark that
 * turns into a regenerate button on hover, and a click regenerates it for the latest version (a
 * spinner while that runs); a missing one is faint and a click generates it. Without permission
 * to generate, a stale or missing icon only explains itself.
 */
import { memo, type ReactNode } from 'react'
import { Box, FileSpreadsheet, FileText, History, Loader2, RefreshCw } from 'lucide-react'

import {
  generateForDrawing,
  regenerateReport,
} from '@/features/integrations/solidworks/inspection/reports/reportCommands'
import { generateOutputs, regenerateOutput } from '@/features/source/outputs/outputCommands'
import { isActiveJob, isStaleOutput } from '@/features/source/outputs/outputRowModel'
import { selectChildRow } from '@/features/source/outputs/preview/selectChildRow'
import { t } from '@/lib/i18n'
import { isDrawingFile } from '@/lib/outputs/kinds'
import { hasDesktop } from '@/lib/platform'
import { usePDMStore } from '@/stores/pdmStore'
import { outputJobKey } from '@/stores/slices/outputsSlice'
import type { VersionOutputKind } from '@/types/versionOutputs'

import { outdatedReportVersion, reportHeads } from '../childRowStatus'
import type { CellRendererBaseProps } from './types'

type SlotState = 'current' | 'stale' | 'missing' | 'busy'

function Slot({
  state,
  icon,
  title,
  onClick,
}: {
  state: SlotState
  icon: ReactNode
  title: string
  onClick?: () => void
}) {
  const tone =
    state === 'missing' ? 'opacity-30 hover:opacity-80' : state === 'busy' ? 'text-plm-fg-muted' : ''
  return (
    <button
      type="button"
      className={`group/slot relative flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-plm-bg-light ${tone} ${onClick ? '' : 'cursor-default'}`}
      title={title}
      onClick={(e) => {
        e.stopPropagation()
        onClick?.()
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {state === 'busy' ? (
        <Loader2 size={13} className="animate-spin" />
      ) : state === 'stale' && onClick ? (
        <>
          <span className="group-hover/slot:hidden">{icon}</span>
          <RefreshCw size={13} className="hidden text-amber-400 group-hover/slot:block" />
        </>
      ) : (
        icon
      )}
      {state === 'stale' && (
        <History size={9} className="absolute -right-0.5 -top-0.5 text-amber-400 group-hover/slot:hidden" />
      )}
    </button>
  )
}

const KIND_ICON: Record<'pdf' | 'step', (muted: boolean) => ReactNode> = {
  pdf: (muted) => <FileText size={13} className={muted ? '' : 'text-red-400'} />,
  step: (muted) => <Box size={13} className={muted ? '' : 'text-sky-400'} />,
}

export const OutputsCell = memo(function OutputsCell({ file }: CellRendererBaseProps): ReactNode {
  const fileId = file.pdmData?.id
  const latest = file.pdmData?.version ?? null
  const heads = usePDMStore((s) => (fileId ? s.fileOutputHeads.get(fileId) : undefined))
  const jobs = usePDMStore((s) => s.outputJobs)
  const reports = usePDMStore((s) => (fileId ? s.drawingInspectionReports.get(fileId) : undefined))
  const versionOf = usePDMStore((s) => s.reportVersionNumbers)
  const regenerating = usePDMStore((s) => s.regeneratingReportIds)
  const canGenerate = usePDMStore(
    (s) => hasDesktop() && (s.getEffectiveRole() === 'admin' || s.hasPermission('module:explorer', 'edit')),
  )
  const canEditReports = usePDMStore((s) => s.getEffectiveRole() === 'admin' || s.hasPermission('module:explorer', 'edit'))

  if (file.isDirectory || !fileId || !latest || !isDrawingFile(file.path)) return null

  const outputSlot = (kind: 'pdf' | 'step') => {
    const label = kind.toUpperCase()
    const head = heads?.find((o) => o.kind === kind && o.configuration === null) ?? null
    const busy = isActiveJob(jobs.get(outputJobKey(fileId, kind as VersionOutputKind, null)))
    const stale = !!head && isStaleOutput(head, latest)
    const state: SlotState = busy ? 'busy' : !head ? 'missing' : stale ? 'stale' : 'current'
    if (heads === undefined && !busy) {
      return <Slot key={kind} state="missing" icon={KIND_ICON[kind](true)} title={t('fileBrowser.outputsCell.loading')} />
    }
    const preview = head
      ? () => selectChildRow({ kind: 'output', filePath: file.path, fileId, version: head.version, output: head })
      : undefined
    const title =
      state === 'busy'
        ? t('fileBrowser.outputsCell.generating', { kind: label })
        : state === 'missing'
          ? t(canGenerate ? 'fileBrowser.outputsCell.missing' : 'fileBrowser.outputsCell.missingReadOnly', { kind: label })
          : state === 'stale'
            ? t(canGenerate ? 'fileBrowser.outputsCell.stale' : 'fileBrowser.outputsCell.staleReadOnly', {
                kind: label,
                version: head!.version,
                latest,
              })
            : t('fileBrowser.outputsCell.current', { kind: label, version: head!.version })
    const onClick =
      state === 'missing'
        ? canGenerate
          ? () => generateOutputs([file], kind)
          : undefined
        : state === 'stale'
          ? canGenerate
            ? () => regenerateOutput(file, head!)
            : preview
          : preview
    return <Slot key={kind} state={state} icon={KIND_ICON[kind](state === 'missing')} title={title} onClick={onClick} />
  }

  const reportSlot = () => {
    const listed = reportHeads(reports ?? [])
    const newest = listed[0] ?? null
    const reportVersion = newest ? (versionOf.get(newest.fileVersionId) ?? null) : null
    const stale = !!newest && outdatedReportVersion(newest, listed, versionOf, latest) !== null
    const busy = !!newest && regenerating.has(newest.id)
    const state: SlotState = busy ? 'busy' : !newest ? 'missing' : stale ? 'stale' : 'current'
    const preview = newest
      ? () => selectChildRow({ kind: 'report', filePath: file.path, fileId, version: reportVersion, report: newest })
      : undefined
    const title =
      reports === undefined
        ? t('fileBrowser.outputsCell.reportLoading')
        : state === 'busy'
          ? t('source.inspection.rptRegenerating')
          : state === 'missing'
            ? t(canEditReports ? 'fileBrowser.outputsCell.reportMissing' : 'fileBrowser.outputsCell.reportMissingReadOnly')
            : state === 'stale'
              ? t(canEditReports ? 'fileBrowser.outputsCell.reportStale' : 'fileBrowser.outputsCell.reportStaleReadOnly', {
                  number: newest!.reportNumber ?? '',
                  version: reportVersion ?? '',
                  latest,
                })
              : t('fileBrowser.outputsCell.reportCurrent', { number: newest!.reportNumber ?? '', version: reportVersion ?? '' })
    const onClick =
      reports === undefined
        ? undefined
        : state === 'missing'
          ? canEditReports
            ? () => void generateForDrawing(file)
            : undefined
          : state === 'stale' && canEditReports
            ? () => void regenerateReport(file, newest!, 'latest')
            : preview
    return (
      <Slot
        key="report"
        state={state}
        icon={<FileSpreadsheet size={13} className={state === 'missing' ? '' : 'text-emerald-400'} />}
        title={title}
        onClick={onClick}
      />
    )
  }

  return (
    <div className="flex items-center gap-0.5">
      {outputSlot('pdf')}
      {outputSlot('step')}
      {reportSlot()}
    </div>
  )
})
