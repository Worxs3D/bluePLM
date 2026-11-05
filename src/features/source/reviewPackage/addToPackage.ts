/**
 * Entry points into the review draft: from a file selection (context menus, a state change into
 * review, the pane's "Start a review"), from file ids (a closed review's "Request a new review
 * with these files"), and from one version in version history. Also adding files to an open
 * review, which asks first (`reviewAddConfirm`), and taking files out again.
 *
 * A file selection always resolves to the server's latest checked-in version, looked up fresh,
 * never the renderer's cached `pdmData.version` and never the local working copy.
 */

import { log } from '@/lib/logger'
import { t } from '@/lib/i18n'
import {
  addReviewItems,
  getLatestCheckedInVersions,
  removeReviewItems,
} from '@/lib/supabase/reviews'
import { describeReviewError } from '@/features/source/reviews/lib/reviewErrors'
import { usePDMStore } from '@/stores/pdmStore'
import { reviewPackagesInstalled, selectReviewPackageDraft } from '@/stores/slices/reviewsSlice'
import type { LocalFile } from '@/stores/types'
import type { ReviewPackageDraftItem } from '@/types/reviewPackageDraft'
import type { OpenReviewForFiles } from '@/types/reviews'

import { reviewableFiles } from './lib/localCopy'

export interface AddToPackageOptions {
  /** Open the right-panel pane after adding (default true). */
  openPane?: boolean
  /** With the pane left closed: the label of the toast button that opens it (default "Show draft"). */
  actionLabel?: string
}

function openPane() {
  usePDMStore.getState().setReviewPackagePaneOpen(true)
}

function announce(
  outcome: { added: number; replaced: number; dropped: number },
  skipped: number,
  paneOpened: boolean,
  actionLabel?: string,
) {
  const { addToast } = usePDMStore.getState()
  // The pane shows the files; a toast is only needed when it did not open.
  const showAction = paneOpened
    ? undefined
    : { label: actionLabel ?? t('reviewBuilder.toast.openDraft'), onClick: openPane }
  if (outcome.added > 0 || outcome.replaced > 0) {
    addToast('success', t('reviewBuilder.toast.added', { count: outcome.added + outcome.replaced }), undefined, showAction)
  } else if (skipped === 0 && outcome.dropped === 0) {
    addToast('info', t('reviewBuilder.toast.alreadyIn'))
  }
  if (skipped > 0) addToast('warning', t('reviewBuilder.toast.noVersion', { count: skipped }))
  if (outcome.dropped > 0) addToast('warning', t('reviewBuilder.toast.full', { count: outcome.dropped }))
}

/**
 * Add files by `files.id` at their latest checked-in versions. Ids with no checked-in version are
 * left out and counted in a warning.
 */
export async function addFileIdsToReviewPackage(
  fileIds: readonly string[],
  options?: AddToPackageOptions,
): Promise<void> {
  const state = usePDMStore.getState()
  // Review packages are the Reviews extension's (Settings > Extensions).
  if (!state.user || !reviewPackagesInstalled(state)) return
  const unique = Array.from(new Set(fileIds))
  if (unique.length === 0) {
    state.addToast('info', t('reviewBuilder.toast.nothingReviewable'))
    return
  }

  try {
    const latest = await getLatestCheckedInVersions(unique)
    const items: ReviewPackageDraftItem[] = latest.map((v) => ({
      fileId: v.fileId,
      fileVersionId: v.fileVersionId,
      version: v.version,
      revision: v.revision,
      state: v.state,
      fileName: v.fileName,
      filePath: v.filePath,
      extension: v.extension,
      vaultId: v.vaultId,
      latestVersion: v.version,
    }))
    const outcome = usePDMStore.getState().addReviewPackageItems(items)
    const paneOpened = options?.openPane !== false
    if (paneOpened) openPane()
    announce(outcome, unique.length - items.length, paneOpened, options?.actionLabel)
  } catch (error) {
    log.error('[ReviewPackage]', 'Adding files to the review draft failed', { error })
    state.addToast(
      'error',
      t('reviewBuilder.toast.addFailed', {
        message: error instanceof Error ? error.message : String(error),
      }),
    )
  }
}

/** Add files at their latest checked-in versions. Folders and unsynced files are ignored. */
export async function addFilesToReviewPackage(
  files: readonly LocalFile[],
  options?: AddToPackageOptions,
): Promise<void> {
  const fileIds = reviewableFiles(files)
    .map((f) => f.pdmData?.id)
    .filter((id): id is string => !!id)
  await addFileIdsToReviewPackage(fileIds, options)
}

/** One row of `file_versions`, as version history lists it. */
export interface VersionRowForPackage {
  id: string
  version: number
  revision: string | null
  state: string | null
}

