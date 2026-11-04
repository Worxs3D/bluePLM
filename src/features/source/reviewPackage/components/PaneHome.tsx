/**
 * The review pane with no draft: start a review from the vault selection, and the first few
 * reviews waiting on the user and of their own requests. It fills the right-hand slot wherever
 * nothing else would (explorer with no file tabs, Reviews with no review open, Workflows,
 * extension workspaces), so every part of it works without a file selection.
 */

import { Badge, Button, ListRow, MetaLine, Row, RowGroup, Section } from '@/components/core/ui'
import { localDateString } from '@/features/source/reviews/lib/queueChips'
import {
  describeNextMove,
  displayName,
  nextMoveForRow,
  nextMoveTone,
  type NextMoveTone,
} from '@/features/source/reviews/lib/reviewState'
import { displayFileName } from '@/hooks/useFileDisplayName'
import { t } from '@/lib/i18n'
import { usePDMStore } from '@/stores/pdmStore'
import type { LocalFile } from '@/stores/types'
import type { ReviewQueueBucket, ReviewQueueRow } from '@/types/reviews'

import { addFilesToReviewPackage } from '../addToPackage'
import { usePaneQueue } from '../hooks/usePaneQueue'
import { dueText, PANE_LIST_ROWS, rowDue, sortRequestsForPane } from '../lib/paneLists'

const TONE_CLASS: Record<NextMoveTone, string> = {
  strong: 'text-ui-fg',
  neutral: 'text-ui-fg-secondary',
  warning: 'text-ui-warning',
  danger: 'text-ui-danger',
  success: 'text-ui-success',
}

function QueueRow({
  row,
  bucket,
  userId,
  today,
}: {
  row: ReviewQueueRow
  bucket: ReviewQueueBucket
  userId: string | null
  today: string
}) {
  const move = nextMoveForRow(row, userId, bucket)
  const requester = bucket === 'awaiting_me' ? displayName(row.requestedBy) : null
  const chip = rowDue(row, today)
  const due = dueText(chip)
  const title =
    row.kind === 'gate' && row.gate ? displayFileName(row.gate.fileName) : row.title

  const open = () => {
    const s = usePDMStore.getState()
    if (row.kind === 'gate') {
      s.setActiveGateReviewId(row.id)
      if (s.activeView !== 'reviews') s.setActiveView('reviews')
    } else {
      s.openReview(row.id)
    }
  }

  return (
    <ListRow
      title={title}
      onActivate={open}
      trailing={
        due ? (
          chip?.tone === 'overdue' ? (
            <Badge tone="error">{due}</Badge>
          ) : (
            <span className={chip?.tone === 'later' ? '' : 'text-ui-warning'}>{due}</span>
          )
        ) : undefined
      }
      secondary={
        <MetaLine
          parts={[
            <span key="move" className={TONE_CLASS[nextMoveTone(move)]}>
              {describeNextMove(move)}
            </span>,
            requester,
          ]}
        />
      }
    />
  )
}

function ListSection({
  title,
  bucket,
  rows,
  more,
  total,
  loading,
  emptyText,
  userId,
}: {
  title: string
  bucket: ReviewQueueBucket
  rows: ReviewQueueRow[]
  more: boolean
  total: number | null
  loading: boolean
  emptyText: string
  userId: string | null
}) {
  const today = localDateString()
  const seeAll = () => {
    const s = usePDMStore.getState()
    s.setReviewQueueView({ bucket, teamId: null, search: '' })
    if (s.activeView !== 'reviews') s.setActiveView('reviews')
  }
  return (
    <Section
      density="compact"
      title={title}
      actions={
        rows.length > 0 && (more || total !== null) ? (
          <Button size="sm" variant="ghost" className="-mr-2" onClick={seeAll}>
            {total !== null && total > rows.length
              ? t('reviewBuilder.pane.seeAllCount', { count: total })
              : t('reviewBuilder.pane.seeAll')}
          </Button>
        ) : undefined
      }
    >
      {loading && rows.length === 0 ? (
        <p className="py-2 text-[13px] text-ui-fg-secondary">{t('reviewBuilder.pane.loading')}</p>
      ) : rows.length === 0 ? (
        <p className="py-2 text-[13px] text-ui-fg-secondary">{emptyText}</p>
      ) : (
        <RowGroup className="-mx-3">
          {rows.map((row) => (
            <QueueRow key={`${row.kind}-${row.id}`} row={row} bucket={bucket} userId={userId} today={today} />
          ))}
        </RowGroup>
      )}
    </Section>
  )
}

export function PaneHome({ selection }: { selection: LocalFile[] }) {
  const userId = usePDMStore((s) => s.user?.id ?? null)
  const pendingReviewCount = usePDMStore((s) => s.pendingReviewCount)
  const queue = usePaneQueue(true)

  const requests = sortRequestsForPane(queue.requested, userId).slice(0, PANE_LIST_ROWS)
  const nothingAtAll =
    !queue.loading && !queue.error && queue.awaiting.length === 0 && queue.requested.length === 0

  return (
    <div className="space-y-7">
      <Section density="compact" title={t('reviewBuilder.pane.startTitle')}>
        {selection.length > 0 ? (
          <Row
            density="compact"
            label={
              selection.length === 1
                ? t('reviewBuilder.pane.selectionOne')
                : t('reviewBuilder.pane.selection', { count: selection.length })
            }
          >
            <Button size="sm" variant="primary" onClick={() => void addFilesToReviewPackage(selection)}>
              {t('reviewBuilder.pane.start')}
            </Button>
          </Row>
        ) : (
          <p className="pt-1 text-[13px] leading-[1.45] text-ui-fg-secondary">
            {t('reviewBuilder.pane.startHint')}
          </p>
        )}
      </Section>

      {queue.error ? (
        <Row density="compact" label={t('reviewBuilder.pane.loadFailed')} description={queue.error}>
          <Button size="sm" variant="ghost" onClick={queue.reload}>
            {t('reviewBuilder.pane.retry')}
          </Button>
        </Row>
      ) : nothingAtAll ? (
        <p className="text-[13px] leading-[1.45] text-ui-fg-secondary">{t('reviewBuilder.pane.nothing')}</p>
      ) : (
        <>
          <ListSection
            title={t('reviewBuilder.pane.waitingTitle')}
            bucket="awaiting_me"
            rows={queue.awaiting}
            more={queue.awaitingMore}
            total={pendingReviewCount > 0 ? pendingReviewCount : null}
            loading={queue.loading}
            emptyText={t('reviewBuilder.pane.nothingWaiting')}
            userId={userId}
          />
          <ListSection
            title={t('reviewBuilder.pane.requestsTitle')}
            bucket="requested_by_me"
            rows={requests}
            more={queue.requestedMore}
            total={null}
            loading={queue.loading}
            emptyText={t('reviewBuilder.pane.noRequests')}
            userId={userId}
          />
        </>
      )}
    </div>
  )
}
