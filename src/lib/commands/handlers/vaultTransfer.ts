/**
 * Copy to Vault / Move to Vault
 *
 * Carries files, and the folders they sit in, from the active vault into another connected vault
 * of the same organization. The two commands share everything but the last step: a Move takes the
 * sources away after the destination has them.
 *
 * The rules that make it safe to run on a real vault:
 *
 * - Nothing in the destination is ever replaced. A path that is already taken, on the server or
 *   on the destination's disk, is skipped and reported, and the database is asked to refuse an
 *   overwrite too (`syncFile` with `insertOnly`) for the path that was taken a moment ago.
 * - Nothing is deleted from the source until the destination copy is verified, and a source that
 *   changed in the meantime is kept. A Move that stops anywhere leaves a duplicate, not a loss.
 * - Cloud-only files are never downloaded to be moved: the destination gets a row that points at
 *   the same stored content.
 * - The destination vault does not have to be open. Its rows are written through the server and
 *   its disk through the Electron calls that take any path.
 *
 * The planning, the engine and the removal live in `src/lib/vaultTransfer`, which is where the
 * tests are; this file is the glue to the command system, the store and the toasts.
 */

import { log } from '@/lib/logger'
import { t } from '@/lib/i18n'
import { addToSyncIndex, removeFromSyncIndex } from '@/lib/cache/localSyncIndex'
import { beginWatcherSuppression } from '@/lib/fileWatcherSuppression'
import { checkOperationPermission, type OperationId } from '@/lib/permissions'
import { getAccessibleVaults } from '@/lib/supabase/vaults'
import { isPathWithinDirectory } from '@/lib/utils/path'
import {
  createPrepareDeps,
  createRemovalDeps,
  createTransferDeps,
  normalizeDestFolder,
  prepareVaultTransfer,
  removeMovedSources,
  runVaultTransfer,
  vaultFoldersOverlap,
} from '@/lib/vaultTransfer'
import { buildTransferReport, type TransferReport } from '@/lib/vaultTransfer/report'
import {
  describeReport,
  fileCountLabel,
  prepareFailureLabel,
  skipReasonLabel,
  vaultTransferKey,
} from '@/lib/vaultTransfer/labels'
import type { RemoveSourcesOutcome } from '@/lib/vaultTransfer/removeSources'
import type { VaultTransferMode } from '@/lib/vaultTransfer/types'
import { usePDMStore } from '@/stores/pdmStore'

import { ProgressTracker } from '../executor'
import type { Command, CommandContext, CommandId, CommandResult, VaultTransferParams } from '../types'

/** Distinct skip reasons named in the "nothing to transfer" message before it is cut off. */
const REPORTED_REASON_LIMIT = 3

function logTransfer(
  level: 'info' | 'warn' | 'error' | 'debug',
  message: string,
  context: Record<string, unknown>,
): void {
  log[level]('[VaultTransfer]', message, context)
}

function failure(message: string): CommandResult {
  return { success: false, message, total: 0, succeeded: 0, failed: 0 }
}

/** Whether any selected path is, or contains, or sits inside a path another operation is working on. */
function overlapsProcessing(files: ReadonlyArray<{ relativePath: string }>, ctx: CommandContext) {
  for (const processing of ctx.processingOperations.keys()) {
    for (const file of files) {
      if (
        isPathWithinDirectory(processing, file.relativePath) ||
        isPathWithinDirectory(file.relativePath, processing)
      ) {
        return true
      }
    }
  }
  return false
}

