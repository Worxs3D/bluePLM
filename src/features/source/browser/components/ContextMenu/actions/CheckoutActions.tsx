/**
 * Checkout entries for the context menu: `checkout.checkOut`, `checkout.checkIn`,
 * `checkout.discard`, `checkout.forceRelease`, `checkout.changeState` (a flyout) and
 * `checkout.syncMetadata`.
 */
import React, { useState } from 'react'
import { ArrowDown, ArrowUp, Loader2, RefreshCw, Undo2, Unlock } from 'lucide-react'
import type { LocalFile } from '@/stores/pdmStore'
import { useShallow } from 'zustand/react/shallow'
import { usePDMStore } from '@/stores/pdmStore'
import { executeCommand } from '@/lib/commands'
import { checkOperationPermission, getPermissionRequirement } from '@/lib/permissions'
import { getCountLabel } from '@/lib/utils'
import { getCheckoutOwnerLabel } from '@/lib/checkout/checkoutDisplay'
import type { RefreshableActionProps, SelectionCounts, SelectionState } from './types'
import { ContextSubmenu } from '../components'
import { useSolidWorksStatus } from '@/hooks/useSolidWorksStatus'
import { isSolidWorksUsable } from '@/types/solidworks'
import { ChangeStateSubmenu } from './ChangeStateSubmenu'
import { isFileWriteInFlight } from '@/lib/metadata/writeInFlight'
import { fileWorkflowsEnabled } from '@/lib/fileWorkflows'
import { hasDesktop } from '@/lib/platform'
import { useFlyout } from '../customizable/flyout'
import type { EntryHookResult } from '../customizable/types'
import { SubmenuArrow } from '../components/SubmenuArrow'

export interface CheckoutEntriesProps extends RefreshableActionProps {
  counts: SelectionCounts
  state: SelectionState
  syncedFilesInSelection: LocalFile[]
  handleCheckoutFolder: (folder: LocalFile) => void
  handleCheckinFolder: (folder: LocalFile) => void
  handleBulkStateChange: (files: LocalFile[], newState: string) => void
  /** The Change State flyout's close timer (the shape `ChangeStateSubmenu` takes). */
  stateSubmenuTimeoutRef: React.MutableRefObject<NodeJS.Timeout | null>
  /** Keys of the metadata writes currently running - blocks operations on the files they touch */
  savingConfigsToSW?: ReadonlySet<string>
}

type CheckoutEntryId =
  | 'checkout.checkOut'
  | 'checkout.checkIn'
  | 'checkout.discard'
  | 'checkout.forceRelease'
  | 'checkout.changeState'
  | 'checkout.syncMetadata'

