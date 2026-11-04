/**
 * The Activity tab beside the drawing: the selected file's history in this review, newest first.
 * Each round starts with who opened it and the author's "what changed" note (review UX audit F2,
 * which the old UI sent but never showed), then each reviewer's decision with its comment.
 * Selecting a round shows that round's comments on the version it reviewed.
 */

import { Button } from '@/components/core/ui'
import { t } from '@/lib/i18n'
import type { ReviewDetail, ReviewItemDetail, ReviewUser } from '@/types/reviews'

import { relativeTime } from '../lib/reviewDates'
import { displayName } from '../lib/reviewState'

const DECISION_TONE: Record<string, string> = {
  approved: 'text-ui-success',
  approved_with_comments: 'text-ui-success',
  changes_requested: 'text-ui-warning',
  rejected: 'text-ui-danger',
}

interface ActivityPanelProps {
  detail: ReviewDetail
  item: ReviewItemDetail
  usersById: ReadonlyMap<string, ReviewUser>
  shownRound: number
  onShowRound: (round: number) => void
}

export function ActivityPanel({
  detail,
  item,
  usersById,
  shownRound,
  onShowRound,
}: ActivityPanelProps) {
  const rounds = [...item.rounds].sort((a, b) => b.roundNumber - a.roundNumber)
  const name = (id: string | null) =>
    displayName(id ? usersById.get(id) : null) ?? t('reviewDetail.unknownUser')

  return (
    <div className="h-full overflow-y-auto pb-4">
      {rounds.length === 0 && (
        <p className="px-3 py-3 text-[13px] text-ui-fg-secondary">
          {t('reviewDetail.activity.none')}
        </p>
      )}
      {rounds.map((round) => {
        const meta = detail.rounds.find((r) => r.roundNumber === round.roundNumber)
        const showing = round.roundNumber === shownRound
        return (
          <section key={round.roundNumber} className="border-b border-ui-divider px-3 py-3">
            <div className="flex items-center gap-2">
              <h4 className="text-[13px] font-semibold text-ui-fg">
                {round.version != null
                  ? t('reviewDetail.activity.roundHeader', {
                      round: round.roundNumber,
                      version: round.version,
                    })
                  : t('reviewDetail.activity.roundHeaderPlain', { round: round.roundNumber })}
              </h4>
              <span className="ml-auto">
                {showing ? (
                  <span className="text-[12px] text-ui-fg-tertiary">
                    {t('reviewDetail.activity.showing')}
                  </span>
                ) : (
                  !round.carriedForward && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onShowRound(round.roundNumber)}
                    >
                      {t('reviewDetail.activity.showRound')}
                    </Button>
                  )
                )}
              </span>
            </div>
            {meta && (
              <p className="mt-0.5 text-[12px] text-ui-fg-secondary">
                {meta.openedBy
                  ? t('reviewDetail.activity.opened', {
                      name: name(meta.openedBy),
                      time: relativeTime(meta.openedAt),
                    })
                  : t('reviewDetail.activity.openedPlain', { time: relativeTime(meta.openedAt) })}
              </p>
            )}
            {meta?.note && (
              <div className="mt-2">
                <div className="text-[12px] text-ui-fg-tertiary">
                  {t('reviewDetail.activity.note')}
                </div>
                <p className="mt-0.5 whitespace-pre-wrap border-l-2 border-ui-border pl-2 text-[13px] text-ui-fg">
                  {meta.note}
                </p>
              </div>
            )}
            {round.roundNumber === 1 && detail.review.message && (
              <div className="mt-2">
                <div className="text-[12px] text-ui-fg-tertiary">
                  {t('reviewDetail.activity.message')}
                </div>
                <p className="mt-0.5 whitespace-pre-wrap border-l-2 border-ui-border pl-2 text-[13px] text-ui-fg">
                  {detail.review.message}
                </p>
              </div>
            )}

            <div className="mt-2 space-y-2">
              {round.carriedForward ? (
                <p className="text-[13px] text-ui-fg-secondary">
                  {t('reviewDetail.activity.carried')}
                </p>
              ) : round.decisions.length === 0 ? (
                <p className="text-[13px] text-ui-fg-secondary">
                  {t('reviewDetail.activity.waiting')}
                </p>
              ) : (
                [...round.decisions]
                  .sort((a, b) => b.decidedAt.localeCompare(a.decidedAt))
                  .map((d) => (
                    <div key={`${d.reviewerId}-${d.decidedAt}`} className="text-[13px]">
                      <div>
                        <span className="text-ui-fg">{name(d.reviewerId)}</span>{' '}
                        <span className={DECISION_TONE[d.decision] ?? 'text-ui-fg-secondary'}>
                          {t(`reviewDetail.decided.${d.decision}`)}
                        </span>
                        <span className="text-ui-fg-secondary"> · {relativeTime(d.decidedAt)}</span>
                      </div>
                      {d.comment && (
                        <p className="mt-0.5 whitespace-pre-wrap border-l-2 border-ui-border pl-2 text-ui-fg-secondary">
                          {d.comment}
                        </p>
                      )}
                    </div>
                  ))
              )}
            </div>
          </section>
        )
      })}
      {detail.review.requestedAt && (
        <p className="px-3 py-3 text-[12px] text-ui-fg-tertiary">
          {t('reviewDetail.activity.requested', {
            name: displayName(detail.review.requestedBy) ?? t('reviewDetail.unknownUser'),
            time: relativeTime(detail.review.requestedAt),
          })}
        </p>
      )}
    </div>
  )
}