function createVaultTransferCommand(
  id: Extract<CommandId, 'copy-to-vault' | 'move-to-vault'>,
  mode: VaultTransferMode,
): Command<VaultTransferParams> {
  const isMove = mode === 'move'

  return {
    id,
    name: isMove ? 'Move to Vault' : 'Copy to Vault',
    description: isMove
      ? 'Move files to another connected vault'
      : 'Copy files to another connected vault',

    validate({ files, destVaultId, destFolder }, ctx) {
      if (ctx.isOfflineMode) return t(vaultTransferKey('validationOffline'))
      if (!ctx.user || !ctx.organization) return t(vaultTransferKey('validationNotSignedIn'))
      if (!ctx.activeVaultId || !ctx.vaultPath) return t(vaultTransferKey('validationNoVault'))
      if (!files || files.length === 0) return t(vaultTransferKey('validationNoSelection'))
      if (!window.electronAPI) return t(vaultTransferKey('validationDesktopOnly'))

      const store = usePDMStore.getState()

      // A move needs both halves: create in the destination, delete here.
      const required: OperationId[] = isMove ? ['copy-to-vault', 'move-to-vault'] : ['copy-to-vault']
      for (const operation of required) {
        const permission = checkOperationPermission(operation, store.hasPermission)
        if (!permission.allowed) return permission.reason ?? t(vaultTransferKey('noPermission'))
      }

      const destVault = store.connectedVaults.find((vault) => vault.id === destVaultId)
      if (!destVault) return t(vaultTransferKey('validationNotConnected'))
      if (destVault.id === ctx.activeVaultId) return t(vaultTransferKey('validationSameVault'))
      if (vaultFoldersOverlap(ctx.vaultPath, destVault.localPath)) {
        return t(vaultTransferKey('validationOverlap'))
      }
      if (normalizeDestFolder(destFolder) === null) {
        return t(vaultTransferKey('validationInvalidFolder'))
      }

      if (store.isOperationRunning || store.operationQueue.length > 0) {
        return t(vaultTransferKey('validationBusy'))
      }
      if (overlapsProcessing(files, ctx)) return t(vaultTransferKey('validationItemsBusy'))

      return null
    },

    async execute({ files, destVaultId, destFolder, keepPath }, ctx): Promise<CommandResult> {
      const startedAt = Date.now()
      const user = ctx.user!
      const organization = ctx.organization!
      const sourceVaultId = ctx.activeVaultId!
      const sourceVaultPath = ctx.vaultPath!
      const destVault = usePDMStore
        .getState()
        .connectedVaults.find((vault) => vault.id === destVaultId)!

      // Connected on this machine is not the same as allowed to write to: access can have been
      // revoked since the vault was connected, and the server decides.
      const access = await getAccessibleVaults(user.id, organization.id, ctx.getEffectiveRole())
      if (access.error || !access.vaults.some((vault) => vault.id === destVaultId)) {
        const message = t(vaultTransferKey('validationNoAccess'))
        ctx.addToast('error', message)
        return failure(message)
      }

      // Planned again here rather than trusted from the dialog's preview, which may be minutes old.
      const prepared = await prepareVaultTransfer(
        {
          orgId: organization.id,
          destVaultId,
          destVaultPath: destVault.localPath,
          selection: files,
          vaultFiles: ctx.files,
          options: { mode, destFolder, keepPath },
        },
        createPrepareDeps(),
      )

      if (!prepared.ok) {
        const message = prepareFailureLabel(prepared.failure, prepared.message)
        ctx.addToast('error', message)
        return failure(message)
      }

      const { plan } = prepared

      if (plan.files.length === 0 && plan.folders.length === 0) {
        const reasons = [...new Set(plan.skipped.map((entry) => skipReasonLabel(entry.reason)))]
        const detail = reasons.slice(0, REPORTED_REASON_LIMIT).join('; ')
        const message = detail
          ? `${t(vaultTransferKey('prepareNothingToTransfer'))} (${detail})`
          : t(vaultTransferKey('prepareNothingToTransfer'))
        ctx.addToast('warning', message)
        return { ...failure(message), total: plan.skipped.length, failed: plan.skipped.length }
      }

      logTransfer('info', 'Starting transfer', {
        mode,
        sourceVaultId,
        destVaultId,
        files: plan.files.length,
        skipped: plan.skipped.length,
        folders: plan.folders.length,
        bytes: plan.totalBytes,
        uploadBytes: plan.uploadBytes,
        keepPath,
        destFolder,
      })

      const processingPaths = files.map((file) => file.relativePath)
      ctx.addProcessingFoldersSync(processingPaths, 'upload')

      const total = Math.max(plan.files.length, 1)
      const progress = new ProgressTracker(
        ctx,
        id,
        `${id}-${Date.now()}`,
        t(vaultTransferKey(isMove ? 'progressMove' : 'progressCopy'), {
          files: fileCountLabel(plan.files.length),
          vault: destVault.name,
        }),
        total,
      )

      let releaseWatcher: () => void = () => {}
      let report: TransferReport

      try {
        const run = await runVaultTransfer(
          plan,
          createTransferDeps({
            orgId: organization.id,
            userId: user.id,
            destVaultId,
            destVaultPath: destVault.localPath,
            isCancelled: () => progress.isCancelled(),
            onItemDone: () => progress.update(),
            log: (level, message, context) => logTransfer(level, message, context ?? {}),
          }),
        )

        // The destination's sync index: these files are on its disk and on its server, so a
        // later server-side delete must read as an orphan, not as local work to be uploaded.
        const placed = run.results
          .filter((result) => result.localCopy === 'copied')
          .map((result) => result.planned.destRelativePath)
        if (placed.length > 0) {
          addToSyncIndex(destVaultId, placed).catch((error) => {
            logTransfer('warn', 'Failed to update the destination sync index', {
              error: String(error),
            })
          })
        }

        let removal: RemoveSourcesOutcome | null = null
        if (isMove) {
          progress.setStatus(t(vaultTransferKey('progressRemoving')))

          const localPaths = run.results
            .filter((result) => result.status === 'transferred')
            .map((result) => result.planned.sourceRelativePath)
          releaseWatcher = beginWatcherSuppression(localPaths, ctx)

          removal = await removeMovedSources(
            { results: run.results, sourceFolders: plan.sourceFolders, vaultFiles: ctx.files },
            createRemovalDeps({ vaultPath: sourceVaultPath, sourceVaultId, userId: user.id }),
          )
          applyRemovalToStore(removal, ctx, sourceVaultId)
        }

        report = buildTransferReport(plan, run, removal)
      } finally {
        releaseWatcher()
        ctx.removeProcessingFoldersSync(processingPaths)
        progress.finish()
      }

      const { message, details } = describeReport(report, mode, destVault.name)
      const durationMs = Date.now() - startedAt

      logTransfer(report.severity === 'error' ? 'error' : 'info', 'Transfer finished', {
        mode,
        destVaultId,
        transferred: report.transferred,
        placedOnDisk: report.placedOnDisk,
        failed: report.failures.length,
        skipped: report.skipped.length,
        keptInSource: report.keptInSource.length,
        removed: report.removed,
        referencesCopied: report.referencesCopied,
        durationMs,
        problems: details,
      })

      if (!ctx.silent || report.severity !== 'success') {
        ctx.addToast(report.severity, message)
      }

      // A move changed what the source vault holds; a copy changed nothing here. Either way the
      // destination is not loaded, so only a move needs this vault to look again.
      if (isMove && report.keptInSource.length > 0) ctx.onRefresh?.(true)
      ctx.setLastOperationCompletedAt(Date.now())

      const failedCount =
        report.failures.length + report.cancelled + report.keptInSource.length

      return {
        success: report.severity === 'success',
        message,
        total: plan.files.length + plan.skipped.length,
        succeeded: report.transferred,
        failed: failedCount + report.skipped.length,
        details: details.length > 0 ? details : undefined,
        errors: report.failures.map(
          (entry) => `${entry.relativePath}: ${entry.message ?? entry.failure}`,
        ),
        duration: durationMs,
      }
    },
  }
}

