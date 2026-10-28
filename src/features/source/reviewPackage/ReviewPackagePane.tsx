/**
 * The review package builder, shown in the right panel while a draft is being built.
 *
 * The draft lives in the `reviews` store slice (persisted per user), so the pane can close and the
 * user can keep browsing and adding files from context menus or version history. Submit sends the
 * pinned `file_versions` ids with `requestReview`; the server validates versions, expands teams
 * and writes notifications in one transaction.
 */

import { useMemo, useState } from 'react'
import { FilePlus2, Loader2, PackageOpen, Send, Trash2, X } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'

import { describeReviewError } from '@/features/source/reviews/lib/reviewErrors'
import { executeCommand } from '@/lib/commands'
import { t } from '@/lib/i18n'
import { log } from '@/lib/logger'
import { requestReview } from '@/lib/supabase/reviews'
import { usePDMStore } from '@/stores/pdmStore'
import { draftBlocker } from '@/stores/slices/reviewsDraft'
import { selectReviewPackageDraft } from '@/stores/slices/reviewsSlice'
import type { LocalFile } from '@/stores/types'

import { PackageItemRow } from './components/PackageItemRow'
import { PackageMetaFields } from './components/PackageMetaFields'
import { ReviewerPicker } from './components/ReviewerPicker'
import { usePackageItemInfo } from './hooks/usePackageItemInfo'
import { useReviewerDirectory } from './hooks/useReviewerDirectory'
import { localCopyWarnings } from './lib/localCopy'

const SECTION = 'text-[11px] font-semibold uppercase tracking-wide text-plm-fg-muted'

