import { memo, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, BadgeCheck, Box, FileText, Loader2, PenTool, Plus } from 'lucide-react'

import { ConfirmDialog } from '@/components/core/Dialog'
import { t } from '@/lib/i18n'
import { hasDesktop } from '@/lib/platform'
import { outputKindLabel } from '@/lib/outputs/kinds'
import { formatDateTime } from '@/lib/utils/date'
import { formatFileSize } from '@/lib/utils/format'
import {
  deleteOutputWithToast,
  generateOutputs,
  regenerateOutput,
  openOutput,
  outputReasonText,
} from '@/features/source/outputs/outputCommands'
import { OutputMenu } from '@/features/source/outputs/OutputMenu'
import {
  activeChildTargets,
  isChildSelected,
  type ChildPreviewTarget,
} from '@/features/source/outputs/preview/childPreviewModel'
import { childClickMode, clickChildRow, selectChildRow } from '@/features/source/outputs/preview/selectChildRow'
import { outputCopyName, type OutputRowEntry } from '@/features/source/outputs/outputRowModel'
import { usePDMStore, type LocalFile } from '@/stores/pdmStore'

import { ChildSelectionMenu } from './ChildSelectionMenu'
import { ChildChip, ChildNameCell, ChildStaleButton, ChildText, ParentMetadataText } from './ChildRowParts'
import { isParentMetadataColumn } from './childRowStatus'
import type { VersionOutputKind } from '@/types/versionOutputs'

interface FileOutputRowProps {
  file: LocalFile
  entry: OutputRowEntry
  version: number | null
  rowHeight: number
  visibleColumns: { id: string; width: number }[]
  /** The selectable child rows under a file, in list order (Shift-click ranges). */
  childOrder: (filePath: string) => readonly ChildPreviewTarget[]
}

function KindIcon({ kind }: { kind: VersionOutputKind }) {
  if (kind === 'pdf') return <FileText size={14} className="text-red-400" />
  if (kind === 'dxf') return <PenTool size={14} className="text-amber-400" />
  return <Box size={14} className="text-sky-400" />
}


/** "Released · Rev B v3" after a released export's name. */
function ReleasedChip({ entry }: { entry: OutputRowEntry }) {
  const release = entry.released
  if (!release) return null
  const label = release.revision
    ? t('source.outputs.releasedChip', { revision: release.revision, version: release.version })
    : t('source.outputs.releasedChipNoRevision', { version: release.version })
  return (
    <span
      className="inline-flex shrink-0 items-center gap-0.5 rounded bg-emerald-500/15 px-1 py-px text-[10px] text-emerald-400"
      title={t('source.outputs.releasedTitle', { version: release.version })}
    >
      <BadgeCheck size={10} />
      {label}
    </span>
  )
}

/**
 * A version output under an expanded file (after a drawing's referenced files, after a part's or
 * assembly's configurations, before inspection reports): the newest of its kind across the file's
 * versions. One of an older version has a stale mark at the left that generates it for the latest
 * version (a spinner while that runs); the row then moves up to that version. A click on a recorded output selects it
 * and shows it in the Preview tab (`selectChildRow`); double-click opens it; right-click selects it
 * and has the output menu (Delete asks first). Item number, revision and description are the
 * parent file's, as its row shows them. A missing primary output is a "Generate PDF" /
 * "Generate STEP" ghost (click queues it); a queued or running job shows a spinner.
 */
