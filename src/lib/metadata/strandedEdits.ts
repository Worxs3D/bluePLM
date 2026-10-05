/**
 * Unsaved metadata edits on a file the user no longer holds.
 *
 * An edit lives in `pendingMetadata` until check-in commits it, and check-in needs the checkout.
 * When the checkout goes away without a check-in - an admin force release, a release or check-in
 * from another machine, a colleague taking the file - the edit is stranded: still shown on this
 * machine, already written into the SolidWorks file, and absent from BluePLM. Checking the file
 * out again clears `pendingMetadata`, so the next checkout is where it used to vanish silently.
 *
 * This module only finds and describes them. Nothing here restores an edit: a stranded value may
 * be older than what the file's later holder checked in, and putting it back automatically could
 * overwrite a colleague's change.
 *
 * Pure: no I/O, no store, no React.
 */

import type { PendingMetadata } from '@/stores/types'

export type PendingMetadataField = keyof PendingMetadata

/** What a file needs to carry for this module to judge it. `LocalFile` satisfies it. */
export interface StrandedEditSource {
  path: string
  relativePath: string
  pendingMetadata?: PendingMetadata
  pdmData?: { id?: string; checked_out_by?: string | null } | null
}

export interface StrandedEdit {
  path: string
  relativePath: string
  /** The edited fields, in a stable order. Presence decides: an edit that cleared a field counts. */
  fields: PendingMetadataField[]
  /** The edits themselves, so the warning can show what would be lost. */
  pending: PendingMetadata
}

const FIELD_ORDER: readonly PendingMetadataField[] = [
  'part_number',
  'tab_number',
  'description',
  'revision',
  'config_tabs',
  'config_descriptions',
]

/** Fields the pending set holds an edit for. An empty object is no edit at all. */
export function editedFieldsOf(pending: PendingMetadata | undefined): PendingMetadataField[] {
  if (!pending) return []
  const present = new Set(
    Object.entries(pending)
      .filter(([, value]) => value !== undefined)
      .map(([key]) => key),
  )
  return FIELD_ORDER.filter((field) => present.has(field))
}

/**
 * The files among `files` whose unsaved edits a checkout would drop.
 *
 * Only a synced file nobody holds is checked out afresh, and only that path clears the pending
 * set; a file the user still holds keeps its edits. Pass the files the checkout is about to take.
 */
export function findStrandedEdits(files: readonly StrandedEditSource[]): StrandedEdit[] {
  const stranded: StrandedEdit[] = []
  for (const file of files) {
    if (!file.pdmData?.id || file.pdmData.checked_out_by) continue
    const fields = editedFieldsOf(file.pendingMetadata)
    if (fields.length === 0 || !file.pendingMetadata) continue
    stranded.push({
      path: file.path,
      relativePath: file.relativePath,
      fields,
      pending: file.pendingMetadata,
    })
  }
  return stranded
}

/**
 * One field's edit as text for the warning. A configuration map is summarised by how many
 * configurations it touches; a cleared field is shown as empty, because that is the edit.
 */
export function editedValueText(
  pending: PendingMetadata,
  field: PendingMetadataField,
): { value: string | null; configurations: number | null } {
  const value = pending[field]
  if (value !== null && typeof value === 'object') {
    return { value: null, configurations: Object.keys(value).length }
  }
  return { value: typeof value === 'string' && value !== '' ? value : null, configurations: null }
}

/**
 * Whether a checkout change just stranded this user's unsaved edits.
 *
 * True when the user held the file, no longer does, and has edits pending on it. Who took it, if
 * anyone, does not change the answer - the edits can no longer be checked in either way.
 */
export function checkoutLostWithEdits(change: {
  previousHolder: string | null | undefined
  nextHolder: string | null | undefined
  userId: string | null | undefined
  pending: PendingMetadata | undefined
}): boolean {
  if (!change.userId) return false
  if (change.previousHolder !== change.userId) return false
  if (change.nextHolder === change.userId) return false
  return editedFieldsOf(change.pending).length > 0
}
