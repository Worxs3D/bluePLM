/**
 * Ask before a checkout drops unsaved metadata edits the user can no longer check in.
 *
 * Checking out a file nobody holds clears its `pendingMetadata`. That is right for an edit the
 * last check-in already committed, and wrong to do silently for one that was stranded when the
 * checkout went away without a check-in. This lists every such edit with its value and lets the
 * user stop. It never restores an edit: the value may be older than what the file's later holder
 * checked in.
 */

import { t } from '@/lib/i18n'
import { log } from '@/lib/logger'
import {
  editedValueText,
  findStrandedEdits,
  type PendingMetadataField,
  type StrandedEdit,
  type StrandedEditSource,
} from '@/lib/metadata/strandedEdits'

import type { CommandContext } from '../types'

function fieldName(field: PendingMetadataField): string {
  return t(`strandedEdits.field.${field}`)
}

/** One line per file for the confirmation list: the path and every edit that would be lost. */
export function describeStrandedEdit(edit: StrandedEdit): string {
  const parts = edit.fields.map((field) => {
    const { value, configurations } = editedValueText(edit.pending, field)
    if (configurations !== null) {
      return t('strandedEdits.configurationEdit', { field: fieldName(field), count: configurations })
    }
    return value === null
      ? t('strandedEdits.clearedEdit', { field: fieldName(field) })
      : t('strandedEdits.valueEdit', { field: fieldName(field), value })
  })
  return t('strandedEdits.item', { path: edit.relativePath, edits: parts.join('; ') })
}

/**
 * Resolve to true when the checkout may go ahead.
 *
 * With nothing stranded this asks nothing. With no way to ask, it refuses rather than dropping
 * the edits unannounced. Either way the edits are logged with their values first, so a dropped
 * one can still be recovered from the log.
 */
export async function confirmDroppingStrandedEdits(
  files: readonly StrandedEditSource[],
  ctx: Pick<CommandContext, 'confirm'>,
  operationId: string,
): Promise<{ proceed: boolean; stranded: StrandedEdit[] }> {
  const stranded = findStrandedEdits(files)
  if (stranded.length === 0) return { proceed: true, stranded }

  log.warn('[Checkout]', 'Checkout would drop unsaved metadata edits', {
    operationId,
    files: stranded.map((edit) => ({ path: edit.relativePath, pending: edit.pending })),
  })

  if (!ctx.confirm) return { proceed: false, stranded }

  const proceed = await ctx.confirm({
    title: t('strandedEdits.confirmTitle', { count: stranded.length }),
    message: t('strandedEdits.confirmMessage'),
    items: stranded.map(describeStrandedEdit),
    confirmText: t('strandedEdits.confirmContinue'),
  })

  log.info('[Checkout]', proceed ? 'User chose to drop stranded edits' : 'User kept stranded edits', {
    operationId,
    count: stranded.length,
  })
  return { proceed, stranded }
}
