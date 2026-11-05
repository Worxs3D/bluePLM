/**
 * The review pane holding a draft: its files, reviewers and details, and the Request review
 * button. Submit sends the pinned `file_versions` ids with `requestReview`; the server validates
 * versions, expands teams and writes notifications in one transaction. While it runs every field
 * is disabled; a refusal shows above the button and the draft stays.
 */

import { useMemo, useState, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'

import { Button, Callout, RowGroup, Section } from '@/components/core/ui'
import { describeReviewError } from '@/features/source/reviews/lib/reviewErrors'
import { displayFileName } from '@/hooks/useFileDisplayName'
import { executeCommand } from '@/lib/commands'
import { t } from '@/lib/i18n'
import { log } from '@/lib/logger'
import { hasDesktop } from '@/lib/platform'
import { ReviewRpcError } from '@/lib/supabase/reviewMapping'
import { getLatestCheckedInVersions, requestReview } from '@/lib/supabase/reviews'
import { expandReviewerSelection } from '@/lib/supabase/reviewTeams'
import { usePDMStore } from '@/stores/pdmStore'
import { draftBlocker } from '@/stores/slices/reviewsDraft'
import type { LocalFile } from '@/stores/types'
import type { ReviewPackageDraft } from '@/types/reviewPackageDraft'

import { addFilesToReviewPackage } from '../addToPackage'
import { useDraftVaultGrants } from '../hooks/useDraftVaultGrants'
import { usePackageItemInfo } from '../hooks/usePackageItemInfo'
import type { ReviewerDirectory } from '../hooks/useReviewerDirectory'
import { localCopyWarnings } from '../lib/localCopy'
import { userLabel, usersWithoutVaultAccess } from '../lib/reviewerSearch'
import { PackageItemRow } from './PackageItemRow'
import { PackageMetaFields } from './PackageMetaFields'
import { ReviewerPicker } from './ReviewerPicker'

interface DraftViewProps {
  draft: ReviewPackageDraft
  directory: ReviewerDirectory
  /** Reviewable files selected in the vault (explorer only). */
  selection: LocalFile[]
  submitting: boolean
  setSubmitting: (busy: boolean) => void
}

export function DraftView({ draft, directory, selection, submitting, setSubmitting }: DraftViewProps) {
  const { userId, orgId, files, addToast } = usePDMStore(
    useShallow((s) => ({
      userId: s.user?.id ?? null,
      orgId: s.organization?.id ?? null,
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
      setLastSent: s.setReviewPackageLastSent,
      openReview: s.openReview,
      refreshQueue: s.requestReviewQueueRefresh,
    })),
  )
  const { info, refreshPdfStatus } = usePackageItemInfo(draft.items)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<unknown>(null)

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

  const inDraft = new Set(draft.items.map((i) => i.fileId))
  const notInDraft = selection.filter((f) => f.pdmData?.id && !inDraft.has(f.pdmData.id))
  const missingPdfItems = draft.items.filter((i) => info[i.fileVersionId]?.pdf === 'missing')
  const blocker = draftBlocker(draft)
  // People who cannot read a vault of the draft's files: the picker shows them unavailable, the
  // server would refuse them by name or skip them in a team.
  const draftVaultIds = useMemo(() => draft.items.map((i) => i.vaultId), [draft.items])
  const grants = useDraftVaultGrants(draftVaultIds)
  const noVaultAccessIds = useMemo(() => {
    if (!grants || directory.loading || directory.error) return new Set<string>()
    const people = new Set(directory.users.map((u) => u.id))
    for (const team of directory.teams) for (const m of team.members) people.add(m.id)
    return usersWithoutVaultAccess(
      [...people],
      draftVaultIds,
      { ...grants, adminIds: directory.adminIds },
      directory.teams,
    )
  }, [grants, directory.loading, directory.error, directory.users, directory.teams, directory.adminIds, draftVaultIds])
  const reach = expandReviewerSelection(
    { reviewerIds: draft.reviewerIds, teamIds: draft.teamIds },
    directory.teams,
    userId,
  ).userIds.filter((id) => !noVaultAccessIds.has(id)).length

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

  const submit = async () => {
    if (blocker || submitting) return
    setSubmitting(true)
    setError(null)
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
      // The title the field showed as its placeholder: the first file as the user sees it.
      const title =
        draft.title.trim() || (draft.items[0] ? displayFileName(draft.items[0].fileName) : '')
      addToast(
        'success',
        t('reviewBuilder.toast.sent', { items: result.itemCount, count: result.reviewerIds.length }),
        undefined,
        { label: t('reviewBuilder.toast.open'), onClick: () => actions.openReview(result.reviewId) },
      )
      actions.clear()
      actions.setLastSent({
        reviewId: result.reviewId,
        title,
        itemCount: result.itemCount,
        reviewerCount: result.reviewerIds.length,
        skipped: result.skipped,
      })
      actions.refreshQueue()
    } catch (err) {
      log.warn('[ReviewPackage]', 'Requesting the review failed', { error: err })
      setError(err)
    } finally {
      setSubmitting(false)
    }
  }

  /** Items whose pinned version is gone: the one the server named, else files with no version. */
  const removeMissing = async () => {
    const named = error instanceof ReviewRpcError ? error.subjectId : null
    let gone = draft.items.filter((i) => i.fileVersionId === named).map((i) => i.fileId)
    if (gone.length === 0) {
      try {
        const latest = new Set((await getLatestCheckedInVersions(draft.items.map((i) => i.fileId))).map((v) => v.fileId))
        gone = draft.items.filter((i) => !latest.has(i.fileId)).map((i) => i.fileId)
      } catch (err) {
        log.warn('[ReviewPackage]', 'Re-checking draft versions failed', { error: err })
      }
    }
    for (const id of gone) actions.removeItem(id)
    setError(null)
  }

  let errorAction: ReactNode = null
  let errorText = error ? describeReviewError(error) : ''
  if (error instanceof ReviewRpcError && error.code === 'VERSION_NOT_FOUND') {
    errorAction = (
      <Button size="sm" variant="secondary" onClick={() => void removeMissing()}>
        {t('reviewBuilder.error.removeMissing')}
      </Button>
    )
  } else if (error instanceof ReviewRpcError && error.code === 'REVIEWER_NO_VAULT_ACCESS' && error.subjectId) {
    const person = directory.users.find((u) => u.id === error.subjectId)
    if (person && draft.reviewerIds.includes(person.id)) {
      const name = userLabel(person)
      errorText = t('reviewBuilder.error.noAccessNamed', { name })
      errorAction = (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            actions.toggleReviewer(person.id)
            setError(null)
          }}
        >
          {t('reviewBuilder.error.removeReviewer', { name })}
        </Button>
      )
    }
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault()
          void submit()
        }
      }}
    >
      <div className="min-h-0 flex-1 space-y-7 overflow-y-auto px-4 pb-6 pt-4">
        <Section
          density="compact"
          title={t('reviewBuilder.items')}
          actions={
            submitting ? undefined : (
              <>
                {/* PDFs are made with SOLIDWORKS, which only the desktop app can drive. */}
                {missingPdfItems.length > 0 && hasDesktop() && (
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={generating}
                    title={t('reviewBuilder.generatePdfsHint')}
                    onClick={() => void handleGeneratePdfs()}
                  >
                    {missingPdfItems.length === 1
                      ? t('reviewBuilder.generatePdfsOne')
                      : t('reviewBuilder.generatePdfs', { count: missingPdfItems.length })}
                  </Button>
                )}
                {notInDraft.length > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    title={t('reviewBuilder.addSelectedHint')}
                    onClick={() => void addFilesToReviewPackage(notInDraft)}
                  >
                    {t('reviewBuilder.addSelected', { count: notInDraft.length })}
                  </Button>
                )}
              </>
            )
          }
        >
          <RowGroup className="-mx-3">
            {draft.items.map((item) => (
              <PackageItemRow
                key={item.fileId}
                item={item}
                info={info[item.fileVersionId]}
                warnings={localCopyWarnings(localByFileId.get(item.fileId), userId, item.version, item.latestVersion)}
                onRemove={submitting ? null : actions.removeItem}
              />
            ))}
          </RowGroup>
        </Section>

        <Section
          density="compact"
          title={t('reviewBuilder.reviewers.title')}
          description={
            reach === 0
              ? t('reviewBuilder.reviewers.reachesNone')
              : reach === 1
                ? t('reviewBuilder.reviewers.reachesOne')
                : t('reviewBuilder.reviewers.reaches', { count: reach })
          }
        >
          <ReviewerPicker
            // A search belongs to whoever typed it: another user or organization starts empty.
            key={`${userId ?? ''}:${orgId ?? ''}`}
            users={directory.users}
            teams={directory.teams}
            loading={directory.loading}
            error={directory.error}
            onRetry={directory.reload}
            requesterId={userId}
            reviewerIds={draft.reviewerIds}
            teamIds={draft.teamIds}
            onToggleReviewer={actions.toggleReviewer}
            onToggleTeam={actions.toggleTeam}
            noVaultAccessIds={noVaultAccessIds}
            disabled={submitting}
          />
        </Section>

        <Section density="compact" title={t('reviewBuilder.details')}>
          <PackageMetaFields draft={draft} onChange={actions.update} disabled={submitting} />
        </Section>
      </div>

      <div className="flex-shrink-0 space-y-2 border-t border-ui-border px-4 py-3">
        {error !== null && (
          <Callout tone="error" action={errorAction}>
            {errorText}
          </Callout>
        )}
        {blocker && !submitting && (
          <p className="text-[13px] text-ui-fg-secondary">{t(`reviewBuilder.blocker.${blocker}`)}</p>
        )}
        <Button
          variant="primary"
          className="w-full"
          loading={submitting}
          disabled={!!blocker}
          title={t('reviewBuilder.submitHint')}
          onClick={() => void submit()}
        >
          {submitting ? t('reviewBuilder.submitting') : t('reviewBuilder.submit')}
        </Button>
      </div>
    </div>
  )
}