/** Add one specific version of a synced file (from version history). */
export function addVersionToReviewPackage(
  file: LocalFile,
  version: VersionRowForPackage,
  latestVersion: number,
  options?: AddToPackageOptions,
): void {
  const fileId = file.pdmData?.id
  if (!fileId || !reviewPackagesInstalled(usePDMStore.getState())) return
  const state = usePDMStore.getState()
  const previous = selectReviewPackageDraft(state).items.find((i) => i.fileId === fileId)
  const outcome = state.addReviewPackageItems([
    {
      fileId,
      fileVersionId: version.id,
      version: version.version,
      revision: version.revision || null,
      state: version.state || null,
      fileName: file.name,
      filePath: file.pdmData?.file_path ?? file.relativePath,
      extension: file.extension || null,
      vaultId: file.pdmData?.vault_id ?? null,
      latestVersion: Math.max(latestVersion, version.version),
    },
  ])
  const paneOpened = options?.openPane !== false
  if (paneOpened) openPane()
  if (outcome.replaced > 0 && previous && previous.version !== version.version) {
    state.addToast(
      'success',
      t('reviewBuilder.toast.versionSwapped', { version: version.version, previous: previous.version }),
    )
    return
  }
  announce(outcome, 0, paneOpened)
}

/**
 * Ask before adding files to an open review: reviewers are notified at once and review the files
 * at the versions named, so the confirm lists them (`ReviewAddConfirmDialog`). Files the review
 * already holds are left out; a newer version of one of those goes in through resubmit.
 */
export async function requestAddToOpenReview(
  files: readonly LocalFile[],
  review: OpenReviewForFiles,
): Promise<void> {
  const state = usePDMStore.getState()
  if (!reviewPackagesInstalled(state)) return
  const contained = new Set(review.containedFileIds)
  const fileIds = reviewableFiles(files)
    .map((f) => f.pdmData?.id)
    .filter((id): id is string => !!id && !contained.has(id))
  if (fileIds.length === 0) {
    state.addToast('info', t('contextMenu.review.toastAlreadyInReview', { title: review.title }))
    return
  }

  try {
    const latest = await getLatestCheckedInVersions(fileIds)
    if (latest.length === 0) {
      state.addToast('warning', t('reviewBuilder.toast.noVersion', { count: fileIds.length }))
      return
    }
    usePDMStore.getState().setReviewAddConfirm({
      reviewId: review.reviewId,
      title: review.title,
      versions: latest.map((v) => ({
        fileVersionId: v.fileVersionId,
        fileName: v.fileName,
        version: v.version,
      })),
      skipped: new Set(fileIds).size - latest.length,
    })
  } catch (error) {
    log.error('[Reviews]', 'Looking up versions to add to an open review failed', {
      error,
      reviewId: review.reviewId,
    })
    state.addToast(
      'error',
      t('contextMenu.review.toastAddFailed', { message: describeReviewError(error) }),
    )
  }
}

/** The confirm's "Add files": send the versions it listed. */
export async function confirmAddToOpenReview(): Promise<void> {
  const state = usePDMStore.getState()
  const pending = state.reviewAddConfirm
  if (!pending) return
  state.setReviewAddConfirm(null)
  try {
    const result = await addReviewItems(
      pending.reviewId,
      pending.versions.map((v) => v.fileVersionId),
    )
    state.addToast(
      'success',
      t('contextMenu.review.toastAdded', { count: result.added, title: pending.title }),
      undefined,
      {
        label: t('reviewBuilder.toast.open'),
        onClick: () => usePDMStore.getState().openReview(pending.reviewId),
      },
    )
    if (pending.skipped > 0)
      state.addToast('warning', t('reviewBuilder.toast.noVersion', { count: pending.skipped }))
    usePDMStore.getState().requestReviewQueueRefresh()
  } catch (error) {
    log.error('[Reviews]', 'Adding files to an open review failed', {
      error,
      reviewId: pending.reviewId,
    })
    state.addToast(
      'error',
      t('contextMenu.review.toastAddFailed', { message: describeReviewError(error) }),
    )
  }
}

/** Take files out of an open review. */
export async function removeFilesFromOpenReview(
  review: OpenReviewForFiles,
  fileIds: readonly string[],
): Promise<void> {
  const state = usePDMStore.getState()
  const ids = fileIds.filter((id) => review.containedFileIds.includes(id))
  if (ids.length === 0) return
  try {
    const result = await removeReviewItems(review.reviewId, ids)
    state.addToast(
      'success',
      t('contextMenu.review.toastRemoved', { count: result.removed, title: review.title }),
    )
    usePDMStore.getState().requestReviewQueueRefresh()
  } catch (error) {
    log.error('[Reviews]', 'Removing files from an open review failed', {
      error,
      reviewId: review.reviewId,
    })
    state.addToast(
      'error',
      t('contextMenu.review.toastRemoveFailed', { message: describeReviewError(error) }),
    )
  }
}

/** Take files out of the draft. */
export function removeFilesFromReviewPackage(fileIds: readonly string[]): void {
  const state = usePDMStore.getState()
  const inDraft = new Set(selectReviewPackageDraft(state).items.map((i) => i.fileId))
  const ids = fileIds.filter((id) => inDraft.has(id))
  for (const id of ids) state.removeReviewPackageItem(id)
  if (ids.length > 0)
    state.addToast('success', t('contextMenu.review.toastRemovedFromDraft', { count: ids.length }))
}
