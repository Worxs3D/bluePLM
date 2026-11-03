import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, Copy, Download, ExternalLink, FolderDown, RefreshCw, Trash2 } from 'lucide-react'

import { t } from '@/lib/i18n'
import { hasDesktop } from '@/lib/platform'
import { usePDMStore, type LocalFile } from '@/stores/pdmStore'
import type { VersionOutput } from '@/types/versionOutputs'

import {
  copyOutputName,
  openOutput,
  readAutoOutput,
  regenerateOutput,
  saveOutputCopyWithToast,
  setAutoOutputWithToast,
  saveOutputNextToFileWithToast,
} from './outputCommands'
import { outputMenuItems } from './outputRowModel'

export interface OutputMenuProps {
  file: LocalFile
  output: VersionOutput
  position: { x: number; y: number }
  /** A job for this output is queued or running. */
  busy: boolean
  /** The output is of an older version than the file's latest. */
  stale: boolean
  /** The output is of a released version (schema 509): no Regenerate, no Delete. */
  released?: boolean
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
 * (desktop), Copy file name, Regenerate for the latest version (desktop, explorer edit; only when
 * the output is out of date), Delete (administrators, or the user who generated it), and
 * "Regenerate at check-in" for the kind (explorer edit; on unless the file turned it off). An
 * export of a released version is frozen: it has no Regenerate and no Delete.
 */
export function OutputMenu({ file, output, position, busy, stale, released = false, onClose, onDelete }: OutputMenuProps) {
  const getEffectiveRole = usePDMStore((s) => s.getEffectiveRole)
  const hasPermission = usePDMStore((s) => s.hasPermission)
  const userId = usePDMStore((s) => s.user?.id)
  const items = outputMenuItems({
    desktop: hasDesktop(),
    isAdmin: getEffectiveRole() === 'admin',
    canGenerate: getEffectiveRole() === 'admin' || hasPermission('module:explorer', 'edit'),
    stale,
    hasLocalFolder: file.diffStatus !== 'moved_away',
    busy,
    isGeneratorWithEdit:
      !!userId && output.generatedBy === userId && hasPermission('module:explorer', 'edit'),
    released,
  })
  const canEdit = getEffectiveRole() === 'admin' || hasPermission('module:explorer', 'edit')
  const fileId = file.pdmData?.id ?? null
  // null: not read yet or not available (the toggle is left out).
  const [autoOn, setAutoOn] = useState<boolean | null>(null)
  useEffect(() => {
    if (!canEdit || !fileId) return
    let alive = true
    void readAutoOutput(fileId, output.kind).then((on) => {
      if (alive) setAutoOn(on)
    })
    return () => {
      alive = false
    }
  }, [canEdit, fileId, output.kind])
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
              label={t('source.outputs.regenerateLatest', { version: file.pdmData?.version ?? '' })}
              onClick={() => run(() => regenerateOutput(file, output))}
            />
          </>
        )}
        {autoOn !== null && (
          <>
            <div className="context-menu-separator" />
            <Item
              icon={autoOn ? <Check size={14} /> : <span className="inline-block w-3.5" />}
              label={t('source.outputs.autoRegenerate')}
              onClick={() => run(() => void setAutoOutputWithToast(file, output.kind, !autoOn))}
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