export function useCheckoutEntries({
  contextFiles,
  multiSelect,
  firstFile,
  onClose,
  onRefresh,
  counts,
  state,
  syncedFilesInSelection,
  handleCheckoutFolder,
  handleCheckinFolder,
  handleBulkStateChange,
  stateSubmenuTimeoutRef,
  savingConfigsToSW,
}: CheckoutEntriesProps): EntryHookResult<CheckoutEntryId> {
  const { user, getEffectiveRole, hasPermission, addToast, solidworksIntegrationEnabled } =
    usePDMStore(
      useShallow((s) => ({
        user: s.user,
        getEffectiveRole: s.getEffectiveRole,
        hasPermission: s.hasPermission,
        addToast: s.addToast,
        solidworksIntegrationEnabled: s.solidworksIntegrationEnabled,
      })),
    )
  const { status, hasChecked: swStatusChecked } = useSolidWorksStatus()
  const [isSyncing, setIsSyncing] = useState(false)
  const heldFile = syncedFilesInSelection.length === 1 ? syncedFilesInSelection[0] : null
  // File workflows switched off for the organization hide every Change State entry.
  const workflowsOn = usePDMStore((s) => fileWorkflowsEnabled(s.organization))
  const heldFileHydration = usePDMStore((s) =>
    heldFile?.pdmData?.id ? s.checkoutHydration[heldFile.pdmData.id]?.state : undefined,
  )

  // Check if any files are currently saving metadata, at any scope: a configuration edit mutates
  // the same bytes a check-in is about to upload.
  const isAnySaving = (files: LocalFile[]): boolean => {
    if (!savingConfigsToSW || savingConfigsToSW.size === 0) return false
    return files.some((f) => isFileWriteInFlight(savingConfigsToSW, f.path))
  }
  const effectiveRole = getEffectiveRole()
  const isAdmin = effectiveRole === 'admin'
  // BluePLM Web has no local vault: no check out, check in or discard. Force Release and
  // Change State are server-side and stay.
  const desktop = hasDesktop()

  // Permission checks
  const canCheckout = checkOperationPermission('checkout', hasPermission)
  const canCheckin = checkOperationPermission('checkin', hasPermission)
  const canDiscard = checkOperationPermission('discard', hasPermission)
  const canForceRelease = checkOperationPermission('force-release', hasPermission)

  const fileCount = counts.fileCount
  const folderCount = counts.folderCount
  const countLabel = getCountLabel(fileCount, folderCount)

  const heldByOthers = !state.allFolders && state.allCheckedOutByOthers
  const heldByOthersReason =
    (heldFile && getCheckoutOwnerLabel(heldFile, user, heldFileHydration)) ||
    'Checked out by someone else'

  // Compute disabled states
  const checkoutDisabled =
    !canCheckout.allowed ||
    !state.anySynced ||
    (state.allFolders ? counts.checkoutableCount === 0 : state.allCheckedOut)
  const checkoutReason = !canCheckout.allowed
    ? `Requires ${getPermissionRequirement('checkout')}`
    : !state.anySynced
      ? 'Download files first to enable checkout'
      : heldByOthers
        ? heldByOthersReason
        : (state.allFolders ? counts.checkoutableCount === 0 : state.allCheckedOut)
          ? 'All files already checked out'
          : ''

  const checkinDisabled = !canCheckin.allowed || state.allCheckedIn || counts.checkinableCount === 0
  const checkinReason = !canCheckin.allowed
    ? `Requires ${getPermissionRequirement('checkin')}`
    : state.allCheckedIn
      ? 'Already checked in'
      : state.allCheckedOutByOthers
        ? heldByOthersReason
        : counts.checkinableCount === 0
          ? 'No files checked out by you'
          : ''

  const discardDisabled = !canDiscard.allowed
  const discardReason = !canDiscard.allowed ? `Requires ${getPermissionRequirement('discard')}` : ''

  const forceReleaseDisabled = !canForceRelease.allowed
  const forceReleaseReason = !canForceRelease.allowed
    ? `Requires ${getPermissionRequirement('force-release')}`
    : ''

  const syncMetadataFiles = syncMetadataEligibleFiles(
    contextFiles,
    multiSelect,
    firstFile,
    user,
    desktop && solidworksIntegrationEnabled,
  )

  return {
    entries: {
      'checkout.checkOut': !desktop ? null : state.allFolders && !multiSelect ? (
        <div
          className={`context-menu-item ${checkoutDisabled ? 'disabled' : ''}`}
          onClick={() => {
            if (!canCheckout.allowed) {
              addToast('error', canCheckout.reason || getPermissionRequirement('checkout'))
              return
            }
            if (!state.anySynced || counts.checkoutableCount === 0) return
            handleCheckoutFolder(firstFile)
            onClose()
          }}
          title={checkoutReason}
        >
          <ArrowDown
            size={14}
            className={checkoutDisabled ? 'text-plm-fg-muted' : 'text-plm-warning'}
          />
          Check Out {counts.checkoutableCount > 0 ? `${counts.checkoutableCount} files` : ''}
          {!canCheckout.allowed && (
            <span className="text-xs text-plm-fg-muted ml-auto">(no permission)</span>
          )}
          {canCheckout.allowed && !state.anySynced && (
            <span className="text-xs text-plm-fg-muted ml-auto">(download first)</span>
          )}
          {canCheckout.allowed && state.anySynced && counts.checkoutableCount === 0 && (
            <span className="text-xs text-plm-fg-muted ml-auto">(already out)</span>
          )}
        </div>
      ) : (
        <div
          className={`context-menu-item ${checkoutDisabled ? 'disabled' : ''}`}
          onClick={() => {
            if (!canCheckout.allowed) {
              addToast('error', canCheckout.reason || getPermissionRequirement('checkout'))
              return
            }
            if (!state.anySynced || state.allCheckedOut || !user) return
            onClose()
            executeCommand('checkout', { files: contextFiles }, { onRefresh })
          }}
          title={checkoutReason}
        >
          <ArrowDown
            size={14}
            className={checkoutDisabled ? 'text-plm-fg-muted' : 'text-plm-warning'}
          />
          Check Out {multiSelect ? countLabel : ''}
          {!canCheckout.allowed && (
            <span className="text-xs text-plm-fg-muted ml-auto">(no permission)</span>
          )}
          {canCheckout.allowed && !state.anySynced && (
            <span className="text-xs text-plm-fg-muted ml-auto">(download first)</span>
          )}
          {canCheckout.allowed && state.anySynced && state.allCheckedOut && (
            <span className="text-xs text-plm-fg-muted ml-auto">
              {heldByOthers ? '(by others)' : '(already out)'}
            </span>
          )}
        </div>
      ),
      'checkout.checkIn':
        desktop && state.anySynced ? (
          state.allFolders && !multiSelect ? (
            <div
              className={`context-menu-item ${checkinDisabled ? 'disabled' : ''}`}
              onClick={() => {
                if (!canCheckin.allowed) {
                  addToast('error', canCheckin.reason || getPermissionRequirement('checkin'))
                  return
                }
                if (counts.checkinableCount === 0) return
                if (isAnySaving(contextFiles)) {
                  addToast('warning', 'Please wait - file metadata is being saved')
                  return
                }
                handleCheckinFolder(firstFile)
                onClose()
              }}
              title={checkinReason}
            >
              <ArrowUp
                size={14}
                className={checkinDisabled ? 'text-plm-fg-muted' : 'text-plm-success'}
              />
              Check In {counts.checkinableCount > 0 ? `${counts.checkinableCount} files` : ''}
              {!canCheckin.allowed && (
                <span className="text-xs text-plm-fg-muted ml-auto">(no permission)</span>
              )}
              {canCheckin.allowed && counts.checkinableCount === 0 && (
                <span className="text-xs text-plm-fg-muted ml-auto">(none checked out)</span>
              )}
            </div>
          ) : (
            <div
              className={`context-menu-item ${checkinDisabled ? 'disabled' : ''}`}
              onClick={() => {
                if (!canCheckin.allowed) {
                  addToast('error', canCheckin.reason || getPermissionRequirement('checkin'))
                  return
                }
                if (state.allCheckedIn || counts.checkinableCount === 0 || !user) return
                if (isAnySaving(contextFiles)) {
                  addToast('warning', 'Please wait - file metadata is being saved')
                  return
                }
                onClose()
                executeCommand('checkin', { files: contextFiles }, { onRefresh })
              }}
              title={checkinReason}
            >
              <ArrowUp
                size={14}
                className={checkinDisabled ? 'text-plm-fg-muted' : 'text-plm-success'}
              />
              Check In {multiSelect ? countLabel : ''}
              {!canCheckin.allowed && (
                <span className="text-xs text-plm-fg-muted ml-auto">(no permission)</span>
              )}
              {canCheckin.allowed && state.allCheckedIn && (
                <span className="text-xs text-plm-fg-muted ml-auto">(already in)</span>
              )}
              {canCheckin.allowed && !state.allCheckedIn && state.allCheckedOutByOthers && (
                <span className="text-xs text-plm-fg-muted ml-auto">(by others)</span>
              )}
            </div>
          )
        ) : null,
      'checkout.discard':
        desktop && counts.checkinableCount > 0 ? (
          <div
            className={`context-menu-item ${discardDisabled ? 'disabled' : 'text-plm-warning'}`}
            onClick={() => {
              if (!canDiscard.allowed) {
                addToast('error', canDiscard.reason || getPermissionRequirement('discard'))
                return
              }
              if (isAnySaving(contextFiles)) {
                addToast('warning', 'Please wait - file metadata is being saved')
                return
              }
              onClose()
              executeCommand('discard', { files: contextFiles }, { onRefresh })
            }}
            title={
              discardDisabled ? discardReason : 'Discard local changes and revert to server version'
            }
          >
            <Undo2 size={14} />
            Discard Checkout {counts.checkinableCount > 1 ? `(${counts.checkinableCount})` : ''}
            {!canDiscard.allowed && (
              <span className="text-xs text-plm-fg-muted ml-auto">(no permission)</span>
            )}
          </div>
        ) : null,
      'checkout.forceRelease':
        isAdmin && counts.checkedOutByOthersCount > 0 ? (
          <div
            className={`context-menu-item ${forceReleaseDisabled ? 'disabled' : 'text-plm-error'}`}
            onClick={() => {
              if (!canForceRelease.allowed) {
                addToast(
                  'error',
                  canForceRelease.reason || getPermissionRequirement('force-release'),
                )
                return
              }
              onClose()
              executeCommand('force-release', { files: contextFiles }, { onRefresh })
            }}
            title={
              forceReleaseDisabled
                ? forceReleaseReason
                : "Admin: Immediately release checkout. User's unsaved changes will be orphaned."
            }
          >
            <Unlock size={14} />
            Force Release{' '}
            {counts.checkedOutByOthersCount > 1 ? `(${counts.checkedOutByOthersCount})` : ''}
            {!canForceRelease.allowed && (
              <span className="text-xs text-plm-fg-muted ml-auto">(no permission)</span>
            )}
          </div>
        ) : null,
      // Change State - single file uses the workflow engine's available transitions; a
      // multi-select falls back to the legacy bulk state change
      'checkout.changeState': !workflowsOn ? null : syncedFilesInSelection.length === 1 ? (
        <ChangeStateEntry
          targetFile={syncedFilesInSelection[0]}
          onClose={onClose}
          onRefresh={onRefresh}
          stateSubmenuTimeoutRef={stateSubmenuTimeoutRef}
        />
      ) : syncedFilesInSelection.length > 1 ? (
        <BulkChangeStateEntry
          syncedFilesInSelection={syncedFilesInSelection}
          onClose={onClose}
          handleBulkStateChange={handleBulkStateChange}
        />
      ) : null,
      // Sync SolidWorks Metadata - for SW files that are local-only OR checked out
      'checkout.syncMetadata': syncMetadataFiles ? (
        <SyncMetadataItem
          eligibleFiles={syncMetadataFiles}
          onClose={onClose}
          onRefresh={onRefresh}
          swServiceRunning={isSolidWorksUsable(status)}
          swStatusChecked={swStatusChecked}
          isSyncing={isSyncing}
          setIsSyncing={setIsSyncing}
        />
      ) : null,
    },
  }
}

