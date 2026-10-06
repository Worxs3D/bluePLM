/**
 * The glue between Copy/Move to Vault and the command system.
 *
 * The planning, the engine, the removal and the report each have their own tests in
 * `src/lib/vaultTransfer`; what is pinned here is what only this file decides:
 *
 * 1. `validate` refuses before anything is read or written, with a sentence rather than a key.
 * 2. A Move needs both permissions, a Copy only one.
 * 3. A Copy never touches the source vault; a Move removes sources only after the run, and only
 *    what the removal reports as gone leaves the store.
 * 4. The destination is checked against the server's access list, not just the local connection.
 * 5. Spinners are cleared and the progress toast finished even when the engine throws.
 *
 * The real `t()` is used, so a missing key fails here instead of printing its own name.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { LocalFile } from '@/stores/types'
import type { RemoveSourcesOutcome } from '@/lib/vaultTransfer/removeSources'
import type { TransferItemResult, TransferRunResult } from '@/lib/vaultTransfer/execute'
import { planVaultTransfer } from '@/lib/vaultTransfer/plan'

import type { CommandContext } from '../types'

vi.mock('@/lib/logger', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const getAccessibleVaults = vi.fn()
vi.mock('@/lib/supabase/vaults', () => ({ getAccessibleVaults }))

const addToSyncIndex = vi.fn(() => Promise.resolve())
const removeFromSyncIndex = vi.fn(() => Promise.resolve())
vi.mock('@/lib/cache/localSyncIndex', () => ({ addToSyncIndex, removeFromSyncIndex }))

const releaseWatcher = vi.fn()
const beginWatcherSuppression = vi.fn(() => releaseWatcher)
vi.mock('@/lib/fileWatcherSuppression', () => ({ beginWatcherSuppression }))

const progress = {
  update: vi.fn(),
  setStatus: vi.fn(),
  finish: vi.fn(),
  isCancelled: () => false,
}
vi.mock('../executor', () => ({
  ProgressTracker: class {
    update = progress.update
    setStatus = progress.setStatus
    finish = progress.finish
    isCancelled = progress.isCancelled
  },
}))

const prepareVaultTransfer = vi.fn()
const runVaultTransfer = vi.fn()
const removeMovedSources = vi.fn()
// The barrel is replaced rather than extended: loading its real `deps.ts` pulls in the Supabase
// client, which needs a browser. The pure helpers the command also uses come from their own files.
vi.mock('@/lib/vaultTransfer', async () => ({
  normalizeDestFolder: (await import('@/lib/vaultTransfer/plan')).normalizeDestFolder,
  vaultFoldersOverlap: (await import('@/lib/vaultTransfer/vaultPaths')).vaultFoldersOverlap,
  prepareVaultTransfer,
  runVaultTransfer,
  removeMovedSources,
  createPrepareDeps: () => ({}),
  createTransferDeps: () => ({}),
  createRemovalDeps: () => ({}),
}))

interface StoreState {
  connectedVaults: Array<{ id: string; name: string; localPath: string; isExpanded: boolean }>
  hasPermission: (resource: string, action: string) => boolean
  isOperationRunning: boolean
  operationQueue: unknown[]
}

let storeState: StoreState
vi.mock('@/stores/pdmStore', () => ({ usePDMStore: { getState: () => storeState } }))

vi.stubGlobal('window', { electronAPI: {} })

const { copyToVaultCommand, moveToVaultCommand } = await import('./vaultTransfer')

const SOURCE = 'vault-a'
const DEST = 'vault-b'

function file(relativePath: string, overrides: Partial<LocalFile> = {}): LocalFile {
  return {
    name: relativePath.split('/').pop()!,
    path: `C:/a/${relativePath}`,
    relativePath,
    isDirectory: false,
    extension: '.sldprt',
    size: 10,
    modifiedTime: '',
    ...overrides,
  }
}

function makeContext(overrides: Partial<CommandContext> = {}) {
  const ctx = {
    isOfflineMode: false,
    user: { id: 'user-1' },
    organization: { id: 'org-1' },
    activeVaultId: SOURCE,
    vaultPath: 'C:/a',
    files: [] as LocalFile[],
    processingOperations: new Map<string, string>(),
    silent: false,
    getEffectiveRole: () => 'engineer',
    addToast: vi.fn(),
    addProcessingFoldersSync: vi.fn(),
    removeProcessingFoldersSync: vi.fn(),
    removeFilesFromStore: vi.fn(),
    clearPersistedPendingMetadataForPaths: vi.fn(),
    setLastOperationCompletedAt: vi.fn(),
    onRefresh: vi.fn(),
    ...overrides,
  }
  return ctx as typeof ctx & CommandContext
}

function params(files: LocalFile[], overrides: Record<string, unknown> = {}) {
  return { files, destVaultId: DEST, destFolder: '', keepPath: false, ...overrides }
}

function planFor(files: LocalFile[]) {
  return planVaultTransfer({
    selection: files,
    vaultFiles: files,
    options: { mode: 'copy', destFolder: '', keepPath: false },
    target: { serverPaths: new Set(), diskPaths: new Set(), vaultPath: 'C:/b' },
  })
}

function runOf(results: TransferItemResult[]): TransferRunResult {
  return {
    results,
    foldersCreated: 0,
    folderFailures: [],
    referencesCopied: 0,
    cancelled: false,
  }
}

const NOTHING_REMOVED: RemoveSourcesOutcome = { removed: [], kept: [], foldersRemoved: [] }

beforeEach(() => {
  vi.clearAllMocks()
  storeState = {
    connectedVaults: [
      { id: SOURCE, name: 'Source', localPath: 'C:/a', isExpanded: false },
      { id: DEST, name: 'Archive', localPath: 'C:/b', isExpanded: false },
    ],
    hasPermission: () => true,
    isOperationRunning: false,
    operationQueue: [],
  }
  getAccessibleVaults.mockResolvedValue({ vaults: [{ id: DEST }, { id: SOURCE }] })
})

describe('validate', () => {
  const files = [file('p.sldprt')]
  const validate = copyToVaultCommand.validate!

  it('accepts an ordinary copy', () => {
    expect(validate(params(files), makeContext())).toBeNull()
  })

  it.each([
    ['offline', () => makeContext({ isOfflineMode: true })],
    ['signed out', () => makeContext({ user: null, organization: null })],
    ['no vault open', () => makeContext({ activeVaultId: null, vaultPath: null })],
  ])('refuses when %s', (_name, build) => {
    const message = validate(params(files), build())
    expect(message).toBeTruthy()
    expect(message).not.toContain('contextMenu.')
  })

  it('refuses an empty selection', () => {
    expect(validate(params([]), makeContext())).toBeTruthy()
  })

  it('refuses a destination that is not connected', () => {
    expect(validate(params(files, { destVaultId: 'elsewhere' }), makeContext())).toBeTruthy()
  })

  it('refuses the vault the files are already in', () => {
    expect(validate(params(files, { destVaultId: SOURCE }), makeContext())).toBeTruthy()
  })

  it('refuses vaults whose folders overlap on disk', () => {
    storeState.connectedVaults[1].localPath = 'C:/a/nested'
    expect(validate(params(files), makeContext())).toBeTruthy()
  })

  it.each(['../up', 'C:/abs', 'a//b'])('refuses the destination folder %s', (destFolder) => {
    expect(validate(params(files, { destFolder }), makeContext())).toBeTruthy()
  })

  it('refuses while another file operation is running or queued', () => {
    storeState.isOperationRunning = true
    expect(validate(params(files), makeContext())).toBeTruthy()

    storeState.isOperationRunning = false
    storeState.operationQueue = [{}]
    expect(validate(params(files), makeContext())).toBeTruthy()
  })

  it('refuses files another operation is working on, or inside a folder it is working on', () => {
    const busy = makeContext({ processingOperations: new Map([['parts', 'upload']]) as never })
    expect(validate(params([file('parts/p.sldprt')]), busy)).toBeTruthy()
    expect(validate(params([file('other/p.sldprt')]), busy)).toBeNull()
  })

  it('asks a Move for both permissions and a Copy for only the first', () => {
    storeState.hasPermission = (_resource, action) => action !== 'delete'

    expect(copyToVaultCommand.validate!(params(files), makeContext())).toBeNull()
    expect(moveToVaultCommand.validate!(params(files), makeContext())).toBeTruthy()

    storeState.hasPermission = (_resource, action) => action !== 'create'
    expect(copyToVaultCommand.validate!(params(files), makeContext())).toBeTruthy()
    expect(moveToVaultCommand.validate!(params(files), makeContext())).toBeTruthy()
  })
})

describe('execute', () => {
  const files = [file('p.sldprt'), file('q.sldprt')]

  function prepared() {
    const plan = planFor(files)
    prepareVaultTransfer.mockResolvedValue({ ok: true, plan, serverPaths: new Set() })
    runVaultTransfer.mockResolvedValue(
      runOf(plan.files.map((planned) => ({ planned, status: 'transferred', localCopy: 'copied' }))),
    )
    return plan
  }

  it('refuses a destination the server does not list for this user, before planning', async () => {
    getAccessibleVaults.mockResolvedValue({ vaults: [{ id: SOURCE }] })
    const ctx = makeContext({ files })

    const result = await copyToVaultCommand.execute(params(files), ctx)

    expect(result.success).toBe(false)
    expect(ctx.addToast).toHaveBeenCalledWith('error', expect.any(String))
    expect(prepareVaultTransfer).not.toHaveBeenCalled()
    expect(runVaultTransfer).not.toHaveBeenCalled()
  })

  it('reports why nothing can go instead of running an empty transfer', async () => {
    const plan = planVaultTransfer({
      selection: files,
      vaultFiles: files,
      options: { mode: 'copy', destFolder: '', keepPath: false },
      target: { serverPaths: new Set(['p.sldprt', 'q.sldprt']), diskPaths: new Set(), vaultPath: 'C:/b' },
    })
    prepareVaultTransfer.mockResolvedValue({ ok: true, plan, serverPaths: new Set() })
    const ctx = makeContext({ files })

    const result = await copyToVaultCommand.execute(params(files), ctx)

    expect(result.success).toBe(false)
    expect(runVaultTransfer).not.toHaveBeenCalled()
    expect(ctx.addToast).toHaveBeenCalledWith('warning', expect.stringContaining('Already exists'))
    expect(ctx.addProcessingFoldersSync).not.toHaveBeenCalled()
  })

  it('says so when the destination cannot be planned against', async () => {
    prepareVaultTransfer.mockResolvedValue({ ok: false, failure: 'destination-missing' })
    const ctx = makeContext({ files })

    const result = await copyToVaultCommand.execute(params(files), ctx)

    expect(result.success).toBe(false)
    expect(ctx.addToast).toHaveBeenCalledWith('error', expect.stringContaining('folder'))
    expect(runVaultTransfer).not.toHaveBeenCalled()
  })

  it('leaves the source vault alone on a Copy', async () => {
    prepared()
    const ctx = makeContext({ files })

    const result = await copyToVaultCommand.execute(params(files), ctx)

    expect(result).toMatchObject({ success: true, succeeded: 2 })
    expect(removeMovedSources).not.toHaveBeenCalled()
    expect(beginWatcherSuppression).not.toHaveBeenCalled()
    expect(ctx.removeFilesFromStore).not.toHaveBeenCalled()
    expect(removeFromSyncIndex).not.toHaveBeenCalled()
    expect(ctx.onRefresh).not.toHaveBeenCalled()
    expect(addToSyncIndex).toHaveBeenCalledWith(DEST, ['p.sldprt', 'q.sldprt'])
    expect(ctx.addToast).toHaveBeenCalledWith('success', expect.stringContaining('Archive'))
  })

  it('stays quiet about success when run silently, but not about trouble', async () => {
    prepared()
    const quiet = makeContext({ files, silent: true })
    await copyToVaultCommand.execute(params(files), quiet)
    expect(quiet.addToast).not.toHaveBeenCalled()

    const plan = planFor(files)
    prepareVaultTransfer.mockResolvedValue({ ok: true, plan, serverPaths: new Set() })
    runVaultTransfer.mockResolvedValue(
      runOf(plan.files.map((planned) => ({ planned, status: 'failed', failure: 'source-locked' }))),
    )
    const loud = makeContext({ files, silent: true })
    await copyToVaultCommand.execute(params(files), loud)
    expect(loud.addToast).toHaveBeenCalledWith('error', expect.any(String))
  })

  it('removes sources on a Move only after the run, and takes only what left out of the store', async () => {
    const plan = prepared()
    const [gone, kept] = plan.files
    removeMovedSources.mockResolvedValue({
      removed: [gone],
      kept: [{ planned: kept, reason: 'source-changed' }],
      foldersRemoved: [],
    } satisfies RemoveSourcesOutcome)
    const ctx = makeContext({ files })

    const result = await moveToVaultCommand.execute(params(files), ctx)

    expect(runVaultTransfer.mock.invocationCallOrder[0]).toBeLessThan(
      removeMovedSources.mock.invocationCallOrder[0],
    )
    expect(ctx.removeFilesFromStore).toHaveBeenCalledWith([gone.source.path])
    expect(ctx.clearPersistedPendingMetadataForPaths).toHaveBeenCalledWith([gone.source.path])
    expect(removeFromSyncIndex).toHaveBeenCalledWith(SOURCE, [gone.sourceRelativePath])
    // A source that stayed is not a success, and this vault is asked to look again.
    expect(result.success).toBe(false)
    expect(ctx.onRefresh).toHaveBeenCalledWith(true)
    expect(releaseWatcher).toHaveBeenCalled()
  })

  it('does not touch the store on a Move when nothing was removed', async () => {
    prepared()
    removeMovedSources.mockResolvedValue(NOTHING_REMOVED)
    const ctx = makeContext({ files })

    await moveToVaultCommand.execute(params(files), ctx)

    expect(ctx.removeFilesFromStore).not.toHaveBeenCalled()
    expect(removeFromSyncIndex).not.toHaveBeenCalled()
  })

  it('clears the spinners and finishes the progress toast when the engine throws', async () => {
    prepared()
    runVaultTransfer.mockRejectedValue(new Error('disk gone'))
    const ctx = makeContext({ files })

    await expect(copyToVaultCommand.execute(params(files), ctx)).rejects.toThrow('disk gone')

    expect(ctx.addProcessingFoldersSync).toHaveBeenCalledWith(
      files.map((entry) => entry.relativePath),
      'upload',
    )
    expect(ctx.removeProcessingFoldersSync).toHaveBeenCalledWith(
      files.map((entry) => entry.relativePath),
    )
    expect(progress.finish).toHaveBeenCalled()
    expect(removeMovedSources).not.toHaveBeenCalled()
  })

  it('releases the watcher when the removal throws', async () => {
    prepared()
    removeMovedSources.mockRejectedValue(new Error('boom'))
    const ctx = makeContext({ files })

    await expect(moveToVaultCommand.execute(params(files), ctx)).rejects.toThrow('boom')

    expect(releaseWatcher).toHaveBeenCalled()
    expect(ctx.removeProcessingFoldersSync).toHaveBeenCalled()
    expect(ctx.removeFilesFromStore).not.toHaveBeenCalled()
  })
})
