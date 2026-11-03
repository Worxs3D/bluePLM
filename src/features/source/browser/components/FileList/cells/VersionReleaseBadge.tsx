/**
 * Version history (schema 509): the Released badge of a released version, "Released (forced)"
 * with the reason in its tooltip for one released without an approved review, and the workflow
 * state the version was checked in at.
 */
import { format } from 'date-fns'

import { t } from '@/lib/i18n'
import { releaseBadge } from '@/features/source/releases/releaseModel'
import type { VersionRelease } from '@/types/releases'

interface VersionReleaseBadgeProps {
  release: VersionRelease | null
  /** The name of the workflow state the version was checked in at, when known. */
  stateName: string | null
}

const formatDate = (iso: string) => format(new Date(iso), 'MMM d, yyyy HH:mm')

export function VersionReleaseBadge({ release, stateName }: VersionReleaseBadgeProps) {
  const badge = release ? releaseBadge(release, formatDate) : null
  return (
    <>
      {badge && (
        <span
          className={`px-1 py-0.5 text-[10px] rounded ${
            badge.forced ? 'bg-plm-error/20 text-plm-error' : 'bg-plm-success/20 text-plm-success'
          }`}
          title={badge.title}
        >
          {badge.label}
        </span>
      )}
      {stateName && (
        <span className="text-[10px] text-plm-fg-muted" title={t('releases.checkedInAt', { state: stateName })}>
          {stateName}
        </span>
      )}
    </>
  )
}