/** Change State for one file: the workflow engine's transitions, in `ChangeStateSubmenu`. */
function ChangeStateEntry({
  targetFile,
  onClose,
  onRefresh,
  stateSubmenuTimeoutRef,
}: {
  targetFile: LocalFile
  onClose: () => void
  onRefresh: (silent?: boolean) => void
  stateSubmenuTimeoutRef: React.MutableRefObject<NodeJS.Timeout | null>
}) {
  const flyout = useFlyout('checkout.changeState')
  return (
    <ChangeStateSubmenu
      targetFile={targetFile}
      onClose={onClose}
      onRefresh={onRefresh}
      showStateSubmenu={flyout.isOpen}
      setShowStateSubmenu={flyout.setOpen}
      stateSubmenuTimeoutRef={stateSubmenuTimeoutRef}
    />
  )
}

/** Change State for several files: the legacy bulk state change. */
function BulkChangeStateEntry({
  syncedFilesInSelection,
  onClose,
  handleBulkStateChange,
}: {
  syncedFilesInSelection: LocalFile[]
  onClose: () => void
  handleBulkStateChange: (files: LocalFile[], newState: string) => void
}) {
  const flyout = useFlyout('checkout.changeState')
  return (
    <div
      className="context-menu-item relative"
      onMouseEnter={flyout.onMouseEnter}
      onMouseLeave={flyout.onMouseLeave}
      onClick={(e) => {
        e.stopPropagation()
        flyout.toggle()
      }}
    >
      <RefreshCw size={14} />
      Change State
      <SubmenuArrow />
      {/* State Submenu */}
      {flyout.isOpen && (
        <ContextSubmenu
          minWidth={160}
          onMouseEnter={flyout.onMouseEnter}
          onMouseLeave={flyout.onMouseLeave}
        >
          {(['wip', 'in_review', 'released', 'obsolete'] as const).map((stateOption) => {
            const stateColors: Record<string, string> = {
              wip: 'var(--plm-wip)',
              in_review: 'var(--plm-in-review)',
              released: 'var(--plm-released)',
              obsolete: 'var(--plm-obsolete)',
            }
            const stateLabels: Record<string, string> = {
              wip: 'Work in Progress',
              in_review: 'In Review',
              released: 'Released',
              obsolete: 'Obsolete',
            }
            return (
              <div
                key={stateOption}
                className="context-menu-item"
                onClick={(e) => {
                  e.stopPropagation()
                  onClose()
                  flyout.setOpen(false)
                  handleBulkStateChange(syncedFilesInSelection, stateOption)
                }}
              >
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: stateColors[stateOption] }}
                />
                {stateLabels[stateOption]}
              </div>
            )
          })}
        </ContextSubmenu>
      )}
    </div>
  )
}

