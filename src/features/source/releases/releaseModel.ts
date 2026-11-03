/**
 * Released versions in the workflow UI (5.9.0, schema 509): pure decisions shared by Change State,
 * version history and the History view. Plan: `.cursor/plans/release-versions-5.9.plan.md`.
 *
 * - The release gate refuses a drawing version without an approved review with
 *   `RELEASE_NOT_REVIEWED`; the caller asks once for a reason and forces the refused files.
 * - A forced release is shown as such everywhere, with its reason.
 */
import { t } from '@/lib/i18n'
import { RELEASE_NOT_REVIEWED, type VersionRelease } from '@/types/releases'

/** The legacy state names `file_get_legacy_state()` maps workflow state names to. */
export type LegacyState = 'not_tracked' | 'wip' | 'in_review' | 'released' | 'obsolete'

/** The same mapping as SQL `file_get_legacy_state()` (module 10). */
export function legacyStateOf(stateName: string | null | undefined): LegacyState | null {
  const name = (stateName ?? '').trim().replace(/\s+/g, '_').toLowerCase()
  switch (name) {
    case 'not_tracked':
      return 'not_tracked'
    case 'wip':
    case 'work_in_progress':
    case 'draft':
      return 'wip'
    case 'in_review':
    case 'review':
      return 'in_review'
    case 'released':
      return 'released'
    case 'obsolete':
    case 'archived':
      return 'obsolete'
    default:
      return null
  }
}

/** Whether the release gate applies to this file: drawings only (`.slddrw`). */
export function isDrawingName(nameOrPath: string | null | undefined): boolean {
  return (nameOrPath ?? '').toLowerCase().endsWith('.slddrw')
}

/** Whether a transition result is the release gate's refusal. */
export function isReleaseRefusal(errorCode: string | null | undefined): boolean {
  return errorCode === RELEASE_NOT_REVIEWED
}

/**
 * The one transition out of the current state into a state of the legacy name, as
 * `workflow_transition_execute_to_legacy_state()` picks it. Null when there is none or more than
 * one: forcing then has nothing unambiguous to force.
 */
export function pickTransitionToLegacyState(
  transitions: ReadonlyArray<{ transition_id: string; to_state_name: string }>,
  target: LegacyState,
): string | null {
  const matches = transitions.filter((tr) => legacyStateOf(tr.to_state_name) === target)
  return matches.length === 1 ? matches[0].transition_id : null
}

/** One file's answer from a bulk state change. */
export interface BulkStateOutcome<F> {
  file: F
  status: 'ok' | 'review' | 'failed'
  errorCode?: string | null
}

/** The files of a bulk state change the release gate refused: the ones to ask about and force. */
export function refusedReleases<F>(outcomes: ReadonlyArray<BulkStateOutcome<F>>): F[] {
  return outcomes.filter((o) => o.status === 'failed' && isReleaseRefusal(o.errorCode)).map((o) => o.file)
}

/** A forced-release reason as the database stores it: trimmed; empty means none was given. */
export function normalizeReason(reason: string): string | null {
  const trimmed = reason.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * The release columns of a `file_version` row read with `select('*')` (version history), or null
 * when the version is not released or the database is older than 509 (no such columns).
 */
export function releaseOfVersionRow(row: Record<string, unknown>): VersionRelease | null {
  const releasedAt = row.released_at
  if (typeof releasedAt !== 'string' || releasedAt.length === 0) return null
  const text = (key: string) => (typeof row[key] === 'string' ? (row[key] as string) : null)
  return {
    fileId: text('file_id') ?? '',
    fileVersionId: text('id') ?? '',
    version: typeof row.version === 'number' ? row.version : 0,
    revision: text('revision'),
    releasedAt,
    releasedBy: text('released_by'),
    forced: row.release_forced === true,
    reviewId: text('release_review_id'),
    note: text('release_note'),
  }
}

export interface ReleaseBadge {
  label: string
  title: string
  forced: boolean
}

/** The version history badge of a released version: "Released", or "Released (forced)" + reason. */
export function releaseBadge(release: VersionRelease, formatDate: (iso: string) => string): ReleaseBadge {
  const date = formatDate(release.releasedAt)
  if (!release.forced) {
    return { label: t('releases.badgeReleased'), title: t('releases.badgeTitle', { date }), forced: false }
  }
  const reason = release.note?.trim()
  return {
    label: t('releases.badgeReleasedForced'),
    title: reason
      ? t('releases.badgeTitleForced', { date, reason })
      : t('releases.badgeTitleForcedNoReason', { date }),
    forced: true,
  }
}

/** A forced release as the History view shows it (`activity.details.forced_release`). */
export interface ForcedReleaseActivity {
  version: number | null
  revision: string | null
  reason: string | null
}

/** The forced release an activity row records, or null when it records none. */
export function forcedReleaseOfActivity(details: unknown): ForcedReleaseActivity | null {
  if (typeof details !== 'object' || details === null) return null
  const d = details as Record<string, unknown>
  if (d.forced_release !== true) return null
  const parsed = typeof d.version === 'string' && d.version.trim() !== '' ? Number(d.version) : NaN
  const version = typeof d.version === 'number' ? d.version : Number.isFinite(parsed) ? parsed : null
  const revision = typeof d.revision === 'string' && d.revision.length > 0 ? d.revision : null
  const reasonValue = [d.reason, d.note, d.comment].find((v) => typeof v === 'string' && v.trim().length > 0)
  return { version, revision, reason: typeof reasonValue === 'string' ? reasonValue.trim() : null }
}

/** The file name an activity row carries in its details, when the file row is not joined. */
export function activityFileName(details: unknown): string | null {
  if (typeof details !== 'object' || details === null) return null
  const name = (details as Record<string, unknown>).file_name
  return typeof name === 'string' && name.length > 0 ? name : null
}
