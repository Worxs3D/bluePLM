/**
 * `syncOneDrawing` (via its public entry point `syncDrawingReferencesInBackground`) reads a
 * changed drawing's references off disk and upserts them into `file_references`. A `moved_away`
 * stub carries the real drawing's `pdmData` but has no file behind it at its own path - see
 * `.cursor/plans/realign-4.4.0-foldin-report.md` for why this module is one of the sites that
 * assumed a row with `pdmData` has local content. These tests cover the guard that keeps a stub
 * from reaching a live Document Manager read.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { usePDMStore } from '@/stores/pdmStore'
import type { LocalFile } from '@/stores/types'
import type { PDMFile } from '@/types/pdm'

import { cancelDrawingReferenceSync, syncDrawingReferencesInBackground } from './drawingReferenceSync'

const upsertFileReferences = vi.fn().mockResolvedValue({
  success: true,
  inserted: 0,
  updated: 0,
  deleted: 0,
  skipped: 0,
})

vi.mock('@/lib/supabase', () => ({
  upsertFileReferences: (...args: unknown[]) => upsertFileReferences(...args),
}))

const VAULT_PATH = 'C:\\vault'
const OLD_RELATIVE_PATH = 'Parts/OLD-LOCATION/DRAWING-1.SLDDRW'
const NEW_RELATIVE_PATH = 'Parts/NEW-LOCATION/DRAWING-1.SLDDRW'

function localFile(relativePath: string, overrides: Partial<LocalFile> = {}): LocalFile {
  return {
    name: relativePath.split(/[/\\]/).pop() || '',
    path: `${VAULT_PATH}\\${relativePath.replace(/\//g, '\\')}`,
    relativePath,
    isDirectory: false,
    extension: '.slddrw',
    size: 1,
    modifiedTime: 'now',
    ...overrides,
  }
}

/**
 * A `moved_away` stub at `OLD_RELATIVE_PATH` plus its `'moved'` partner at
 * `NEW_RELATIVE_PATH`, sharing one `pdmData.id` - exactly the shape
 * `cloudFileReconciliation.ts` produces for an unreconciled inode-matched rename.
 */
function movedAwayPair(): { stub: LocalFile; moved: LocalFile } {
  const pdmData = {
    id: 'drawing-1',
    org_id: 'org-1',
    vault_id: 'vault-1',
    file_path: OLD_RELATIVE_PATH,
    checked_out_by: null,
  } as PDMFile

  return {
    stub: localFile(OLD_RELATIVE_PATH, {
      diffStatus: 'moved_away',
      movedToRelativePath: NEW_RELATIVE_PATH,
      pdmData,
    }),
    moved: localFile(NEW_RELATIVE_PATH, {
      diffStatus: 'moved',
      pdmData,
    }),
  }
}

let getReferences: ReturnType<typeof vi.fn>
let cancelBackgroundReferences: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.useFakeTimers()
  getReferences = vi.fn().mockResolvedValue({
    success: true,
    data: { filePath: '', references: [], count: 0 },
  })
  cancelBackgroundReferences = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('window', {
    electronAPI: { solidworks: { getReferences, cancelBackgroundReferences } },
  })

  usePDMStore.setState({
    user: { id: 'user-1' } as ReturnType<typeof usePDMStore.getState>['user'],
    organization: { id: 'org-1' } as ReturnType<typeof usePDMStore.getState>['organization'],
    activeVaultId: 'vault-1',
    vaultPath: VAULT_PATH,
  })
})

afterEach(() => {
  cancelDrawingReferenceSync()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function runQueuedBatch(): Promise<void> {
  await vi.runOnlyPendingTimersAsync()
  // The batch loop is a chain of awaited promises; flush the microtask queue so it settles
  // before assertions run.
  await Promise.resolve()
  await Promise.resolve()
}

describe('syncOneDrawing / moved_away stubs', () => {
  it('skips a moved_away stub without reading it off disk', async () => {
    const { stub, moved } = movedAwayPair()
    usePDMStore.setState({ files: [stub, moved] })

    syncDrawingReferencesInBackground([OLD_RELATIVE_PATH])
    await runQueuedBatch()

    expect(getReferences).not.toHaveBeenCalled()
    expect(upsertFileReferences).not.toHaveBeenCalled()
  })

  it('still reads a drawing that is not a moved_away stub', async () => {
    usePDMStore.setState({
      files: [
        localFile(NEW_RELATIVE_PATH, {
          pdmData: {
            id: 'drawing-1',
            org_id: 'org-1',
            vault_id: 'vault-1',
            file_path: NEW_RELATIVE_PATH,
            checked_out_by: null,
          } as PDMFile,
        }),
      ],
    })

    syncDrawingReferencesInBackground([NEW_RELATIVE_PATH])
    await runQueuedBatch()

    expect(getReferences).toHaveBeenCalledTimes(1)
    expect(getReferences).toHaveBeenCalledWith(
      `${VAULT_PATH}\\${NEW_RELATIVE_PATH.replace(/\//g, '\\')}`,
      'background',
    )
    expect(upsertFileReferences).toHaveBeenCalledTimes(1)
  })
})
