// src/features/source/context-menu/dialogs/ResolveMovedFilesDialog.tsx
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, Cloud, HardDrive, Loader2, Move, X } from 'lucide-react'

import { t } from '@/lib/i18n'
import { executeCommand, type CommandResult } from '@/lib/commands'
import { classifyMovedFiles } from '@/lib/commands/handlers/reconcileMovedPathsPreflight'
import { classifyAdoptTargets } from '@/lib/commands/handlers/adoptServerPathsPreflight'
import { getLatestFileMoves, type FileMoveRecord } from '@/lib/supabase'
import { usePDMStore } from '@/stores/pdmStore'
import type { LocalFile } from '@/stores/pdmStore'

import { PendingMoveRow, type ResolveDirection } from './PendingMoveRow'
import {
  buildMovedPairs,
  buildScope,
  countSelected,
  filterByScope,
  inferDefaultScopeType,
  statusByFileId,
  type ResolveScopeType,
  type SelectionCounts,
} from './resolveMovedFiles.utils'

/** Rows rendered before the list collapses to "…and N more" (those stay selected and in counts). */
const ROW_LIMIT = 300

interface ResolveMovedFilesDialogProps {
  isOpen: boolean
  onClose: () => void
  /**
   * The file or folder the dialog was opened from. A directory (the folder-tree badge) defaults
   * the scope to that folder; a file (the context-menu item) defaults it to that file. `null`
   * defaults to the whole vault.
   */
  contextFile: LocalFile | null
  onRefresh?: (silent?: boolean) => void
}

function pluralSuffix(count: number): '_one' | '_other' {
  return count === 1 ? '_one' : '_other'
}

function formatHolders(holders: SelectionCounts['holders']): string {
  return holders
    .map((holder) => `${holder.holderName ?? t('resolveMoves.unknownHolder')} (${holder.count})`)
    .join(', ')
}

/**
 * Resolve Pending Moves. The scope (file, folder, vault) and the ticked rows are what a run
 * touches: every command call passes their ids as `fileIds`, and the preflights shown here run
 * with the same ids, so the counts, the row statuses and the write all agree. Each row also has
 * its own Update vault / Restore buttons for that file alone.
 */
