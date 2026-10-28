import type { LocalFile } from '@/stores/types'

type ExclusionCandidateRow = Pick<LocalFile, 'relativePath' | 'isDirectory' | 'diffStatus'>

/** Row states that have no file behind them on this machine. */
const NOT_PRESENT_LOCALLY: ReadonlySet<string> = new Set(['cloud', 'deleted', 'moved_away'])

/**
 * Auto-download exclusions to drop because the file is on disk again.
 *
 * An exclusion only means "this file was removed locally, do not download it back". Once the
 * file exists locally - restored from the Recycle Bin, downloaded by hand, checked out - the
 * entry says nothing true and only keeps the persisted list growing (one vault carried ~8,000
 * paths, 98% of a 554 KB persisted blob). If the user removes the file again, the next load's
 * external-deletion pass adds the exclusion back.
 *
 * Matching is case-insensitive, like every other path match in the load pipeline.
 */
export function findExclusionsForFilesPresentLocally(
  exclusions: readonly string[],
  rows: readonly ExclusionCandidateRow[],
): Set<string> {
  const stale = new Set<string>()
  if (exclusions.length === 0) return stale

  const presentLocally = new Set<string>()
  for (const row of rows) {
    if (row.isDirectory) continue
    if (row.diffStatus && NOT_PRESENT_LOCALLY.has(row.diffStatus)) continue
    presentLocally.add(row.relativePath.toLowerCase())
  }

  for (const exclusion of exclusions) {
    if (presentLocally.has(exclusion.toLowerCase())) stale.add(exclusion)
  }
  return stale
}
