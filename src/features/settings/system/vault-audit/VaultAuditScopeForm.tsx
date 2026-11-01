import { useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, ChevronDown, ChevronRight, Loader2, Play, X } from 'lucide-react'

import { Button } from '@/components/core/ui'
import { t } from '@/lib/i18n'
import { usePDMStore } from '@/stores/pdmStore'
import type { VaultAuditScope, VaultAuditScopeKind } from '@/types/vaultAudit'

import { VaultAuditFolderPicker } from './VaultAuditFolderPicker'
import {
  buildFolderIndex,
  folderScopeBlocksRun,
  folderScopeStatus,
  type FolderScopeStatus,
} from './vaultAuditFolders'

interface VaultAuditScopeFormProps {
  scope: VaultAuditScope
  onScopeChange: (scope: VaultAuditScope) => void
  isRunning: boolean
  /** A vault is connected. False shows the "connect a vault" hint next to the button. */
  canScan: boolean
  /**
   * Something other than a missing vault prevents a run - today, a SolidWorks service too old to
   * answer the audit's read command. The reason is stated above the form, so the button only has
   * to stop being clickable.
   */
  blocked: boolean
  cancelRequested: boolean
  hasResult: boolean
  onStart: () => void
  onCancel: () => void
}

interface ScopeOption {
  kind: VaultAuditScopeKind
  label: string
  hint: string
}

function scopeOptions(): ScopeOption[] {
  return [
    {
      kind: 'configuration-recorded',
      label: t('vaultAudit.scope.configurationRecorded'),
      hint: t('vaultAudit.scope.configurationRecordedHint'),
    },
    {
      kind: 'folder',
      label: t('vaultAudit.scope.folder'),
      hint: t('vaultAudit.scope.folderHint'),
    },
    {
      kind: 'whole-vault',
      label: t('vaultAudit.scope.wholeVault'),
      hint: t('vaultAudit.scope.wholeVaultHint'),
    },
  ]
}

/** `t()` has no plural rules, so the `_one` / `_other` key is chosen here. */
function pluralKey(key: string, count: number): string {
  return `${key}_${count === 1 ? 'one' : 'other'}`
}

/** One line under the folder box saying what the scope will match, or why it cannot run. */
function FolderStatusLine({ status, vaultPath }: { status: FolderScopeStatus; vaultPath: string }) {
  if (status.kind === 'unknown') return null

  if (status.kind === 'found') {
    const { modelCount, onDiskCount } = status.folder
    if (modelCount === 0) {
      return <StatusText warning>{t('vaultAudit.scope.folderNoModels')}</StatusText>
    }
    const notOnDisk = modelCount - onDiskCount
    return (
      <StatusText>
        {t(pluralKey('vaultAudit.scope.folderModels', modelCount), { count: modelCount })}
        {notOnDisk > 0 &&
          ` ${t(pluralKey('vaultAudit.scope.folderNotOnDisk', notOnDisk), { count: notOnDisk })}`}
      </StatusText>
    )
  }

  const text =
    status.kind === 'empty'
      ? t('vaultAudit.scope.folderRequired')
      : status.kind === 'outside-vault'
        ? t('vaultAudit.scope.folderOutsideVault', { vault: vaultPath })
        : t('vaultAudit.scope.folderNotFound')
  return <StatusText warning={status.kind !== 'empty'}>{text}</StatusText>
}

function StatusText({ warning, children }: { warning?: boolean; children: ReactNode }) {
  return (
    <p
      className={`mt-1.5 flex items-start gap-1.5 text-[13px] ${
        warning ? 'text-ui-warning' : 'text-ui-fg-secondary'
      }`}
    >
      {warning && <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />}
      <span>{children}</span>
    </p>
  )
}

