/**
 * Review and confirm a Copy to Vault / Move to Vault.
 *
 * The context menu only picks a mode, a destination vault and whether to keep the folder path;
 * everything that can go wrong is shown here, before anything is written: what will be carried,
 * what will be left out and why, and what a transfer does not bring along.
 */

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowRightLeft, Copy, Info, Loader2, X } from 'lucide-react'

import { t } from '@/lib/i18n'
import { executeCommand } from '@/lib/commands'
import { normalizeDestFolder, vaultFoldersOverlap } from '@/lib/vaultTransfer'
import {
  formatBytes,
  fileCountLabel,
  itemCountLabel,
  skipReasonLabel,
  SKIP_REASONS,
  vaultTransferKey,
} from '@/lib/vaultTransfer/labels'
import type { VaultTransferPlan } from '@/lib/vaultTransfer'
import { usePDMStore } from '@/stores/pdmStore'
import type { UISlice } from '@/stores/types'

import { useVaultTransferPreview, type ReferenceGapsState } from './useVaultTransferPreview'

/** Skipped paths named under each reason before the rest are counted. */
const SKIPPED_EXAMPLES_PER_REASON = 3

const FOLDER_LIST_ID = 'vault-transfer-folders'

type PendingTransfer = NonNullable<UISlice['pendingVaultTransfer']>

interface VaultTransferDialogProps {
  pending: PendingTransfer
  onClose: () => void
  onRefresh?: (silent?: boolean) => void
}

function label(name: string, params?: Record<string, string | number>): string {
  return t(vaultTransferKey(name), params)
}

/** The selection as the store holds it now, so a file that changed since the menu opened is not planned from a stale copy. */
function currentSelection(pending: PendingTransfer) {
  const wanted = new Set(pending.files.map((file) => file.relativePath))
  return usePDMStore.getState().files.filter((file) => wanted.has(file.relativePath))
}

