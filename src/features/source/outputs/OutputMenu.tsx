import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Copy, Download, ExternalLink, FolderDown, RefreshCw, Trash2 } from 'lucide-react'

import { t } from '@/lib/i18n'
import { hasDesktop } from '@/lib/platform'
import { usePDMStore, type LocalFile } from '@/stores/pdmStore'
import type { VersionOutput } from '@/types/versionOutputs'

import {
  copyOutputName,
  openOutput,
  regenerateOutput,
  saveOutputCopyWithToast,
  saveOutputNextToFileWithToast,
} from './outputCommands'
import { outputMenuItems } from './outputRowModel'

export interface OutputMenuProps {
  file: LocalFile
  output: VersionOutput
  position: { x: number; y: number }
  /** A job for this output is queued or running. */
  busy: boolean
  onClose: () => void
  /** Ask to delete the output (the row confirms). */
  onDelete: () => void
}

function Item({
  icon,
  label,
  onClick,
  danger = false,
}: {
  icon: ReactNode
  label: string
  onClick: () => void
  danger?: boolean
}) {
  return (
    <div
      className={`context-menu-item${danger ? ' danger' : ''}`}
      role="menuitem"
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
    >
      {icon}
      {label}
    </div>
  )
}

/**
 * The menu of one version output in the file list: Open, Save copy..., Save next to file
 * (desktop), Copy file name, Regenerate (administrators, desktop; it replaces the recorded one),
 * Delete (administrators, or the user who generated it).
 */
export function OutputMenu({ file, output, position, busy, onClose, onDelete }: OutputMenuProps) {
  const getEffectiveRole = usePDMStore((s) => s.getEffectiveRole)
  const hasPermission = usePDMStore((s) => s.hasPermission)
  const userId = usePDMStore((s) => s.user?.id)
  const items = outputMenuItems({
    desktop: hasDesktop(),
    isAdmin: getEffectiveRole() === 'admin',
    hasLocalFolder: file.diffStatus !== 'moved_away',
    busy,
    isGeneratorWithEdit:
      !!userId && output.generatedBy === userId && hasPermission('module:explorer', 'edit'),
  })
  // The queue regenerates the saved configuration only.
  const canRegenerate = items.regenerate && output.configuration === null

  const run = (fn: () => void) => {
    onClose()
    fn()
  }

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-50"
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onClose()
        }}
      />
      <div
        className="context-menu z-[60]"
        role="menu"
        style={{ left: position.x, top: position.y }}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
        }}
      >
        {items.open && (
          <Item
            icon={<ExternalLink size={14} />}
            label={t('source.outputs.open')}
            onClick={() => run(() => void openOutput(file, output))}
          />
        )}
        <div className="context-menu-separator" />
        {items.saveCopy && (
          <Item
            icon={<Download size={14} />}
            label={t('source.outputs.saveCopy')}
            onClick={() => run(() => void saveOutputCopyWithToast(file, output))}
          />
        )}
        {items.saveNextToFile && (
          <Item
            icon={<FolderDown size={14} />}
            label={t('source.outputs.saveNext')}
            onClick={() => run(() => void saveOutputNextToFileWithToast(file, output))}
          />
        )}
        {items.copyName && (
          <Item
            icon={<Copy size={14} />}
            label={t('source.outputs.copyName')}
            onClick={() => run(() => void copyOutputName(file, output))}
          />
        )}
        {canRegenerate && (
          <>
            <div className="context-menu-separator" />
            <Item
              icon={<RefreshCw size={14} />}
              label={t('source.outputs.regenerate')}
              onClick={() => run(() => regenerateOutput(file, output))}
            />
          </>
        )}
        {items.delete && (
          <>
            <div className="context-menu-separator" />
            <Item icon={<Trash2 size={14} />} label={t('common.delete')} onClick={() => run(onDelete)} danger />
          </>
        )}
      </div>
    </>,
    document.body,
  )
}