const SW_EXTENSIONS = ['.sldprt', '.sldasm', '.slddrw']

/**
 * The files Sync Metadata acts on, or null when it does not show: SW files that are
 * - Local only (not synced to cloud yet), OR
 * - Checked out by current user
 */
function syncMetadataEligibleFiles(
  contextFiles: LocalFile[],
  multiSelect: boolean,
  firstFile: LocalFile,
  user: { id: string } | null,
  solidworksIntegrationEnabled: boolean,
): LocalFile[] | null {
  const swExtensions = SW_EXTENSIONS
  const ext = firstFile.extension?.toLowerCase() || ''
  const isSolidWorksFile = swExtensions.includes(ext)

  // Only show for SolidWorks files when integration is enabled
  if (!solidworksIntegrationEnabled || !isSolidWorksFile) {
    return null
  }

  // For multi-select, only show if all files are SolidWorks files
  if (multiSelect) {
    const allSwFiles = contextFiles.every((f) => {
      const fExt = f.extension?.toLowerCase() || ''
      return swExtensions.includes(fExt)
    })
    if (!allSwFiles) return null
  }

  // Filter to only SolidWorks files
  const swFiles = contextFiles.filter((f) => {
    const fExt = f.extension?.toLowerCase() || ''
    return swExtensions.includes(fExt)
  })

  // Show for files that are:
  // 1. Local only (no pdmData - not synced to cloud yet), OR
  // 2. Checked out by current user
  // Excludes 'moved_away' unconditionally - a stub shares the real file's pdmData/checkout
  // state, but there is no SolidWorks file on disk at the stub's own path to sync metadata for.
  const eligibleFiles = swFiles.filter((f) => {
    if (f.diffStatus === 'moved_away') return false
    const isLocalOnly = !f.pdmData?.id
    const isCheckedOutByMe = f.pdmData?.checked_out_by === user?.id
    return isLocalOnly || isCheckedOutByMe
  })

  return eligibleFiles.length === 0 ? null : eligibleFiles
}

