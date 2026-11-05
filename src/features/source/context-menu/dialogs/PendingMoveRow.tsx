// src/features/source/context-menu/dialogs/PendingMoveRow.tsx
import { AlertTriangle, Cloud, HardDrive, Loader2, Lock } from 'lucide-react'

import { t } from '@/lib/i18n'
import { formatDateTime } from '@/lib/utils/date'
import type { FileMoveRecord } from '@/lib/supabase'

import {
  splitPathDifference,
  type MovedPair,
  type RowDirectionStatus,
} from './resolveMovedFiles.utils'

export type ResolveDirection = 'reconcile' | 'adopt'

interface PendingMoveRowProps {
  pair: MovedPair
  checked: boolean
  onToggle: (fileId: string) => void
  /** What `reconcile-moved-paths` (keep the disk path) would do with this row. */
  reconcileStatus: RowDirectionStatus
  /** What `adopt-server-paths` (put it back) would do with this row. */
  adoptStatus: RowDirectionStatus
  /** The adopt card's "also rename files checked out by others" toggle. */
  forceAdopt: boolean
  /** The vault's last recorded move of this file; `undefined` while it is being read. */
  lastMove: FileMoveRecord | null | undefined
  /** A user id (or, failing that, an email) to a display name. */
  nameOf: (userId: string | null, email?: string | null) => string
  currentUserId: string | null
  running: ResolveDirection | null
  disabled: boolean
  onRun: (direction: ResolveDirection, fileId: string) => void
}

/**
 * One pending move: both full paths (shared folders dimmed, the part that differs in full), what
 * the vault and the disk know about it, and a button per direction that resolves this file only.
 * A button is enabled only when that direction's own preflight says this row is ready, so it can
 * never offer something the command would refuse.
 */