export function ReviewPackagePane() {
  const draft = usePDMStore(selectReviewPackageDraft)
  const { user, organization, files, addToast } = usePDMStore(
    useShallow((s) => ({
      user: s.user,
      organization: s.organization,
      files: s.files,
      addToast: s.addToast,
    })),
  )
  const actions = usePDMStore(
    useShallow((s) => ({
      removeItem: s.removeReviewPackageItem,
      toggleReviewer: s.toggleReviewPackageReviewer,
      toggleTeam: s.toggleReviewPackageTeam,
      update: s.updateReviewPackageDraft,
      clear: s.clearReviewPackageDraft,
      setPaneOpen: s.setReviewPackagePaneOpen,
      refreshQueue: s.requestReviewQueueRefresh,
    })),
  )

  const directory = useReviewerDirectory(organization?.id)
  const { info, refreshPdfStatus } = usePackageItemInfo(draft.items)
  const [submitting, setSubmitting] = useState(false)
  const [generating, setGenerating] = useState(false)

  const localByFileId = useMemo(() => {
    const ids = new Set(draft.items.map((i) => i.fileId))
    const map = new Map<string, LocalFile>()
    if (ids.size === 0) return map
    for (const f of files) {
      const id = f.pdmData?.id
      if (id && ids.has(id) && f.diffStatus !== 'moved_away') map.set(id, f)
    }
    return map
  }, [files, draft.items])

  const missingPdfItems = draft.items.filter((i) => info[i.fileVersionId]?.pdf === 'missing')
  const blocker = draftBlocker(draft)

  const handleGeneratePdfs = async () => {
    if (missingPdfItems.length === 0) return
    setGenerating(true)
    try {
      await executeCommand('generate-review-pdfs', {
        fileVersionIds: missingPdfItems.map((i) => i.fileVersionId),
      })
      await refreshPdfStatus(missingPdfItems)
    } finally {
      setGenerating(false)
    }
  }

  const handleSubmit = async () => {
    if (blocker || submitting) return
    setSubmitting(true)
    try {
      const result = await requestReview({
        fileVersionIds: draft.items.map((i) => i.fileVersionId),
        reviewerIds: draft.reviewerIds,
        teamIds: draft.teamIds,
        title: draft.title,
        message: draft.message,
        mode: draft.mode,
        priority: draft.priority,
        dueDate: draft.dueDate,
      })
      addToast(
        'success',
        t('reviewBuilder.toast.sent', { items: result.itemCount, count: result.reviewerIds.length }),
      )
      if (result.skipped.length > 0) {
        addToast('warning', t('reviewBuilder.toast.skipped', { count: result.skipped.length }))
      }
      actions.clear()
      actions.setPaneOpen(false)
      actions.refreshQueue()
    } catch (error) {
      log.warn('[ReviewPackage]', 'Requesting the review failed', { error })
      addToast('error', describeReviewError(error))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-plm-border flex-shrink-0">
        <PackageOpen size={14} className="text-plm-accent" />
        <span className="text-sm font-medium text-plm-fg">{t('reviewBuilder.title')}</span>
        <span className="text-[11px] text-plm-fg-muted">
          {t('reviewBuilder.itemCount', { count: draft.items.length })}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {draft.items.length > 0 && (
            <button
              type="button"
              onClick={() => actions.clear()}
              className="p-1 rounded text-plm-fg-muted hover:text-plm-error hover:bg-plm-highlight"
              title={t('reviewBuilder.clear')}
            >
              <Trash2 size={14} />
            </button>
          )}
          <button
            type="button"
            onClick={() => actions.setPaneOpen(false)}
            className="p-1 rounded text-plm-fg-muted hover:text-plm-fg hover:bg-plm-highlight"
            title={t('reviewBuilder.close')}
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* Items */}
        <section className="space-y-1.5">
          <div className="flex items-center gap-2">
            <h3 className={SECTION}>{t('reviewBuilder.items')}</h3>
            {missingPdfItems.length > 0 && (
              <button
                type="button"
                onClick={() => void handleGeneratePdfs()}
                disabled={generating}
                className="ml-auto flex items-center gap-1 px-2 py-0.5 text-[11px] rounded bg-plm-accent/15 text-plm-accent hover:bg-plm-accent/25 disabled:opacity-50"
                title={t('reviewBuilder.generatePdfsHint')}
              >
                {generating ? <Loader2 size={11} className="animate-spin" /> : <FilePlus2 size={11} />}
                {t('reviewBuilder.generatePdfs', { count: missingPdfItems.length })}
              </button>
            )}
          </div>
          {draft.items.length === 0 ? (
            <p className="text-xs text-plm-fg-muted">{t('reviewBuilder.empty')}</p>
          ) : (
            draft.items.map((item) => (
              <PackageItemRow
                key={item.fileId}
                item={item}
                info={info[item.fileVersionId]}
                warnings={localCopyWarnings(
                  localByFileId.get(item.fileId),
                  user?.id ?? null,
                  item.version,
                  item.latestVersion,
                )}
                onRemove={actions.removeItem}
              />
            ))
          )}
        </section>

        {/* Reviewers */}
        <section className="space-y-1.5">
          <h3 className={SECTION}>{t('reviewBuilder.reviewers.title')}</h3>
          <ReviewerPicker
            users={directory.users}
            teams={directory.teams}
            loading={directory.loading}
            requesterId={user?.id ?? null}
            reviewerIds={draft.reviewerIds}
            teamIds={draft.teamIds}
            onToggleReviewer={actions.toggleReviewer}
            onToggleTeam={actions.toggleTeam}
          />
        </section>

        {/* Details */}
        <section className="space-y-1.5">
          <h3 className={SECTION}>{t('reviewBuilder.details')}</h3>
          <PackageMetaFields draft={draft} onChange={actions.update} />
        </section>
      </div>

      {/* Submit */}
      <div className="px-3 py-2 border-t border-plm-border flex-shrink-0 space-y-1">
        {blocker && (
          <p className="text-[11px] text-plm-fg-muted">{t(`reviewBuilder.blocker.${blocker}`)}</p>
        )}
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={!!blocker || submitting}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm rounded bg-plm-accent text-white hover:bg-plm-accent/90 disabled:opacity-50"
        >
          {submitting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          {t('reviewBuilder.submit')}
        </button>
      </div>
    </div>
  )
}
