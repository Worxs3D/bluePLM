/**
 * The item browser's released view (5.9.0, schema 509): an item whose primary file has a released
 * version shows that version's revision and state first, and the newer work-in-progress version
 * as secondary text ("WIP v7"). Pure, so the choice is tested without React or a database.
 */
import { t } from '@/lib/i18n'
import { legacyStateOf } from '@/features/source/releases/releaseModel'
import type { ItemRow, ItemWorkflowStage } from '@/types/item'
import type { VersionRelease } from '@/types/releases'

/** The stage that stands for "released" in the browser: the first one named Released. */
function releasedStage(stages: readonly ItemWorkflowStage[]): ItemWorkflowStage | null {
  return stages.find((s) => legacyStateOf(s.name) === 'released') ?? null
}

/**
 * Rows with their primary file's newest released version applied. `releasesByFile` lists each
 * file's released versions newest first (`listReleasedVersions`); a file absent from it is not
 * loaded yet and its row is left as it is.
 */
export function applyItemReleases(
  rows: readonly ItemRow[],
  releasesByFile: ReadonlyMap<string, readonly VersionRelease[]>,
  stages: readonly ItemWorkflowStage[],
): ItemRow[] {
  const stage = releasedStage(stages)
  const releasedName = stage ? stage.label || stage.name : t('releases.itemReleasedState')
  const releasedColor = stage?.color ?? null

  return rows.map((row) => {
    const fileId = row.primaryFileId
    const released = fileId ? releasesByFile.get(fileId)?.[0] : undefined
    if (!fileId || !released) return row.release ? { ...row, release: null } : row

    const latestVersion = row.files.find((f) => f.id === fileId)?.version ?? released.version
    const wip =
      latestVersion > released.version
        ? { version: latestVersion, revision: row.revision, stateName: row.workflowStateName }
        : null

    return {
      ...row,
      revision: released.revision ?? row.revision,
      // The latest version is the released one: its current state says it (Released, Obsolete).
      // A newer version in work: the item still shows as released, the work is secondary.
      workflowStateName: wip ? releasedName : row.workflowStateName,
      workflowStateColor: wip ? releasedColor : row.workflowStateColor,
      release: {
        fileVersionId: released.fileVersionId,
        version: released.version,
        revision: released.revision,
        forced: released.forced,
        wip,
      },
    }
  })
}

/**
 * Which files need their releases (re)read: every primary file whose version or state changed
 * since it was last read, so a release or a new check-in is picked up without rereading the rest.
 */
export function releaseFetchPlan(
  primaries: ReadonlyArray<{ fileId: string; signature: string }>,
  loaded: ReadonlyMap<string, string>,
): string[] {
  const ids: string[] = []
  const seen = new Set<string>()
  for (const { fileId, signature } of primaries) {
    if (seen.has(fileId)) continue
    seen.add(fileId)
    if (loaded.get(fileId) !== signature) ids.push(fileId)
  }
  return ids
}
