import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, Loader2, Play, X } from 'lucide-react'

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
  /** One line on the card. */
  short: string
  /** The full explanation, on hover. */
  hint: string
}

function scopeOptions(): ScopeOption[] {
  return [
    {
      kind: 'configuration-recorded',
      label: t('vaultAudit.scope.configurationRecorded'),
      short: t('vaultAudit.scope.configurationRecordedShort'),
      hint: t('vaultAudit.scope.configurationRecordedHint'),
    },
    {
      kind: 'folder',
      label: t('vaultAudit.scope.folder'),
      short: t('vaultAudit.scope.folderShort'),
      hint: t('vaultAudit.scope.folderHint'),
    },
    {
      kind: 'whole-vault',
      label: t('vaultAudit.scope.wholeVault'),
      short: t('vaultAudit.scope.wholeVaultShort'),
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
  // While a scan runs the scope cannot change, so it is a line too.
  const showOptions = !isRunning && (!hasResult || expanded)
  useEffect(() => {
    if (isRunning) setExpanded(false)
  }, [isRunning])
  const options = scopeOptions()
  const current = options.find((option) => option.kind === scope.kind)

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

  const runButton = isRunning ? (
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
  )

  // After a run the scope is a line, not a form: it is settled, and the result is what to read.
  if (!showOptions) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-ui-divider px-3 py-2">
        <span className="text-[13px] text-ui-fg-secondary">{t('vaultAudit.scope.label')}</span>
        <span className="min-w-0 truncate text-[13px] font-medium text-ui-fg">
          {scope.kind === 'folder' && scope.folderPath
            ? `${current?.label ?? ''}: ${scope.folderPath}`
            : (current?.label ?? '')}
        </span>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          disabled={isRunning}
          aria-expanded={false}
          className="text-[13px] text-ui-accent hover:underline disabled:opacity-40"
        >
          {t('vaultAudit.scope.change')}
        </button>
        <div className="ml-auto flex items-center gap-2">
          {canScan && folderBlocks && (
            <span className="text-[13px] text-ui-warning">
              {t('vaultAudit.scope.folderFixFirst')}
            </span>
          )}
          {isRunning && <Loader2 size={14} className="animate-spin text-ui-fg-secondary" />}
          {runButton}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3 rounded-xl border border-ui-divider p-4">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-[14px] font-semibold text-ui-fg">{t('vaultAudit.scope.legend')}</h4>
        {hasResult && (
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="text-[13px] text-ui-accent hover:underline"
          >
            {t('vaultAudit.scope.done')}
          </button>
        )}
      </div>

      <fieldset
        disabled={isRunning}
        className={`grid gap-2 sm:grid-cols-3 ${isRunning ? 'opacity-60' : ''}`}
      >
        <legend className="sr-only">{t('vaultAudit.scope.legend')}</legend>
        {options.map((option) => {
          const selected = scope.kind === option.kind
          return (
            <label
              key={option.kind}
              title={option.hint}
              className={`flex cursor-pointer flex-col gap-1 rounded-lg border px-3 py-2.5 transition-colors ${
                selected
                  ? 'border-ui-accent/70 bg-ui-accent/[0.07]'
                  : 'border-ui-divider hover:bg-ui-hover'
              } ${isRunning ? 'cursor-not-allowed' : ''}`}
            >
              <span className="flex items-center gap-2">
                <input
                  type="radio"
                  name="vault-audit-scope"
                  className="accent-ui-accent"
                  checked={selected}
                  onChange={() => onScopeChange({ ...scope, kind: option.kind })}
                />
                <span className="text-[13px] font-medium text-ui-fg">{option.label}</span>
              </span>
              <span className="pl-5 text-[12px] leading-[1.45] text-ui-fg-secondary">
                {option.short}
              </span>
            </label>
          )
        })}
      </fieldset>

      {/* Outside the cards: a label around a text box, a list and a tree would forward stray
          clicks on any of them to the radio. */}
      {isFolderScope && folderIndex && folderStatus && (
        <div>
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

      <div className="flex items-center justify-end gap-3 pt-1">
        {!canScan && (
          <span className="mr-auto text-[13px] text-ui-fg-secondary">{t('vaultAudit.noVault')}</span>
        )}
        {isRunning && <Loader2 size={14} className="animate-spin text-ui-fg-secondary" />}
        {runButton}
      </div>
    </div>
  )
}
