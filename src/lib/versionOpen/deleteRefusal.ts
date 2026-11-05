/**
 * The database refuses deleting a file version that a released version's closure references
 * (schema 515, gap 12 a, hint `REFERENCED_BY_RELEASE`): a released assembly keeps every child
 * version it was released with. The delete paths turn that refusal into a sentence.
 */

import { t } from '@/lib/i18n'

export const REFERENCED_BY_RELEASE = 'REFERENCED_BY_RELEASE'

export function isReferencedByRelease(error: { hint?: string | null; message?: string } | null | undefined): boolean {
  if (!error) return false
  return error.hint === REFERENCED_BY_RELEASE || (error.message ?? '').includes(REFERENCED_BY_RELEASE)
}

/** The message for a refused permanent delete of `fileName`. */
export function referencedByReleaseMessage(fileName: string): string {
  return t('versionOpen.deleteReferencedByRelease', { name: fileName })
}