export const FileOutputRow = memo(function FileOutputRow({
  file,
  entry,
  version,
  rowHeight,
  visibleColumns,
  childOrder,
}: FileOutputRowProps) {
  const [menu, setMenu] = useState<{ x: number; y: number; many?: readonly ChildPreviewTarget[] } | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const organization = usePDMStore((s) => s.organization)
  const kind = outputKindLabel(entry.kind)
  const output = entry.output
  const busy = entry.job !== null && (entry.job.status === 'queued' || entry.job.status === 'running')
  const canGenerate = usePDMStore(
    (s) => hasDesktop() && (s.getEffectiveRole() === 'admin' || s.hasPermission('module:explorer', 'edit')),
  )
  const latestVersion = file.pdmData?.version ?? null
  // The queue generates the saved configuration only.
  const canRegenerate = canGenerate && !!output && output.configuration === null

  const name = output ? outputCopyName(output, file, organization) : null
  const label = output
    ? name
    : entry.state === 'running'
      ? t('source.outputs.rowGenerating', { kind })
      : entry.state === 'queued'
        ? t('source.outputs.rowQueued', { kind })
        : t('source.outputs.rowGenerate', { kind })
  const title = output
    ? busy
      ? t('source.outputs.rowRegeneratingTitle', { kind })
      : output.closureExact === false
        ? t('source.outputs.rowApproximateTitle')
        : t('source.outputs.previewRowTitle')
    : entry.state === 'failed'
      ? t('source.outputs.rowFailedTitle', { reason: outputReasonText(entry.job?.detail) })
      : entry.state === 'missing'
        ? t('source.outputs.rowGenerateTitle', { kind })
        : undefined
  const ghost = !output
  const wipTitle = entry.secondary && output ? t('source.outputs.wipTitle', { version: output.version }) : undefined
  const selected = usePDMStore(
    (s) => !!output && isChildSelected(s.childSelection, s.selectedFiles, `output:${output.id}`),
  )
  const target =
    output && file.pdmData?.id
      ? ({ kind: 'output', filePath: file.path, fileId: file.pdmData.id, version, output } as const)
      : null

  return (
    <>
      <tr
        className={`drawing-ref-row hover:bg-plm-bg-light/50 ${ghost && !busy ? 'cursor-pointer' : output ? 'cursor-default' : ''} ${selected || menu ? 'selected' : ''}`}
        aria-selected={output ? selected : undefined}
        style={{ height: rowHeight }}
        title={title}
        onClick={(e) => {
          e.stopPropagation()
          if (ghost && (entry.state === 'missing' || entry.state === 'failed')) generateOutputs([file], entry.kind)
          else if (target && e.detail < 2) clickChildRow(target, childClickMode(e), () => childOrder(file.path))
        }}
        onDoubleClick={(e) => {
          e.stopPropagation()
          if (output) void openOutput(file, output)
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          if (!output) return
          // A right-click inside a selection of several keeps it and offers what applies to all.
          const s = usePDMStore.getState()
          const many = selected ? activeChildTargets(s.childSelection, s.selectedFiles) : []
          if (many.length > 1) {
            setMenu({ x: e.clientX, y: e.clientY, many })
            return
          }
          if (target) selectChildRow(target, { reveal: false })
          setMenu({ x: e.clientX, y: e.clientY })
        }}
      >
        {visibleColumns.map((column) => (
          <td key={column.id} style={{ width: column.width }}>
            {column.id === 'name' ? (
              <ChildNameCell
                rowHeight={rowHeight}
                status={
                  entry.stale && output ? (
                    <ChildStaleButton
                      busy={busy}
                      busyTitle={t('source.outputs.rowRegeneratingTitle', { kind })}
                      title={t(canRegenerate ? 'source.outputs.rowOutdated' : 'source.outputs.rowOutdatedReadOnly', {
                        kind,
                        version: output.version,
                        latest: latestVersion ?? '',
                      })}
                      onRegenerate={canRegenerate ? () => regenerateOutput(file, output) : undefined}
                    />
                  ) : null
                }
                icon={
                  busy && !entry.stale ? (
                    <Loader2 size={14} className="animate-spin text-plm-fg-muted" />
                  ) : entry.state === 'failed' ? (
                    <AlertTriangle size={14} className="text-amber-400" />
                  ) : ghost ? (
                    <Plus size={14} className="text-plm-fg-muted" />
                  ) : (
                    <KindIcon kind={entry.kind} />
                  )
                }
                label={label}
                title={wipTitle ?? title}
                // A work-in-progress export after the released one is secondary information.
                muted={ghost || entry.secondary}
                italic={ghost}
                after={
                  output?.configuration || entry.released ? (
                    <>
                      {output?.configuration ? <ChildChip>{output.configuration}</ChildChip> : null}
                      <ReleasedChip entry={entry} />
                    </>
                  ) : null
                }
              />
            ) : column.id === 'description' && !output ? (
              <ChildText muted>
                {busy
                  ? t('source.outputs.rowWorkingDescription', { version: version ?? '' })
                  : entry.state === 'failed'
                    ? t('source.outputs.rowFailedShort')
                    : t('source.outputs.rowMissingDescription', { version: version ?? '' })}
              </ChildText>
            ) : !output ? null : isParentMetadataColumn(column.id) ? (
              <ParentMetadataText file={file} columnId={column.id} />
            ) : column.id === 'version' && version !== null ? (
              <ChildText>{String(version)}</ChildText>
            ) : column.id === 'extension' ? (
              <ChildText>{kind.toLowerCase()}</ChildText>
            ) : column.id === 'size' ? (
              <ChildText>{formatFileSize(output.fileSize)}</ChildText>
            ) : column.id === 'modifiedTime' ? (
              <ChildText>{formatDateTime(output.generatedAt)}</ChildText>
            ) : null}
          </td>
        ))}
      </tr>
      {menu?.many && (
        <ChildSelectionMenu file={file} targets={menu.many} position={menu} onClose={() => setMenu(null)} />
      )}
      {menu && !menu.many && output && (
        <OutputMenu
          file={file}
          output={output}
          position={menu}
          busy={busy}
          stale={entry.stale}
          released={entry.released !== null}
          onClose={() => setMenu(null)}
          onDelete={() => setConfirmingDelete(true)}
        />
      )}
      {confirmingDelete &&
        output &&
        // In a portal, with events stopped, so the table row's handlers do not see the dialog.
        createPortal(
          <div onClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.stopPropagation()}>
            <ConfirmDialog
              open
              onClose={() => setConfirmingDelete(false)}
              title={t('source.outputs.deleteTitle', { kind })}
              message={t('source.outputs.deleteMessage', { kind, version: version ?? '', name: file.name })}
              confirmText={t('common.delete')}
              cancelText={t('common.cancel')}
              variant="danger"
              onConfirm={() => {
                setConfirmingDelete(false)
                void deleteOutputWithToast(file, output)
              }}
            />
          </div>,
          document.body,
        )}
    </>
  )
})