export function VaultAuditScopeForm({
  scope,
  onScopeChange,
  isRunning,
  canScan,
  blocked,
  cancelRequested,
  hasResult,
  onStart,
  onCancel,
}: VaultAuditScopeFormProps) {
  // Once there is a result the list is what matters, so the three options fold into one line
  // naming the scope, and open again on request.
  const [expanded, setExpanded] = useState(false)
  const showOptions = !hasResult || expanded
  const options = scopeOptions()
  const current = options.find((option) => option.kind === scope.kind)
  const Chevron = showOptions ? ChevronDown : ChevronRight

  const vaultPath = usePDMStore((state) => state.vaultPath) ?? ''
  const files = usePDMStore((state) => state.files)
  const isFolderScope = scope.kind === 'folder'
  // Built only while a folder is being chosen: the store's file list changes with every watcher
  // event, and the other two scopes have no use for it.
  const folderIndex = useMemo(
    () => (isFolderScope ? buildFolderIndex(files) : null),
    [isFolderScope, files],
  )
  const folderStatus = folderIndex
    ? folderScopeStatus(folderIndex, scope.folderPath, vaultPath)
    : null
  const folderBlocks = folderStatus !== null && folderScopeBlocksRun(folderStatus)

  return (
    <div className="space-y-3">
      {hasResult && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={showOptions}
          className="flex items-center gap-1.5 text-[14px] text-ui-fg-secondary hover:text-ui-fg"
        >
          <Chevron size={14} />
          {t('vaultAudit.scope.current', {
            scope:
              scope.kind === 'folder' && scope.folderPath
                ? `${current?.label ?? ''}: ${scope.folderPath}`
                : (current?.label ?? ''),
          })}
        </button>
      )}

      <fieldset
        disabled={isRunning}
        className={`divide-y divide-ui-divider ${showOptions ? '' : 'hidden'}`}
      >
        <legend className="mb-1 text-[14px] font-semibold text-ui-fg">
          {t('vaultAudit.scope.legend')}
        </legend>

        {options.map((option) => (
          <div key={option.kind} className="py-3.5">
            <label
              className={`flex cursor-pointer gap-3 ${
                isRunning ? 'cursor-not-allowed opacity-60' : ''
              }`}
            >
              <input
                type="radio"
                name="vault-audit-scope"
                className="mt-1 accent-ui-accent"
                checked={scope.kind === option.kind}
                onChange={() => onScopeChange({ ...scope, kind: option.kind })}
              />
              <div className="min-w-0">
                <div className="text-[14px] text-ui-fg">{option.label}</div>
                <p className="mt-1 text-[14px] leading-[1.4] text-ui-fg-secondary">{option.hint}</p>
              </div>
            </label>
            {/* Outside the label: a label around a text box, a list and a tree would forward
                stray clicks on any of them to the radio. */}
            {option.kind === 'folder' && folderIndex && folderStatus && (
              <div className="pl-7">
                <VaultAuditFolderPicker
                  value={scope.folderPath}
                  onChange={(folderPath) => onScopeChange({ kind: 'folder', folderPath })}
                  index={folderIndex}
                  match={folderStatus.kind === 'found' ? folderStatus.folder : null}
                  vaultPath={vaultPath}
                  disabled={isRunning}
                />
                <FolderStatusLine status={folderStatus} vaultPath={vaultPath} />
              </div>
            )}
          </div>
        ))}
      </fieldset>

      <div className="flex items-center gap-2">
        {isRunning ? (
          <Button icon={<X size={14} />} onClick={onCancel} disabled={cancelRequested}>
            {cancelRequested ? t('vaultAudit.cancelling') : t('vaultAudit.cancel')}
          </Button>
        ) : (
          <Button
            variant="primary"
            icon={<Play size={14} />}
            onClick={onStart}
            disabled={!canScan || blocked || folderBlocks}
          >
            {hasResult ? t('vaultAudit.rescan') : t('vaultAudit.scan')}
          </Button>
        )}

        {isRunning && <Loader2 size={14} className="animate-spin text-ui-fg-secondary" />}
        {!canScan && (
          <span className="text-[13px] text-ui-fg-secondary">{t('vaultAudit.noVault')}</span>
        )}
        {/* With the options folded the folder line is out of sight, so the reason comes here. */}
        {canScan && folderBlocks && !showOptions && (
          <span className="text-[13px] text-ui-warning">
            {t('vaultAudit.scope.folderFixFirst')}
          </span>
        )}
      </div>
    </div>
  )
}
