import { useState } from 'react'
import { createPortal } from 'react-dom'
import { FolderDown, Trash2 } from 'lucide-react'

import { ConfirmDialog } from '@/components/core/Dialog'
import { t } from '@/lib/i18n'
import { hasDesktop } from '@/lib/platform'
import { usePDMStore, type LocalFile } from '@/stores/pdmStore'
import type { ChildPreviewTarget } from '@/features/source/outputs/preview/childPreviewModel'
import { deleteOutputWithToast, saveOutputNextToFileWithToast } from '@/features/source/outputs/outputCommands'
import {
  deleteReportWithToast,
  saveReportNextToFile,
} from '@/features/integrations/solidworks/inspection/reports/reportCommands'
import { canDeleteReport } from '@/features/integrations/solidworks/inspection/reports/reportModel'

interface ChildSelectionMenuProps {
  file: LocalFile
  /** The selected child rows (two or more), all under `file`. */
  targets: readonly ChildPreviewTarget[]
  position: { x: number; y: number }
  onClose: () => void
}

/** Whether this user may delete the row (the server checks again; a released one is refused there). */
function mayDelete(target: ChildPreviewTarget, userId: string | undefined, isAdmin: boolean, canEdit: boolean): boolean {
  if (target.kind === 'report') return canDeleteReport(target.report, userId, isAdmin)
  return isAdmin || (canEdit && !!userId && target.output.generatedBy === userId)
}

async function deleteAll(file: LocalFile, targets: readonly ChildPreviewTarget[]): Promise<void> {
  let deleted = 0
  for (const target of targets) {
    const ok =
      target.kind === 'report'
        ? await deleteReportWithToast(target.report, { quiet: true })
        : await deleteOutputWithToast(file, target.output, { quiet: true })
    if (ok) deleted++
  }
  const state = usePDMStore.getState()
  state.setChildSelection(null)
  if (deleted > 0) state.addToast('success', t('source.outputs.multiDeleted', { count: deleted, total: targets.length }))
}

async function saveAllNextToFile(file: LocalFile, targets: readonly ChildPreviewTarget[]): Promise<void> {
  for (const target of targets) {
    if (target.kind === 'report') await saveReportNextToFile(file, target.report)
    else await saveOutputNextToFileWithToast(file, target.output)
  }
}

/**
 * The menu of several selected child rows (Ctrl/Shift-click on outputs and reports of one file):
 * Save next to file (desktop) and Delete, which asks first and leaves out the rows this user may
 * not delete. One-row actions (Open, Regenerate, Import results) stay on the single-row menus.
 */
export function ChildSelectionMenu({ file, targets, position, onClose }: ChildSelectionMenuProps) {
  const [confirming, setConfirming] = useState(false)
  const userId = usePDMStore((s) => s.user?.id)
  const isAdmin = usePDMStore((s) => s.getEffectiveRole() === 'admin')
  const canEdit = usePDMStore((s) => s.getEffectiveRole() === 'admin' || s.hasPermission('module:explorer', 'edit'))
  const deletable = targets.filter((target) => mayDelete(target, userId, isAdmin, canEdit))
  const canSaveNext = hasDesktop() && file.diffStatus !== 'moved_away'

  const stop = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  return createPortal(
    <div onClick={(e) => e.stopPropagation()} onContextMenu={stop}>
      {!confirming && (
        <>
          <div className="fixed inset-0 z-50" onClick={onClose} onContextMenu={onClose} />
          <div className="context-menu z-[60]" role="menu" style={{ left: position.x, top: position.y }}>
            {canSaveNext && (
              <div
                className="context-menu-item"
                role="menuitem"
                onClick={() => {
                  onClose()
                  void saveAllNextToFile(file, targets)
                }}
              >
                <FolderDown size={14} />
                {t('source.outputs.multiSaveNext', { count: targets.length })}
              </div>
            )}
            {deletable.length > 0 && (
              <>
                {canSaveNext && <div className="context-menu-separator" />}
                <div className="context-menu-item danger" role="menuitem" onClick={() => setConfirming(true)}>
                  <Trash2 size={14} />
                  {t('source.outputs.multiDelete', { count: deletable.length })}
                </div>
              </>
            )}
          </div>
        </>
      )}
      <ConfirmDialog
        open={confirming}
        onClose={onClose}
        title={t('source.outputs.multiDeleteTitle', { count: deletable.length })}
        message={[
          t('source.outputs.multiDeleteMessage', { count: deletable.length, name: file.name }),
          deletable.length < targets.length
            ? t('source.outputs.multiDeleteSkipped', { count: targets.length - deletable.length })
            : null,
        ]
          .filter(Boolean)
          .join(' ')}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        variant="danger"
        onConfirm={() => {
          onClose()
          void deleteAll(file, deletable)
        }}
      />
    </div>,
    document.body,
  )
}
