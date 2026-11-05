/**
 * The review pane in the right panel. It shows one of:
 * - the draft (`DraftView`) while the user's draft holds files;
 * - "Review requested" (`PaneSent`) after sending, until dismissed or files are added;
 * - otherwise the home state (`PaneHome`): start a review, and what is waiting on the user.
 *
 * The draft lives in the `reviews` store slice (persisted per user and organization), so the pane
 * can close at any time and the user can keep browsing and adding files from context menus or
 * version history.
 */

import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'

import { EmptyState, IconButton, OverflowMenu, PaneHeader } from '@/components/core/ui'
import { t } from '@/lib/i18n'
import { usePDMStore } from '@/stores/pdmStore'
import { selectReviewPackageDraft } from '@/stores/slices/reviewsSlice'

import { DraftView } from './components/DraftView'
import { PaneHome } from './components/PaneHome'
import { PaneSent } from './components/PaneSent'
import { useReviewerDirectory } from './hooks/useReviewerDirectory'
import { reviewableFiles } from './lib/localCopy'

/** Reviewable files selected in the vault. Only the explorer has a file selection to offer. */
function useReviewableSelection() {
  const { activeView, selectedFiles, files } = usePDMStore(
    useShallow((s) => ({ activeView: s.activeView, selectedFiles: s.selectedFiles, files: s.files })),
  )
  return useMemo(() => {
    if (activeView !== 'explorer' || selectedFiles.length === 0) return []
    const chosen = new Set(selectedFiles)
    return reviewableFiles(files.filter((f) => chosen.has(f.path)))
  }, [activeView, selectedFiles, files])
}

export function ReviewPackagePane() {
  const draft = usePDMStore(selectReviewPackageDraft)
  const { user, organization, lastSent, closePane } = usePDMStore(
    useShallow((s) => ({
      user: s.user,
      organization: s.organization,
      lastSent: s.reviewPackageLastSent,
      closePane: s.closeReviewPackagePane,
    })),
  )
  const selection = useReviewableSelection()
  const directory = useReviewerDirectory(organization?.id)
  const [submitting, setSubmitting] = useState(false)

  const mode = !user || !organization ? 'signedOut' : lastSent ? 'sent' : draft.items.length > 0 ? 'draft' : 'home'

  const discard = () => {
    const s = usePDMStore.getState()
    const discarded = s.discardReviewPackageDraft()
    if (!discarded) return
    s.addToast('info', t('reviewBuilder.toast.discarded'), 8000, {
      label: t('reviewBuilder.toast.undo'),
      onClick: () => usePDMStore.getState().restoreReviewPackageDraft(discarded),
    })
  }

  const close = (
    <IconButton
      label={mode === 'draft' ? t('reviewBuilder.close') : t('reviewBuilder.closePane')}
      icon={<X size={16} />}
      onClick={closePane}
    />
  )

  return (
    <div className="flex h-full min-h-0 flex-col bg-ui-bg font-ui text-ui-fg">
      {mode === 'draft' ? (
        <PaneHeader
          title={t('reviewBuilder.title')}
          count={
            draft.items.length === 1
              ? t('reviewBuilder.itemCountOne')
              : t('reviewBuilder.itemCount', { count: draft.items.length })
          }
          actions={
            <>
              <OverflowMenu
                label={t('reviewBuilder.more')}
                disabled={submitting}
                items={[{ id: 'discard', label: t('reviewBuilder.discard'), danger: true, onSelect: discard }]}
              />
              {close}
            </>
          }
        />
      ) : (
        <PaneHeader title={t('reviewBuilder.paneTitle')} actions={close} />
      )}

      {mode === 'draft' ? (
        <DraftView
          draft={draft}
          directory={directory}
          selection={selection}
          submitting={submitting}
          setSubmitting={setSubmitting}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-4">
          {mode === 'signedOut' ? (
            <EmptyState title={t('reviewBuilder.pane.signedOut')} />
          ) : mode === 'sent' && lastSent ? (
            <PaneSent sent={lastSent} users={directory.users} />
          ) : (
            <PaneHome selection={selection} />
          )}
        </div>
      )}
    </div>
  )
}