/**
 * Take what a move removed out of the store, and mark the rest as still here.
 *
 * Only paths that really left are removed: a file the server refused to delete after its local
 * copy went is now a cloud file in this vault, which the refresh the caller requests will show.
 */
function applyRemovalToStore(
  removal: RemoveSourcesOutcome,
  ctx: CommandContext,
  sourceVaultId: string,
): void {
  const removedPaths = removal.removed.map((planned) => planned.source.path)
  const folderPaths = removal.foldersRemoved.map(
    (folder) =>
      ctx.files.find((file) => file.isDirectory && file.relativePath === folder)?.path ?? folder,
  )

  const allRemoved = [...removedPaths, ...folderPaths]
  if (allRemoved.length > 0) ctx.removeFilesFromStore(allRemoved)

  ctx.clearPersistedPendingMetadataForPaths(removedPaths)

  const relativePaths = removal.removed.map((planned) => planned.sourceRelativePath)
  if (relativePaths.length > 0) {
    removeFromSyncIndex(sourceVaultId, relativePaths).catch((error) => {
      logTransfer('warn', 'Failed to update the source sync index', { error: String(error) })
    })
  }
}

export const copyToVaultCommand = createVaultTransferCommand('copy-to-vault', 'copy')
export const moveToVaultCommand = createVaultTransferCommand('move-to-vault', 'move')