export function ResolveMovedFilesDialog({
  isOpen,
  onClose,
  contextFile,
  onRefresh,
}: ResolveMovedFilesDialogProps) {
  const files = usePDMStore((state) => state.files)
  const serverFiles = usePDMStore((state) => state.serverFiles)
  const userId = usePDMStore((state) => state.user?.id ?? null)
  const members = usePDMStore((state) => state.members)

  const [scopeType, setScopeType] = useState<ResolveScopeType>(() =>
    inferDefaultScopeType(contextFile),
  )
  /** Rows the user unticked. Tracked as exclusions so rows default to ticked. */
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(() => new Set())
  const [skipCheckedOut, setSkipCheckedOut] = useState(false)
  const [force, setForce] = useState(false)
  const [running, setRunning] = useState<{ direction: ResolveDirection; fileId: string | null } | null>(
    null,
  )
  const [result, setResult] = useState<CommandResult | null>(null)
  const [moves, setMoves] = useState<ReadonlyMap<string, FileMoveRecord>>(() => new Map())
  const [movesRead, setMovesRead] = useState<ReadonlySet<string>>(() => new Set())
  const [historyError, setHistoryError] = useState(false)

  // Every open is a fresh review: re-derive the default scope from whatever the dialog was
  // opened against this time, and drop any result/toggle/selection state from the last run.
  useEffect(() => {
    if (!isOpen) return
    setScopeType(inferDefaultScopeType(contextFile))
    setExcluded(new Set())
    setSkipCheckedOut(false)
    setForce(false)
    setResult(null)
    setMoves(new Map())
    setMovesRead(new Set())
    setHistoryError(false)
  }, [isOpen, contextFile])

  const scope = useMemo(() => buildScope(scopeType, contextFile), [scopeType, contextFile])
  const allPairs = useMemo(() => buildMovedPairs(files), [files])
  const scopedPairs = useMemo(() => filterByScope(allPairs, scope), [allPairs, scope])
  const scopedIds = useMemo(() => scopedPairs.map((pair) => pair.fileId), [scopedPairs])
  const selected = useMemo(
    () => new Set(scopedIds.filter((id) => !excluded.has(id))),
    [scopedIds, excluded],
  )

  const reconcilePreflight = useMemo(
    () => classifyMovedFiles({ files, serverFiles, userId: userId ?? '', fileIds: scopedIds }),
    [files, serverFiles, userId, scopedIds],
  )
  const adoptPreflight = useMemo(
    () => classifyAdoptTargets({ files, userId: userId ?? '', fileIds: scopedIds }),
    [files, userId, scopedIds],
  )
  const reconcileByRow = useMemo(() => statusByFileId(reconcilePreflight), [reconcilePreflight])
  const adoptByRow = useMemo(() => statusByFileId(adoptPreflight), [adoptPreflight])
  const reconcileCounts = useMemo(
    () => countSelected(reconcilePreflight, selected),
    [reconcilePreflight, selected],
  )
  const adoptCounts = useMemo(() => countSelected(adoptPreflight, selected), [adoptPreflight, selected])

  // Who last moved each listed file in the vault, read once per id while the dialog is open.
  const unreadKey = useMemo(
    () => scopedIds.filter((id) => !movesRead.has(id)).slice(0, 500).join(','),
    [scopedIds, movesRead],
  )
  useEffect(() => {
    if (!isOpen || !unreadKey) return
    let cancelled = false
    const ids = unreadKey.split(',')
    void getLatestFileMoves(ids).then(({ moves: found, error }) => {
      if (cancelled) return
      if (error) setHistoryError(true)
      setMoves((previous) => new Map([...previous, ...found]))
      setMovesRead((previous) => new Set([...previous, ...ids]))
    })
    return () => {
      cancelled = true
    }
  }, [isOpen, unreadKey])

  const nameOf = useCallback(
    (id: string | null, email?: string | null): string => {
      if (id && id === userId) return t('resolveMoves.you')
      const member =
        (id ? members.find((m) => m.id === id) : undefined) ??
        (email ? members.find((m) => m.email.toLowerCase() === email.toLowerCase()) : undefined)
      return member?.full_name?.trim() || member?.email || email || t('resolveMoves.unknownHolder')
    },
    [members, userId],
  )

  if (!isOpen) return null

  const isRunning = running !== null
  const hasAnyPendingMoves = allPairs.length > 0
  const allTicked = scopedIds.length > 0 && selected.size === scopedIds.length

  const handleClose = () => {
    if (isRunning) return
    onClose()
  }

  const toggleRow = (fileId: string) => {
    setExcluded((previous) => {
      const next = new Set(previous)
      if (next.has(fileId)) next.delete(fileId)
      else next.add(fileId)
      return next
    })
  }

  const toggleAll = () => {
    setExcluded(allTicked ? new Set(scopedIds) : new Set())
  }

  const run = async (direction: ResolveDirection, fileIds: string[], rowId: string | null) => {
    if (fileIds.length === 0) return
    setRunning({ direction, fileId: rowId })
    setResult(null)
    try {
      const value =
        direction === 'reconcile'
          ? await executeCommand(
              'reconcile-moved-paths',
              { apply: true, skipCheckedOut, fileIds },
              { onRefresh },
            )
          : await executeCommand('adopt-server-paths', { apply: true, force, fileIds }, { onRefresh })
      setResult(value)
    } finally {
      setRunning(null)
    }
  }

  const selectedIds = Array.from(selected)

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-center justify-center"
      onClick={handleClose}
    >
      <div
        className="bg-plm-bg-light border border-plm-border rounded-lg shadow-2xl w-[min(1100px,94vw)] max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-plm-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-plm-info/20 flex items-center justify-center">
              <Move size={20} className="text-plm-info" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-plm-fg">{t('resolveMoves.title')}</h3>
              <p className="text-sm text-plm-fg-muted">{t('resolveMoves.subtitle')}</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            disabled={isRunning}
            className="text-plm-fg-muted hover:text-plm-fg disabled:opacity-50"
            aria-label={t('common.close')}
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto min-h-0 flex-1">
          {!hasAnyPendingMoves ? (
            <p className="text-sm text-plm-fg-muted">{t('resolveMoves.noPendingMoves')}</p>
          ) : (
            <>
              {/* Scope selector */}
              <div className="flex flex-wrap items-center gap-3">
                <div className="text-xs text-plm-fg-muted uppercase tracking-wide">
                  {t('resolveMoves.scopeLabel')}
                </div>
                <div className="flex gap-2">
                  {(
                    [
                      ['file', t('resolveMoves.scopeFile')],
                      ['folder', t('resolveMoves.scopeFolder')],
                      ['vault', t('resolveMoves.scopeVault')],
                    ] as Array<[ResolveScopeType, string]>
                  ).map(([type, label]) => {
                    const disabled = isRunning || (type === 'file' && !contextFile?.pdmData?.id)
                    return (
                      <button
                        key={type}
                        onClick={() => setScopeType(type)}
                        disabled={disabled}
                        className={`px-3 py-1.5 text-sm rounded border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                          scopeType === type
                            ? 'bg-plm-accent/20 border-plm-accent text-plm-accent'
                            : 'border-plm-border text-plm-fg-muted hover:text-plm-fg'
                        }`}
                      >
                        {label}
                      </button>
                    )
                  })}
                </div>
                {scope.type === 'folder' && scope.folderPath && (
                  <span className="font-mono text-xs text-plm-fg-muted break-all">
                    {scope.folderPath}
                  </span>
                )}
              </div>

              {/* The pending moves, one row each */}
              <div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-2">
                  <label className="flex items-center gap-2 text-xs text-plm-fg-muted cursor-pointer">
                    <input
                      type="checkbox"
                      checked={allTicked}
                      onChange={toggleAll}
                      disabled={isRunning || scopedIds.length === 0}
                      className="accent-plm-accent"
                    />
                    {t('resolveMoves.selectAll')}
                  </label>
                  <span className="text-xs text-plm-fg-muted uppercase tracking-wide">
                    {t(`resolveMoves.listHeading${pluralSuffix(scopedPairs.length)}`, {
                      count: scopedPairs.length,
                    })}
                    {' · '}
                    {t(`resolveMoves.selectedCount${pluralSuffix(selected.size)}`, {
                      count: selected.size,
                    })}
                  </span>
                  <span className="text-xs text-plm-fg-muted">{t('resolveMoves.selectionNote')}</span>
                </div>
                <div className="bg-plm-bg rounded border border-plm-border max-h-[46vh] overflow-y-auto divide-y divide-plm-border">
                  {scopedPairs.length === 0 ? (
                    <div className="text-sm text-plm-fg-muted p-3">
                      {t('resolveMoves.noMovesInScope')}
                    </div>
                  ) : (
                    <>
                      {scopedPairs.slice(0, ROW_LIMIT).map((pair) => (
                        <PendingMoveRow
                          key={pair.fileId}
                          pair={pair}
                          checked={selected.has(pair.fileId)}
                          onToggle={toggleRow}
                          reconcileStatus={reconcileByRow.get(pair.fileId) ?? { kind: 'none' }}
                          adoptStatus={adoptByRow.get(pair.fileId) ?? { kind: 'none' }}
                          forceAdopt={force}
                          lastMove={
                            movesRead.has(pair.fileId) ? (moves.get(pair.fileId) ?? null) : undefined
                          }
                          nameOf={nameOf}
                          currentUserId={userId}
                          running={running?.fileId === pair.fileId ? running.direction : null}
                          disabled={isRunning}
                          onRun={(direction, fileId) => void run(direction, [fileId], fileId)}
                        />
                      ))}
                      {scopedPairs.length > ROW_LIMIT && (
                        <div className="text-xs text-plm-fg-muted p-3">
                          {t('resolveMoves.moreFiles', { count: scopedPairs.length - ROW_LIMIT })}
                        </div>
                      )}
                    </>
                  )}
                </div>
                {historyError && (
                  <p className="text-xs text-plm-fg-muted mt-1">
                    {t('resolveMoves.historyUnavailable')}
                  </p>
                )}
              </div>

              {/* The two directions, over the ticked rows */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <DirectionCard
                  icon={<Cloud size={16} />}
                  title={t('resolveMoves.reconcileOptionTitle')}
                  description={t('resolveMoves.reconcileOptionDescription')}
                  counts={reconcileCounts}
                  toggle={
                    reconcileCounts.blocked > 0 ? (
                      <ToggleLine
                        checked={skipCheckedOut}
                        onChange={setSkipCheckedOut}
                        disabled={isRunning}
                        label={t(
                          `resolveMoves.skipCheckedOutLabel${pluralSuffix(reconcileCounts.blocked)}`,
                          { count: reconcileCounts.blocked },
                        )}
                      />
                    ) : null
                  }
                  runLabel={t('resolveMoves.runReconcile')}
                  onRun={() => void run('reconcile', selectedIds, null)}
                  isRunning={running?.direction === 'reconcile' && running.fileId === null}
                  disabled={isRunning || selected.size === 0}
                />

                <DirectionCard
                  icon={<HardDrive size={16} />}
                  title={t('resolveMoves.adoptOptionTitle')}
                  description={t('resolveMoves.adoptOptionDescription')}
                  counts={adoptCounts}
                  toggle={
                    adoptCounts.blocked > 0 ? (
                      <ToggleLine
                        checked={force}
                        onChange={setForce}
                        disabled={isRunning}
                        label={t(`resolveMoves.forceLabel${pluralSuffix(adoptCounts.blocked)}`, {
                          count: adoptCounts.blocked,
                        })}
                      />
                    ) : null
                  }
                  runLabel={t('resolveMoves.runAdopt')}
                  onRun={() => void run('adopt', selectedIds, null)}
                  isRunning={running?.direction === 'adopt' && running.fileId === null}
                  disabled={isRunning || selected.size === 0}
                />
              </div>
              {selected.size === 0 && scopedPairs.length > 0 && (
                <p className="text-xs text-plm-fg-muted">{t('resolveMoves.noneSelected')}</p>
              )}

              {/* Result summary */}
              {result && (
                <div
                  className={`rounded border p-3 text-sm flex items-start gap-2 ${
                    result.success
                      ? 'border-plm-success/40 bg-plm-success/10 text-plm-success'
                      : 'border-plm-warning/40 bg-plm-warning/10 text-plm-warning'
                  }`}
                >
                  {result.success ? (
                    <Check size={16} className="shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                  )}
                  <span className="text-plm-fg">{result.message}</span>
                </div>
              )}
            </>
          )}
        </div>

        <div className="p-4 border-t border-plm-border flex justify-end shrink-0">
          <button onClick={handleClose} disabled={isRunning} className="btn btn-ghost">
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  )
}

function ToggleLine({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  disabled: boolean
  label: string
}) {
  return (
    <label className="flex items-start gap-2 text-xs text-plm-fg-muted cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="mt-0.5 accent-plm-accent"
      />
      <span>{label}</span>
    </label>
  )
}

interface DirectionCardProps {
  icon: React.ReactNode
  title: string
  description: string
  counts: SelectionCounts
  toggle: React.ReactNode
  runLabel: string
  onRun: () => void
  isRunning: boolean
  disabled: boolean
}

/**
 * One resolution option over the ticked rows, in plain language rather than a command name. Both
 * directions render through this so their counts and hazards read the same way — neither ever
 * looks safer than its own preflight says it is.
 */
function DirectionCard({
  icon,
  title,
  description,
  counts,
  toggle,
  runLabel,
  onRun,
  isRunning,
  disabled,
}: DirectionCardProps) {
  const { eligible, blocked, holders, conflicts, unverified } = counts
  return (
    <div className="border border-plm-border rounded-lg p-3 flex flex-col gap-2 bg-plm-bg">
      <div className="flex items-center gap-2 text-plm-fg font-medium">
        <span className="text-plm-accent">{icon}</span>
        <span>{title}</span>
      </div>
      <p className="text-xs text-plm-fg-muted">{description}</p>

      <div className="text-xs space-y-1 mt-1">
        {eligible > 0 && (
          <div className="text-plm-success">
            {t(`resolveMoves.eligibleCount${pluralSuffix(eligible)}`, { count: eligible })}
          </div>
        )}
        {blocked > 0 && (
          <div className="text-plm-warning">
            {t(`resolveMoves.blockedCount${pluralSuffix(blocked)}`, { count: blocked })}
            {holders.length > 0 && (
              <span className="text-plm-fg-muted"> — {formatHolders(holders)}</span>
            )}
          </div>
        )}
        {conflicts > 0 && (
          <div className="text-plm-fg-muted">
            {t(`resolveMoves.conflictCount${pluralSuffix(conflicts)}`, { count: conflicts })}
          </div>
        )}
        {unverified > 0 && (
          <div className="text-plm-fg-muted">
            {t(`resolveMoves.unverifiedCount${pluralSuffix(unverified)}`, { count: unverified })}
          </div>
        )}
        {eligible === 0 && blocked === 0 && conflicts === 0 && unverified === 0 && (
          <div className="text-plm-fg-muted">{t('resolveMoves.noEligible')}</div>
        )}
      </div>

      {toggle && <div className="mt-1">{toggle}</div>}

      <button
        onClick={onRun}
        disabled={disabled}
        className="btn btn-primary w-full justify-center mt-auto disabled:opacity-50"
      >
        {isRunning ? <Loader2 size={14} className="animate-spin" /> : null}
        {runLabel}
      </button>
    </div>
  )
}
