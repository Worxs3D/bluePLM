/**
 * What the Copy/Move to Vault dialog shows before the user commits: the plan the command would
 * make right now, the destination's folders, and how the selection is wired to files outside it.
 *
 * The destination does not have to be the open vault, so everything here goes through the server
 * and the Electron calls that take any path. The command plans again when it runs; this is a
 * preview, and the numbers on screen are allowed to be a little old.
 */

import { useEffect, useMemo, useState } from 'react'

import { getVaultFolders } from '@/lib/supabase'
import {
  createPrepareDeps,
  prepareVaultTransfer,
  type VaultTransferMode,
  type VaultTransferPlan,
} from '@/lib/vaultTransfer'
import { prepareFailureLabel } from '@/lib/vaultTransfer/labels'
import {
  findReferenceGaps,
  loadDestinationIndex,
  type ReferenceGaps,
} from '@/lib/vaultTransfer/serverOps'
import { usePDMStore } from '@/stores/pdmStore'
import type { ConnectedVault, LocalFile } from '@/stores/types'

/** How long the folder box must sit still before the destination is checked against it. */
const FOLDER_DEBOUNCE_MS = 300

export type VaultTransferPreview =
  | { status: 'loading' }
  | { status: 'ready'; plan: VaultTransferPlan }
  | { status: 'error'; message: string }

export type ReferenceGapsState = ReferenceGaps | 'unavailable' | null

interface DestinationState {
  vaultId: string
  folders: string[]
  serverPaths: ReadonlySet<string> | null
  error: string | null
}

export interface UseVaultTransferPreviewInput {
  mode: VaultTransferMode
  selection: readonly LocalFile[]
  destVault: ConnectedVault | null
  destFolder: string
  keepPath: boolean
}

export interface UseVaultTransferPreviewResult {
  preview: VaultTransferPreview
  /** Folder paths that exist in the destination, for the folder box to suggest. */
  destinationFolders: string[]
  gaps: ReferenceGapsState
}

export function useVaultTransferPreview({
  mode,
  selection,
  destVault,
  destFolder,
  keepPath,
}: UseVaultTransferPreviewInput): UseVaultTransferPreviewResult {
  const orgId = usePDMStore((state) => state.organization?.id ?? null)
  const destVaultId = destVault?.id ?? null
  const destVaultPath = destVault?.localPath ?? null

  const [destination, setDestination] = useState<DestinationState | null>(null)
  const [preview, setPreview] = useState<VaultTransferPreview>({ status: 'loading' })
  const [gaps, setGaps] = useState<ReferenceGapsState>(null)
  const [debouncedFolder, setDebouncedFolder] = useState(destFolder)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedFolder(destFolder), FOLDER_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [destFolder])

  // The destination's folders and every path it holds, once per destination.
  useEffect(() => {
    setDestination(null)
    setPreview({ status: 'loading' })
    if (!orgId || !destVaultId) return

    let cancelled = false
    Promise.all([getVaultFolders(destVaultId), loadDestinationIndex(orgId, destVaultId)]).then(
      ([folderResult, index]) => {
        if (cancelled) return
        setDestination({
          vaultId: destVaultId,
          // A folder list that fails to load only costs the suggestions.
          folders: folderResult.folders.map((folder) => folder.folder_path).sort(compareFolders),
          serverPaths: index.ok ? index.serverPaths : null,
          error: index.ok ? null : index.error,
        })
      },
    )
    return () => {
      cancelled = true
    }
  }, [orgId, destVaultId])

  // The plan, again whenever the folder, the path option or the destination changes.
  useEffect(() => {
    if (!orgId || !destVaultId || !destVaultPath || !destination) return
    if (destination.vaultId !== destVaultId) return

    if (!destination.serverPaths) {
      setPreview({
        status: 'error',
        message: prepareFailureLabel('destination-unreadable', destination.error ?? undefined),
      })
      return
    }

    let cancelled = false
    setPreview({ status: 'loading' })
    prepareVaultTransfer(
      {
        orgId,
        destVaultId,
        destVaultPath,
        selection,
        vaultFiles: usePDMStore.getState().files,
        options: { mode, destFolder: debouncedFolder, keepPath },
        serverPaths: destination.serverPaths,
      },
      createPrepareDeps(),
    )
      .then((result) => {
        if (cancelled) return
        setPreview(
          result.ok
            ? { status: 'ready', plan: result.plan }
            : { status: 'error', message: prepareFailureLabel(result.failure, result.message) },
        )
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setPreview({
          status: 'error',
          message: prepareFailureLabel(
            'destination-unreadable',
            error instanceof Error ? error.message : String(error),
          ),
        })
      })
    return () => {
      cancelled = true
    }
  }, [orgId, destVaultId, destVaultPath, destination, selection, mode, debouncedFolder, keepPath])

  // Which files the plan would carry decides which references leave the selection. Kept while a
  // new plan is loading so the warnings do not flicker, and fetched again only when that set changes.
  const idsKey = useMemo(() => {
    if (preview.status !== 'ready') return null
    return preview.plan.files
      .map((planned) => planned.sourceFileId)
      .filter((id): id is string => id !== null)
      .sort()
      .join(',')
  }, [preview])

  useEffect(() => {
    if (idsKey === null) return
    if (idsKey === '') {
      setGaps(null)
      return
    }

    let cancelled = false
    findReferenceGaps(idsKey.split(','))
      .then((result) => {
        if (!cancelled) setGaps(result.ok ? result.gaps : 'unavailable')
      })
      .catch(() => {
        if (!cancelled) setGaps('unavailable')
      })
    return () => {
      cancelled = true
    }
  }, [idsKey])

  return { preview, destinationFolders: destination?.folders ?? [], gaps }
}

function compareFolders(left: string, right: string): number {
  return left.localeCompare(right, undefined, { sensitivity: 'base' })
}
