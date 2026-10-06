/**
 * `restore-metadata-from-files` - fill empty part numbers and descriptions from the files.
 *
 * Recovery for rows whose `part_number` / `description` were blanked while the SolidWorks file
 * kept the value - the shape `syncFile` and `syncSolidWorksFileMetadata` used to leave behind by
 * writing `null` over a populated column. `scan-divergence` finds these and, correctly for a
 * scanner, refuses to repair them: nothing in the two values says the column ever held one. This
 * command is the explicit decision the scanner leaves to an admin.
 *
 * Dry run by default: it scans read-only and prints what it would write. `--apply` writes, and
 * every write is conditional on the column still being empty at that moment, so a value checked
 * in after the scan always wins. No version is created and no file is touched.
 *
 * Usage:
 *   restore-metadata-from-files [--path=<prefix>] [--exclude=<prefix>[;<prefix>...]]
 *                               [--limit=<n>] [--apply]
 */

import { log } from '@/lib/logger'
import { t } from '@/lib/i18n'
import { runDivergenceScan } from '@/lib/metadata/divergenceScan'
import {
  buildMetadataRestorePlan,
  restoreStatesOf,
  type MetadataRestoreFile,
  type RestorableField,
} from '@/lib/metadata/metadataRestorePlan'
import { fillEmptyFileMetadataBatch } from '@/lib/supabase/files/fillEmptyMetadata'

import { usePDMStore } from '../../../stores/pdmStore'
import { registerTerminalCommand } from '../registry'
import type { ParsedCommand, TerminalOutput } from '../parser'

type OutputFn = (type: TerminalOutput['type'], content: string) => void

/** Separator for several `--exclude` prefixes; a semicolon cannot appear in a Windows path. */
const EXCLUDE_SEPARATOR = ';'

let running = false

function numericFlag(parsed: ParsedCommand, name: string): number | undefined {
  const raw = parsed.flags[name]
  if (typeof raw !== 'string') return undefined
  const value = Number.parseInt(raw, 10)
  return Number.isFinite(value) && value > 0 ? value : undefined
}

function stringFlag(parsed: ParsedCommand, name: string): string | undefined {
  const raw = parsed.flags[name]
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined
}

/**
 * Absolute paths, lower-cased, that SolidWorks currently has open, so the scan leaves them unread.
 * SolidWorks not running is not an error: nothing is open.
 */
async function readOpenDocuments(): Promise<Set<string>> {
  try {
    const result = await window.electronAPI?.solidworks?.getOpenDocuments?.({
      includeComponents: true,
    })
    if (!result?.success || !result.data?.documents) return new Set()
    return new Set(result.data.documents.map((document) => document.filePath.toLowerCase()))
  } catch (error) {
    log.warn('[RestoreMetadata]', 'Could not ask SolidWorks which documents are open', {
      error: error instanceof Error ? error.message : String(error),
    })
    return new Set()
  }
}

function describeValues(entry: MetadataRestoreFile): string {
  return (Object.keys(entry.values) as RestorableField[])
    .map((field) =>
      t('metadataRestore.fieldValue', {
        field: t(`metadataRestore.field.${field}`),
        value: entry.values[field] ?? '',
      }),
    )
    .join('; ')
}

async function applyPlan(
  files: readonly MetadataRestoreFile[],
  userId: string,
  addOutput: OutputFn,
): Promise<void> {
  const receipt = await fillEmptyFileMetadataBatch(files, userId)

  const { updateFilePdmData } = usePDMStore.getState()
  for (const { fileId, row } of receipt.updatedRows) updateFilePdmData(fileId, row)

  for (const failure of receipt.failed) {
    addOutput(
      'error',
      t('metadataRestore.fileFailed', { path: failure.relativePath, reason: failure.reason }),
    )
  }
  for (const path of receipt.refusedPaths) {
    addOutput('error', t('metadataRestore.fileRefused', { path }))
  }
  for (const path of receipt.heldByOther) {
    addOutput('error', t('metadataRestore.heldByOther', { path }))
  }

  const counts = {
    filled: receipt.filled,
    alreadySet: receipt.alreadySet,
    refused: receipt.refused,
    failed: receipt.failed.length,
  }
  log.info('[RestoreMetadata]', 'Restore applied', {
    ...counts,
    heldByOther: receipt.heldByOther.length,
  })
  addOutput('success', t('metadataRestore.applied', counts))
}

