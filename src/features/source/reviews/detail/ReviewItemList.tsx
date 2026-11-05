/**
 * The review's files, grouped by what they need (`groupItems`): To review (what the viewer owes),
 * Needs changes, Waiting on others, Decided. Each row says its version, outcome in words, open
 * comments, a newer version or deletion, a decision being sent, or a release; the row's "…" offers
 * Show in vault and Check out, the way from "what to fix" to fixing it (review UX audit F5).
 */


import { FileKindIcon, ListRow, MetaLine, OverflowMenu, StatusText } from '@/components/core/ui'
import { useFileDisplayName } from '@/hooks/useFileDisplayName'
import { t } from '@/lib/i18n'
import type { VersionRelease } from '@/lib/supabase/reviewExtras'
import type { ReviewDecision, ReviewItemDetail, ReviewItemOutcome } from '@/types/reviews'

import {
  commentCountFor,
  newerVersion,
  type ItemCommentCount,
  type ItemGroup,
} from '../lib/reviewProgress'
import type { PendingDecision } from '../lib/pendingDecisions'
import { canCheckOutHere, checkOutFile, showFileInVault } from './itemActions'

const OUTCOME_TONE: Record<ReviewItemOutcome, string> = {
  pending: 'text-ui-fg-secondary',
  approved: 'text-ui-success',
  changes_requested: 'text-ui-warning',
  rejected: 'text-ui-danger',
}

interface ReviewItemListProps {
  groups: ItemGroup[]
  activeItemId: string | null
  counts: ReadonlyMap<string, ItemCommentCount>
  releases: ReadonlyMap<string, VersionRelease>
  /** Decisions in the undo window or in flight, by item. */
  pendingByItem: ReadonlyMap<string, PendingDecision['decision']>
  /** The author's view: show "v6 checked in" / "no newer version yet" on files that came back. */
  authorView: boolean
  /** The viewer's own decision this round, by item ("You: Changes requested"). */
  myDecisions: ReadonlyMap<string, ReviewDecision>
  onSelect: (itemId: string) => void
}

function ItemRow({
  item,
  active,
  count,
  release,
  pending,
  authorView,
  mine,
  onSelect,
}: {
  item: ReviewItemDetail
  active: boolean
  count: ItemCommentCount
  release: VersionRelease | undefined
  pending: PendingDecision['decision'] | undefined
  authorView: boolean
  mine: ReviewDecision | undefined
  onSelect: () => void
}) {
  const displayName = useFileDisplayName()
  const fileName = displayName(item.file.fileName)
  const newer = newerVersion(item)
  const failing = item.outcome === 'changes_requested' || item.outcome === 'rejected'
  const parts: React.ReactNode[] = [
    <span key="v">{t('reviewDetail.items.version', { version: item.version.version })}</span>,
  ]
  if (item.version.revision)
    parts.push(<span key="r">{t('reviewQueue.rev', { revision: item.version.revision })}</span>)
  parts.push(
    <span key="o" className={OUTCOME_TONE[item.outcome]}>
      {t(`reviewDetail.itemOutcome.${item.outcome}`)}
    </span>,
  )
  if (mine && !pending)
    parts.push(
      <span key="m" className="text-ui-fg">
        {t('reviewDetail.items.yours', { decision: t(`reviewDetail.sent.${mine}`) })}
      </span>,
    )
  if (count.open > 0)
    parts.push(
      <span key="c">
        {count.open === 1
          ? t('reviewDetail.items.commentOne')
          : t('reviewDetail.items.comments', { count: count.open })}
      </span>,
    )

  const actions = [
    {
      id: 'show',
      label: t('reviewDetail.items.showInVault'),
      onSelect: () => showFileInVault(item.fileId),
    },
    ...(canCheckOutHere(item.fileId)
      ? [
          {
            id: 'checkout',
            label: t('reviewDetail.items.checkOut'),
            onSelect: () => void checkOutFile(item.fileId),
          },
        ]
      : []),
  ]

  return (
    <ListRow
      role="option"
      shape="rounded"
      tabIndex={active ? 0 : -1}
      id={`review-item-${item.id}`}
      selected={active}
      onActivate={onSelect}
      hint={item.file.filePath}
      leading={<FileKindIcon extension={item.file.extension} />}
      title={fileName}
      secondary={<MetaLine parts={parts} />}
      actions={
        <OverflowMenu
          size="sm"
          label={t('reviewDetail.items.actions', { file: fileName })}
          items={actions}
        />
      }
    >
      {pending && (
        <StatusText tone="accent">
          {t('reviewDetail.items.sending', { decision: t(`reviewDetail.sent.${pending}`) })}
        </StatusText>
      )}
      {release && (
        <StatusText tone="success">
          {release.revision
            ? t('reviewDetail.items.released', { revision: release.revision })
            : t('reviewDetail.items.releasedPlain')}
        </StatusText>
      )}
      {item.file.deleted && (
        <StatusText tone="danger">{t('reviewDetail.items.deleted')}</StatusText>
      )}
      {!item.file.deleted && authorView && failing && (
        <StatusText tone={newer ? 'success' : 'warning'}>
          {newer
            ? t('reviewDetail.items.newerExists', { version: newer })
            : t('reviewDetail.items.noNewer')}
        </StatusText>
      )}
      {!item.file.deleted && !(authorView && failing) && newer && (
        <span className="text-[12px] text-ui-fg-secondary">
          {t('reviewDetail.items.newerExists', { version: newer })}
        </span>
      )}
    </ListRow>
  )
}

export function ReviewItemList({
  groups,
  activeItemId,
  counts,
  releases,
  pendingByItem,
  authorView,
  myDecisions,
  onSelect,
}: ReviewItemListProps) {
  return (
    <div role="listbox" aria-label={t('reviewDetail.items.label')} className="pb-2">
      {groups.map((group) => (
        <div
          key={group.kind}
          role="group"
          aria-label={t(`reviewDetail.group.${group.kind}`, { count: group.items.length })}
        >
          <div className="px-3 pb-1 pt-4 text-[13px] text-ui-fg-tertiary">
            {t(`reviewDetail.group.${group.kind}`, { count: group.items.length })}
          </div>
          <div className="space-y-px px-1.5">
            {group.items.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                active={item.id === activeItemId}
                count={commentCountFor(counts, item.id)}
                release={releases.get(item.version.fileVersionId)}
                pending={pendingByItem.get(item.id)}
                mine={myDecisions.get(item.id)}
                authorView={authorView}
                onSelect={() => onSelect(item.id)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
