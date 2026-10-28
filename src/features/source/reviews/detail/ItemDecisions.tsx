/**
 * Every reviewer's decision on the current item, round by round (newest first). Earlier rounds
 * are history: shown, never edited. Picking a round shows that round's markups.
 */

import { formatDistanceToNow } from 'date-fns'

import { t } from '@/lib/i18n'
import type { ReviewItemDetail, ReviewUser } from '@/types/reviews'

const DECISION_CLASS: Record<string, string> = {
  approved: 'text-plm-success',
  approved_with_comments: 'text-plm-success',
  changes_requested: 'text-plm-warning',
  rejected: 'text-plm-error',
}

interface ItemDecisionsProps {
  item: ReviewItemDetail
  usersById: ReadonlyMap<string, ReviewUser>
  currentRound: number
  markupRound: number
  onShowRound: (round: number) => void
}

export function ItemDecisions({
  item,
  usersById,
  currentRound,
  markupRound,
  onShowRound,
}: ItemDecisionsProps) {
  const rounds = [...item.rounds].sort((a, b) => b.roundNumber - a.roundNumber)
  if (rounds.length === 0) {
    return <p className="px-2 py-2 text-[11px] text-plm-fg-muted">{t('reviewDetail.decisions.none')}</p>
  }
  return (
    <div className="space-y-2 px-2 py-2">
      {rounds.map((round) => (
        <div key={round.roundNumber} className="space-y-1">
          <div className="flex items-center gap-1.5 text-[10px] text-plm-fg-muted">
            <button
              type="button"
              onClick={() => onShowRound(round.roundNumber)}
              className={`font-semibold uppercase tracking-wide ${
                markupRound === round.roundNumber ? 'text-plm-accent' : 'hover:text-plm-fg'
              }`}
              title={t('reviewDetail.decisions.showMarkups')}
            >
              {t('reviewQueue.round', { round: round.roundNumber })}
            </button>
            {round.version != null && <span>v{round.version}</span>}
            {round.carriedForward && <span>{t('reviewDetail.decisions.carried')}</span>}
            {round.roundNumber < currentRound && <span>{t('reviewDetail.decisions.history')}</span>}
          </div>
          {round.decisions.length === 0 ? (
            <p className="text-[11px] text-plm-fg-muted">{t('reviewDetail.decisions.waiting')}</p>
          ) : (
            round.decisions.map((d) => {
              const who = usersById.get(d.reviewerId)
              return (
                <div key={`${d.reviewerId}-${d.decidedAt}`} className="text-[11px]">
                  <span className="text-plm-fg">{who?.fullName || who?.email || t('reviewDetail.unknownUser')}</span>{' '}
                  <span className={DECISION_CLASS[d.decision] ?? ''}>
                    {t(`reviewDetail.decision.${d.decision}`)}
                  </span>{' '}
                  <span className="text-plm-fg-muted">
                    {formatDistanceToNow(new Date(d.decidedAt), { addSuffix: true })}
                  </span>
                  {d.comment && (
                    <p className="mt-0.5 pl-2 border-l-2 border-plm-border text-plm-fg-muted whitespace-pre-wrap">
                      {d.comment}
                    </p>
                  )}
                </div>
              )
            })
          )}
        </div>
      ))}
    </div>
  )
}