async function handleRestore(parsed: ParsedCommand, addOutput: OutputFn): Promise<void> {
  const { organization, activeVaultId, vaultPath, user } = usePDMStore.getState()
  if (!organization?.id || !user?.id) {
    addOutput('error', t('metadataRestore.noOrganization'))
    return
  }
  if (!vaultPath) {
    addOutput('error', t('metadataRestore.noVault'))
    return
  }

  const apply = parsed.flags.apply === true
  if (apply && user.role !== 'admin') {
    addOutput('error', t('metadataRestore.adminOnly'))
    return
  }

  addOutput('info', t('metadataRestore.scanning'))
  const report = await runDivergenceScan({
    orgId: organization.id,
    vaultId: activeVaultId,
    vaultPath,
    pathPrefix: stringFlag(parsed, 'path'),
    limit: numericFlag(parsed, 'limit'),
    openInSolidWorks: await readOpenDocuments(),
    timingRepeats: 0,
    onProgress: (message) => addOutput('info', message),
  })

  if (report.cancelled) {
    addOutput('info', t('metadataRestore.cancelled'))
    return
  }

  const unread =
    report.counts.filesUnreadable +
    report.counts.filesMissingOnDisk +
    report.counts.filesOpenInSolidWorks
  if (unread > 0) addOutput('error', t('metadataRestore.unread', { count: unread }))

  const fileStates = restoreStatesOf(usePDMStore.getState().files)
  const plan = buildMetadataRestorePlan(report.files, {
    userId: user.id,
    excludePrefixes: (stringFlag(parsed, 'exclude') ?? '')
      .split(EXCLUDE_SEPARATOR)
      .map((prefix) => prefix.trim())
      .filter((prefix) => prefix.length > 0),
    stateOf: (fileId) => fileStates.get(fileId),
  })

  for (const entry of plan.files) {
    addOutput(
      'output',
      t('metadataRestore.planLine', { path: entry.relativePath, values: describeValues(entry) }),
    )
  }
  for (const entry of plan.heldByOthers) {
    addOutput('error', t('metadataRestore.heldByOther', { path: entry.relativePath }))
  }

  addOutput(
    'info',
    t('metadataRestore.summary', {
      files: plan.files.length,
      values: plan.valueCount,
      excluded: plan.excluded.length,
      held: plan.heldByOthers.length,
      pending: plan.pendingEditsKept,
    }),
  )

  if (plan.files.length === 0) return
  if (!apply) {
    addOutput('info', t('metadataRestore.dryRun'))
    return
  }

  await applyPlan(plan.files, user.id, addOutput)
}

registerTerminalCommand(
  {
    aliases: ['restore-metadata-from-files'],
    description:
      'Fill empty part numbers and descriptions in the database from the SolidWorks files (dry run unless --apply)',
    usage:
      'restore-metadata-from-files [--path=<prefix>] [--exclude=<prefix>[;<prefix>]] [--limit=<n>] [--apply]',
    examples: [
      'restore-metadata-from-files --path="ELEC"',
      'restore-metadata-from-files --exclude="0 - SHARED\\01-TOOLBOX" --apply',
    ],
    category: 'admin',
  },
  async (parsed, _files, addOutput) => {
    if (running) {
      addOutput('error', t('metadataRestore.alreadyRunning'))
      return
    }
    running = true
    try {
      await handleRestore(parsed, addOutput)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      log.error('[RestoreMetadata]', 'Restore failed', { error: reason })
      addOutput('error', t('metadataRestore.failed', { reason }))
    } finally {
      running = false
    }
  },
)