export function VaultTransferDialog({ pending, onClose, onRefresh }: VaultTransferDialogProps) {
  const connectedVaults = usePDMStore((state) => state.connectedVaults)
  const activeVaultId = usePDMStore((state) => state.activeVaultId)
  const vaultPath = usePDMStore((state) => state.vaultPath)

  const isMove = pending.mode === 'move'

  const candidates = useMemo(
    () =>
      connectedVaults.filter(
        (vault) =>
          vault.id !== activeVaultId &&
          !(vaultPath && vaultFoldersOverlap(vaultPath, vault.localPath)),
      ),
    [connectedVaults, activeVaultId, vaultPath],
  )

  const [destVaultId, setDestVaultId] = useState(
    candidates.some((vault) => vault.id === pending.destVaultId)
      ? pending.destVaultId
      : (candidates[0]?.id ?? ''),
  )
  const [destFolder, setDestFolder] = useState('')
  const [keepPath, setKeepPath] = useState(pending.keepPath)

  const selection = useMemo(() => currentSelection(pending), [pending])
  const destVault = candidates.find((vault) => vault.id === destVaultId) ?? null

  const { preview, destinationFolders, gaps } = useVaultTransferPreview({
    mode: pending.mode,
    selection,
    destVault,
    destFolder,
    keepPath,
  })

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const folderInvalid = normalizeDestFolder(destFolder) === null
  const plan = preview.status === 'ready' ? preview.plan : null
  const hasWork = plan !== null && (plan.files.length > 0 || plan.folders.length > 0)
  const canConfirm = destVault !== null && !folderInvalid && hasWork

  const handleConfirm = () => {
    if (!destVault || !canConfirm) return
    const files = currentSelection(pending)
    onClose()
    void executeCommand(
      isMove ? 'move-to-vault' : 'copy-to-vault',
      { files, destVaultId: destVault.id, destFolder, keepPath },
      { onRefresh },
    )
  }

  const Icon = isMove ? ArrowRightLeft : Copy
  const transferLabel = plan
    ? plan.files.length > 0
      ? fileCountLabel(plan.files.length)
      : itemCountLabel(plan.folders.length)
    : ''

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-plm-bg-light border border-plm-border rounded-lg shadow-2xl w-[560px] max-h-[85vh] overflow-auto"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="p-4 border-b border-plm-border flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-plm-info/20 flex items-center justify-center">
              <Icon size={20} className="text-plm-info" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-plm-fg">
                {label(isMove ? 'dialogTitleMove' : 'dialogTitleCopy', {
                  vault: destVault?.name ?? '',
                })}
              </h3>
              <p className="text-sm text-plm-fg-muted">
                {label('dialogSelected', { items: itemCountLabel(selection.length) })}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="btn btn-ghost p-1" aria-label={label('dialogCancel')}>
            <X size={18} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <label className="block text-sm text-plm-fg-dim mb-1" htmlFor="vault-transfer-vault">
              {label('dialogDestinationVault')}
            </label>
            <select
              id="vault-transfer-vault"
              value={destVaultId}
              onChange={(event) => setDestVaultId(event.target.value)}
              className="w-full px-3 py-2 text-sm bg-plm-bg border border-plm-border rounded focus:outline-none focus:border-plm-accent"
            >
              {candidates.map((vault) => (
                <option key={vault.id} value={vault.id}>
                  {vault.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm text-plm-fg-dim mb-1" htmlFor="vault-transfer-folder">
              {label('dialogDestinationFolder')}
            </label>
            <div className="flex gap-2">
              <input
                id="vault-transfer-folder"
                type="text"
                list={FOLDER_LIST_ID}
                value={destFolder}
                onChange={(event) => setDestFolder(event.target.value)}
                placeholder={label('dialogFolderPlaceholder')}
                spellCheck={false}
                className="flex-1 px-3 py-2 text-sm bg-plm-bg border border-plm-border rounded focus:outline-none focus:border-plm-accent"
              />
              <button
                type="button"
                onClick={() => setDestFolder('')}
                disabled={destFolder === ''}
                className="btn btn-ghost"
              >
                {label('dialogRootOption')}
              </button>
              <datalist id={FOLDER_LIST_ID}>
                {destinationFolders.map((folder) => (
                  <option key={folder} value={folder} />
                ))}
              </datalist>
            </div>
            <p className={`text-xs mt-1 ${folderInvalid ? 'text-plm-error' : 'text-plm-fg-muted'}`}>
              {folderInvalid ? label('dialogInvalidFolder') : label('dialogFolderHint')}
            </p>
            {!folderInvalid && preview.status !== 'loading' && destinationFolders.length === 0 && (
              <p className="text-xs mt-1 text-plm-fg-muted">{label('dialogNoFolders')}</p>
            )}
          </div>

          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={keepPath}
              onChange={(event) => setKeepPath(event.target.checked)}
              className="mt-0.5 accent-plm-accent"
            />
            <span>
              <span className="block text-sm text-plm-fg">{label('dialogKeepPath')}</span>
              <span className="block text-xs text-plm-fg-muted">{label('dialogKeepPathHint')}</span>
            </span>
          </label>

          <PreviewSummary
            status={preview.status}
            plan={plan}
            errorMessage={preview.status === 'error' ? preview.message : null}
            isMove={isMove}
            transferLabel={transferLabel}
            gaps={gaps}
          />
        </div>

        <div className="p-4 border-t border-plm-border flex justify-end gap-2">
          <button onClick={onClose} className="btn btn-ghost">
            {label('dialogCancel')}
          </button>
          <button onClick={handleConfirm} disabled={!canConfirm} className="btn btn-primary">
            {label(isMove ? 'dialogMoveButton' : 'dialogCopyButton', { files: transferLabel })}
          </button>
        </div>
      </div>
    </div>
  )
}

interface PreviewSummaryProps {
  status: 'loading' | 'ready' | 'error'
  plan: VaultTransferPlan | null
  errorMessage: string | null
  isMove: boolean
  transferLabel: string
  gaps: ReferenceGapsState
}

function PreviewSummary({
  status,
  plan,
  errorMessage,
  isMove,
  transferLabel,
  gaps,
}: PreviewSummaryProps) {
  if (status === 'loading') {
    return (
      <div className="flex items-center gap-2 text-sm text-plm-fg-muted">
        <Loader2 size={16} className="animate-spin" />
        {label('dialogChecking')}
      </div>
    )
  }

  if (status === 'error' || !plan) {
    return (
      <div className="flex items-start gap-2 text-sm text-plm-error">
        <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
        {label('dialogFailed', { error: errorMessage ?? '' })}
      </div>
    )
  }

  const nothingToDo = plan.files.length === 0 && plan.folders.length === 0
  const cloudOnlyCount = plan.files.filter((planned) => planned.strategy === 'cloud').length

  const notes: string[] = []
  if (cloudOnlyCount > 0) notes.push(label('dialogCloudOnly', { count: cloudOnlyCount }))
  if (plan.uploadBytes > 0) {
    notes.push(label('dialogUpload', { size: formatBytes(plan.uploadBytes) }))
  }
  if (plan.files.length > 0) notes.push(label('dialogHistoryNote'))
  if (plan.workflowStateCount > 0) {
    notes.push(label('dialogWorkflowNote', { count: plan.workflowStateCount }))
  }
  if (isMove && plan.files.length > 0) notes.push(label('dialogMoveNote'))

  const warnings: string[] = []
  if (gaps === 'unavailable') {
    warnings.push(label('dialogReferencesUnavailable'))
  } else if (gaps) {
    if (gaps.missingChildren.count > 0) {
      warnings.push(
        label('dialogMissingChildren', {
          count: gaps.missingChildren.count,
          examples: gaps.missingChildren.samples.join(', '),
        }),
      )
    }
    if (isMove && gaps.externalParents.count > 0) {
      warnings.push(
        label('dialogExternalParents', {
          count: gaps.externalParents.count,
          examples: gaps.externalParents.samples.join(', '),
        }),
      )
    }
  }

  return (
    <div className="space-y-3">
      {nothingToDo ? (
        <div className="text-sm text-plm-warning">{label('dialogNothingToTransfer')}</div>
      ) : (
        <div className="text-sm text-plm-fg">
          {label(isMove ? 'dialogWillMove' : 'dialogWillCopy', {
            files: transferLabel,
            size: formatBytes(plan.totalBytes),
          })}
        </div>
      )}

      {plan.skipped.length > 0 && <SkippedList skipped={plan.skipped} />}

      {warnings.map((warning) => (
        <div key={warning} className="flex items-start gap-2 text-xs text-plm-warning">
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
          <span>{warning}</span>
        </div>
      ))}

      {notes.map((note) => (
        <div key={note} className="flex items-start gap-2 text-xs text-plm-fg-muted">
          <Info size={14} className="mt-0.5 flex-shrink-0" />
          <span>{note}</span>
        </div>
      ))}
    </div>
  )
}

function SkippedList({ skipped }: { skipped: VaultTransferPlan['skipped'] }) {
  const groups = SKIP_REASONS.map((reason) => ({
    reason,
    entries: skipped.filter((entry) => entry.reason === reason),
  })).filter((group) => group.entries.length > 0)

  return (
    <div className="bg-plm-bg rounded border border-plm-border p-3 space-y-2">
      <div className="text-sm text-plm-fg">
        {label('dialogSkippedHeading', { count: skipped.length })}
      </div>
      {groups.map(({ reason, entries }) => (
        <div key={reason}>
          <div className="text-xs text-plm-warning">
            {skipReasonLabel(reason)} ({entries.length})
          </div>
          <div className="mt-0.5 space-y-0.5">
            {entries.slice(0, SKIPPED_EXAMPLES_PER_REASON).map((entry) => (
              <div key={entry.relativePath} className="text-xs text-plm-fg-dim truncate">
                {entry.relativePath}
              </div>
            ))}
            {entries.length > SKIPPED_EXAMPLES_PER_REASON && (
              <div className="text-xs text-plm-fg-muted">
                {label('dialogSkippedMore', {
                  count: entries.length - SKIPPED_EXAMPLES_PER_REASON,
                })}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