export function PendingMoveRow({
  pair,
  checked,
  onToggle,
  reconcileStatus,
  adoptStatus,
  forceAdopt,
  lastMove,
  nameOf,
  currentUserId,
  running,
  disabled,
  onRun,
}: PendingMoveRowProps) {
  const { prefix, serverMiddle, localMiddle, suffix } = splitPathDifference(
    pair.serverPath,
    pair.localPath,
  )

  const canReconcile = reconcileStatus.kind === 'ready'
  const canAdopt = adoptStatus.kind === 'ready' || (adoptStatus.kind === 'held' && forceAdopt)

  const notes: string[] = []
  if (reconcileStatus.kind === 'unverified' || adoptStatus.kind === 'unverified') {
    notes.push(t('resolveMoves.rowUnverified'))
  }
  if (reconcileStatus.kind === 'conflict') notes.push(t('resolveMoves.rowConflictVault'))
  if (adoptStatus.kind === 'conflict') notes.push(t('resolveMoves.rowConflictDisk'))
  if (reconcileStatus.kind === 'held') {
    notes.push(
      t('resolveMoves.rowHeldVault', {
        name: reconcileStatus.holderName ?? t('resolveMoves.unknownHolder'),
      }),
    )
  }

  const facts: string[] = []
  if (pair.version !== null) facts.push(t('resolveMoves.versionLabel', { version: pair.version }))
  if (lastMove) {
    facts.push(
      t('resolveMoves.vaultMovedBy', {
        name: nameOf(lastMove.userId, lastMove.userEmail),
        date: formatDateTime(lastMove.movedAt),
      }),
    )
  } else if (lastMove === null && pair.vaultCreatedAt) {
    facts.push(t('resolveMoves.vaultNeverMoved', { date: formatDateTime(pair.vaultCreatedAt) }))
  }
  if (pair.vaultUpdatedAt) {
    facts.push(
      pair.vaultUpdatedBy
        ? t('resolveMoves.lastChangedBy', {
            name: nameOf(pair.vaultUpdatedBy),
            date: formatDateTime(pair.vaultUpdatedAt),
          })
        : t('resolveMoves.lastChanged', { date: formatDateTime(pair.vaultUpdatedAt) }),
    )
  }
  if (pair.localModifiedAt) {
    facts.push(t('resolveMoves.diskModified', { date: formatDateTime(pair.localModifiedAt) }))
  }

  const holderLabel = pair.checkedOutBy
    ? pair.checkedOutBy === currentUserId
      ? t('resolveMoves.checkedOutByYou')
      : t('resolveMoves.checkedOutBy', {
          name: pair.checkedOutByName ?? nameOf(pair.checkedOutBy),
        })
    : null

  return (
    <div className="flex gap-3 px-3 py-2.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={() => onToggle(pair.fileId)}
        disabled={disabled}
        className="mt-1 shrink-0 self-start accent-plm-accent"
        aria-label={pair.name}
      />

      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-sm font-medium text-plm-fg break-all">{pair.name}</span>
          {holderLabel && (
            <span className="inline-flex items-center gap-1 rounded bg-plm-warning/15 px-1.5 py-0.5 text-[11px] text-plm-warning">
              <Lock size={10} />
              {holderLabel}
            </span>
          )}
        </div>

        <PathLine
          icon={<Cloud size={12} />}
          label={t('resolveMoves.vaultLabel')}
          prefix={prefix}
          middle={serverMiddle}
          suffix={suffix}
        />
        <PathLine
          icon={<HardDrive size={12} />}
          label={t('resolveMoves.diskLabel')}
          prefix={prefix}
          middle={localMiddle}
          suffix={suffix}
        />

        {facts.length > 0 && (
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-plm-fg-muted">
            {facts.map((fact) => (
              <span key={fact}>{fact}</span>
            ))}
          </div>
        )}

        {notes.map((note) => (
          <div key={note} className="flex items-start gap-1.5 text-[11px] text-plm-warning">
            <AlertTriangle size={11} className="mt-0.5 shrink-0" />
            <span>{note}</span>
          </div>
        ))}
      </div>

      <div className="flex shrink-0 flex-col gap-1.5">
        <RowButton
          label={t('resolveMoves.rowUpdateVault')}
          hint={t('resolveMoves.rowUpdateVaultHint')}
          enabled={canReconcile && !disabled}
          running={running === 'reconcile'}
          onClick={() => onRun('reconcile', pair.fileId)}
        />
        <RowButton
          label={t('resolveMoves.rowRestore')}
          hint={t('resolveMoves.rowRestoreHint')}
          enabled={canAdopt && !disabled}
          running={running === 'adopt'}
          onClick={() => onRun('adopt', pair.fileId)}
        />
      </div>
    </div>
  )
}

/** One full path: the parts both paths share in the normal colour, the part that differs marked. */
function PathLine({
  icon,
  label,
  prefix,
  middle,
  suffix,
}: {
  icon: React.ReactNode
  label: string
  prefix: string
  middle: string
  suffix: string
}) {
  return (
    <div className="flex items-start gap-2 text-xs">
      <span className="flex w-28 shrink-0 items-center gap-1 text-plm-fg-muted">
        {icon}
        {label}
      </span>
      <span className="min-w-0 break-all font-mono select-text text-plm-fg-dim" title={prefix + middle + suffix}>
        {prefix}
        {middle && (
          <span className="rounded-sm bg-plm-accent/20 px-0.5 text-plm-fg">{middle}</span>
        )}
        {suffix}
      </span>
    </div>
  )
}

function RowButton({
  label,
  hint,
  enabled,
  running,
  onClick,
}: {
  label: string
  hint: string
  enabled: boolean
  running: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      disabled={!enabled}
      title={hint}
      className="btn btn-secondary btn-sm justify-center whitespace-nowrap disabled:opacity-40"
    >
      {running ? <Loader2 size={12} className="animate-spin" /> : null}
      {label}
    </button>
  )
}