/** Sync Metadata menu item, for the files `syncMetadataEligibleFiles` found. */
function SyncMetadataItem({
  eligibleFiles,
  onClose,
  onRefresh,
  swServiceRunning,
  swStatusChecked,
  isSyncing,
  setIsSyncing,
}: {
  eligibleFiles: LocalFile[]
  onClose: () => void
  onRefresh: (silent?: boolean) => void
  swServiceRunning: boolean
  swStatusChecked: boolean
  isSyncing: boolean
  setIsSyncing: (v: boolean) => void
}) {
  const handleSyncMetadata = async () => {
    if (!swServiceRunning || isSyncing) return

    setIsSyncing(true)
    onClose()

    try {
      await executeCommand('sync-metadata', { files: eligibleFiles }, { onRefresh })
    } finally {
      setIsSyncing(false)
    }
  }

  const fileCount = eligibleFiles.length
  const countLabel = fileCount > 1 ? ` (${fileCount})` : ''

  // Determine tooltip based on state
  let tooltip = 'Sync metadata between BluePLM and SolidWorks file'
  if (!swServiceRunning) {
    tooltip = swStatusChecked ? 'SolidWorks service not running' : 'Checking SolidWorks service...'
  }

  return (
    <div
      className={`context-menu-item ${!swServiceRunning || isSyncing ? 'opacity-50' : ''}`}
      onClick={handleSyncMetadata}
      title={tooltip}
    >
      {isSyncing ? (
        <Loader2 size={14} className="animate-spin text-plm-accent" />
      ) : (
        <RefreshCw size={14} className="text-plm-accent" />
      )}
      Sync Metadata{countLabel}
    </div>
  )
}
