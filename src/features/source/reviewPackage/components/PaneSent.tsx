/**
 * The review pane after a review was requested: what went to whom, who was left out, and the two
 * ways on (open the review, or start another). It stays until dismissed or until files are added.
 */

import { Button, Section, StatusText } from '@/components/core/ui'
import { t } from '@/lib/i18n'
import { usePDMStore } from '@/stores/pdmStore'
import type { ReviewPackageSent } from '@/stores/slices/reviewsSlice'
import type { OrgUser } from '@/types/database'

import { userLabel } from '../lib/reviewerSearch'

export function PaneSent({ sent, users }: { sent: ReviewPackageSent; users: OrgUser[] }) {
  const byId = new Map(users.map((u) => [u.id, u]))
  const leftOut = sent.skipped.map((s) => {
    const user = byId.get(s.userId)
    return t('reviewBuilder.sent.leftOutEntry', {
      name: user ? userLabel(user) : t('reviewBuilder.reviewers.unknownUser'),
      reason: t(`reviewBuilder.sent.reason_${s.reason}`),
    })
  })

  const dismiss = () => usePDMStore.getState().setReviewPackageLastSent(null)

  return (
    <Section
      density="compact"
      title={t('reviewBuilder.sent.title')}
      description={t('reviewBuilder.sent.body', {
        title: sent.title,
        people: sent.reviewerCount,
        items: sent.itemCount,
      })}
    >
      {leftOut.length > 0 && (
        <div className="pt-2">
          <StatusText tone="warning">{t('reviewBuilder.sent.leftOut', { names: leftOut.join(', ') })}</StatusText>
        </div>
      )}
      <div className="flex flex-wrap gap-2 pt-4">
        <Button
          size="sm"
          variant="primary"
          onClick={() => {
            dismiss()
            usePDMStore.getState().openReview(sent.reviewId)
          }}
        >
          {t('reviewBuilder.sent.open')}
        </Button>
        <Button size="sm" variant="secondary" onClick={dismiss}>
          {t('reviewBuilder.sent.another')}
        </Button>
      </div>
    </Section>
  )
}
