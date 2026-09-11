import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CommandResult } from '@/lib/commands/types'
import type { LocalFile } from '@/stores/types'
import type { AlignmentPlan } from '@/types/realign'

vi.mock('@/lib/logger', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const executeCommand = vi.fn<(commandId: string, params: unknown) => Promise<CommandResult>>()
vi.mock('@/lib/commands/executor', () => ({ executeCommand }))

const getSyncIndex = vi.fn<(vaultId: string) => Promise<Map<string, { orphanedAt?: number }>>>()
vi.mock('@/lib/cache/localSyncIndex', () => ({ getSyncIndex }))

const isAutomaticDiscardCoolingDown = vi.fn<(vaultId: string) => boolean>()
vi.mock('@/lib/commands/handlers/discardOrphaned', () => ({ isAutomaticDiscardCoolingDown }))

const shouldSkipAutoDiscardForOrphans = vi.fn<
  (input: {
    serverRowCount: number | undefined
    previouslySyncedCount: number
    orphanCount: number
  }) => boolean
>()
const runAutoDiscardForOrphans = vi.fn<
  (
    vaultId: string,
    files: LocalFile[],
    discard: (files: LocalFile[]) => Promise<void>,
  ) => Promise<'skipped-empty' | 'skipped-in-flight' | 'ran'>
>()
vi.mock('@/hooks/useLoadFiles', () => ({
  runAutoDiscardForOrphans,
  shouldSkipAutoDiscardForOrphans,
}))

const repairSyncIndex = vi.fn()
vi.mock('./syncIndexRepair', () => ({ repairSyncIndex }))

const { applyAlignment } = await import('./applyAlignment')

function file(overrides: Partial<LocalFile>): LocalFile {
  return {
    name: overrides.name ?? 'part.sldprt',
    path: overrides.path ?? 'C:/vault/part.sldprt',
    relativePath: overrides.relativePath ?? 'part.sldprt',
    isDirectory: false,
    extension: '.sldprt',
    size: 0,
    modifiedTime: new Date().toISOString(),
    ...overrides,
  } as LocalFile
}

function commandResult(overrides: Partial<CommandResult>): CommandResult {
  return {
    success: true,
    message: 'ok',
    total: 0,
    succeeded: 0,
    failed: 0,
    ...overrides,
  }
}

const FULL_PLAN: AlignmentPlan = {
  resolvePendingMoves: true,
  recycleOrphans: true,
  pullOutdated: true,
  rebuildSyncIndex: true,
}

const NO_PLAN: AlignmentPlan = {
  resolvePendingMoves: false,
  recycleOrphans: false,
  pullOutdated: false,
  rebuildSyncIndex: false,
}

function baseCtx(overrides: Partial<Parameters<typeof applyAlignment>[1]> = {}) {
  return {
    vaultId: 'vault-1',
    files: [] as LocalFile[],
    serverFileCount: 0,
    isOperationRunning: false,
    operationQueueLength: 0,
    onRefresh: vi.fn(),
    ...overrides,
  }
}

describe('applyAlignment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getSyncIndex.mockResolvedValue(new Map())
    isAutomaticDiscardCoolingDown.mockReturnValue(false)
    shouldSkipAutoDiscardForOrphans.mockReturnValue(false)
    repairSyncIndex.mockResolvedValue({
      step: 'rebuildSyncIndex',
      attempted: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      outcome: 'nothing-to-do',
    })
  })

  it('runs every ticked step in the fixed order and refreshes exactly once', async () => {
    const callOrder: string[] = []

    executeCommand.mockImplementation(async (commandId) => {
      callOrder.push(commandId)
      if (commandId === 'adopt-server-paths') {
        return commandResult({ total: 2, succeeded: 2 })
      }
      if (commandId === 'discard-orphaned') {
        return commandResult({ total: 1, succeeded: 1 })
      }
      if (commandId === 'get-latest') {
        return commandResult({ total: 1, succeeded: 1 })
      }
      return commandResult({})
    })

    runAutoDiscardForOrphans.mockImplementation(async (_vaultId, files, discard) => {
      callOrder.push('runAutoDiscardForOrphans')
      await discard(files)
      return 'ran'
    })

    repairSyncIndex.mockImplementation(async () => {
      callOrder.push('rebuildSyncIndex')
      return {
        step: 'rebuildSyncIndex',
        attempted: 1,
        succeeded: 1,
        failed: 0,
        skipped: 0,
        outcome: 'ok',
      }
    })

    const orphan = file({ name: 'gone.sldprt', relativePath: 'gone.sldprt', diffStatus: 'deleted_remote' })
    const outdated = file({
      name: 'old.sldprt',
      relativePath: 'old.sldprt',
      diffStatus: 'outdated',
    })
    const onRefresh = vi.fn()

    const ctx = baseCtx({ files: [orphan, outdated], onRefresh })
    const outcome = await applyAlignment(FULL_PLAN, ctx)

    expect(callOrder).toEqual([
      'adopt-server-paths',
      'runAutoDiscardForOrphans',
      'discard-orphaned',
      'get-latest',
      'rebuildSyncIndex',
    ])
    expect(outcome.aborted).toBe(false)
    expect(outcome.steps.map((s) => s.step)).toEqual([
      'resolvePendingMoves',
      'recycleOrphans',
      'pullOutdated',
      'rebuildSyncIndex',
    ])
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('aborts before running anything when another operation is in flight', async () => {
    const onRefresh = vi.fn()
    const ctx = baseCtx({ isOperationRunning: true, onRefresh })

    const outcome = await applyAlignment(FULL_PLAN, ctx)

    expect(outcome.aborted).toBe(true)
    expect(outcome.abortReason).toBe('operation-in-flight')
    expect(outcome.steps).toEqual([])
    expect(executeCommand).not.toHaveBeenCalled()
    expect(onRefresh).not.toHaveBeenCalled()
  })

  it('aborts before running anything when the queue is non-empty even if not marked running', async () => {
    const ctx = baseCtx({ operationQueueLength: 1 })

    const outcome = await applyAlignment(FULL_PLAN, ctx)

    expect(outcome.aborted).toBe(true)
    expect(outcome.abortReason).toBe('operation-in-flight')
    expect(executeCommand).not.toHaveBeenCalled()
  })

  it('aborts with no-vault when there is no active vault', async () => {
    const ctx = baseCtx({ vaultId: null })

    const outcome = await applyAlignment(FULL_PLAN, ctx)

    expect(outcome.aborted).toBe(true)
    expect(outcome.abortReason).toBe('no-vault')
    expect(executeCommand).not.toHaveBeenCalled()
  })

  it('reports nothing-to-do for a step whose plan flag is off, without calling its command', async () => {
    const ctx = baseCtx()
    const outcome = await applyAlignment(NO_PLAN, ctx)

    expect(outcome.aborted).toBe(false)
    expect(outcome.steps).toEqual([])
    expect(executeCommand).not.toHaveBeenCalled()
    expect(repairSyncIndex).not.toHaveBeenCalled()
  })

  describe('orphan guards refuse independently', () => {
    it('refuses when the cooldown guard is active', async () => {
      isAutomaticDiscardCoolingDown.mockReturnValue(true)
      const orphan = file({ diffStatus: 'deleted_remote' })
      const ctx = baseCtx({ files: [orphan] })

      const outcome = await applyAlignment(
        { ...NO_PLAN, recycleOrphans: true },
        ctx,
      )

      const step = outcome.steps.find((s) => s.step === 'recycleOrphans')
      expect(step?.outcome).toBe('refused')
      expect(step?.detail).toBe('cooling-down')
      expect(executeCommand).not.toHaveBeenCalled()
      expect(runAutoDiscardForOrphans).not.toHaveBeenCalled()
    })

    it('refuses when the blast-radius guard trips', async () => {
      shouldSkipAutoDiscardForOrphans.mockReturnValue(true)
      const orphan = file({ diffStatus: 'deleted_remote' })
      const ctx = baseCtx({ files: [orphan], serverFileCount: 0 })

      const outcome = await applyAlignment(
        { ...NO_PLAN, recycleOrphans: true },
        ctx,
      )

      const step = outcome.steps.find((s) => s.step === 'recycleOrphans')
      expect(step?.outcome).toBe('refused')
      expect(step?.detail).toBe('blast-radius-guard')
      expect(executeCommand).not.toHaveBeenCalled()
    })

    it('refuses when another automatic discard is already running for this vault', async () => {
      runAutoDiscardForOrphans.mockResolvedValue('skipped-in-flight')
      const orphan = file({ diffStatus: 'deleted_remote' })
      const ctx = baseCtx({ files: [orphan] })

      const outcome = await applyAlignment(
        { ...NO_PLAN, recycleOrphans: true },
        ctx,
      )

      const step = outcome.steps.find((s) => s.step === 'recycleOrphans')
      expect(step?.outcome).toBe('refused')
      expect(step?.detail).toBe('re-entrant')
    })

    it('reports nothing-to-do when there are no orphans at all', async () => {
      const ctx = baseCtx({ files: [file({ diffStatus: undefined })] })

      const outcome = await applyAlignment({ ...NO_PLAN, recycleOrphans: true }, ctx)

      const step = outcome.steps.find((s) => s.step === 'recycleOrphans')
      expect(step?.outcome).toBe('nothing-to-do')
      expect(isAutomaticDiscardCoolingDown).not.toHaveBeenCalled()
      expect(runAutoDiscardForOrphans).not.toHaveBeenCalled()
    })
  })

  it('records a partial failure as "partial" rather than swallowing it', async () => {
    executeCommand.mockResolvedValue(
      commandResult({ success: false, total: 5, succeeded: 3, failed: 2, message: '3/5 updated' }),
    )
    const outdated = file({ diffStatus: 'outdated' })
    const ctx = baseCtx({ files: [outdated] })

    const outcome = await applyAlignment({ ...NO_PLAN, pullOutdated: true }, ctx)

    const step = outcome.steps.find((s) => s.step === 'pullOutdated')
    expect(step?.outcome).toBe('partial')
    expect(step?.succeeded).toBe(3)
    expect(step?.failed).toBe(2)
    expect(outcome.aborted).toBe(false)
  })

  it('excludes outdated files that are checked out by anyone from get-latest', async () => {
    const checkedOut = file({
      relativePath: 'locked.sldprt',
      diffStatus: 'outdated',
      pdmData: { id: 'f1', checked_out_by: 'someone-else' } as LocalFile['pdmData'],
    })
    const free = file({ relativePath: 'free.sldprt', diffStatus: 'outdated' })
    executeCommand.mockResolvedValue(commandResult({ total: 1, succeeded: 1 }))

    const ctx = baseCtx({ files: [checkedOut, free] })
    await applyAlignment({ ...NO_PLAN, pullOutdated: true }, ctx)

    expect(executeCommand).toHaveBeenCalledWith(
      'get-latest',
      { files: [free] },
    )
  })

  it('stops the remaining steps and reports an unexpected-error abort on a thrown error', async () => {
    executeCommand.mockRejectedValueOnce(new Error('boom'))
    const onRefresh = vi.fn()
    const ctx = baseCtx({ onRefresh })

    const outcome = await applyAlignment(FULL_PLAN, ctx)

    expect(outcome.aborted).toBe(true)
    expect(outcome.abortReason).toBe('unexpected-error')
    expect(outcome.steps).toEqual([])
    expect(runAutoDiscardForOrphans).not.toHaveBeenCalled()
    expect(repairSyncIndex).not.toHaveBeenCalled()
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('does not call reconcile-moved-paths when pendingMoveActions is omitted (legacy all-adopt)', async () => {
    executeCommand.mockResolvedValue(commandResult({}))
    const ctx = baseCtx()

    await applyAlignment(FULL_PLAN, ctx)

    expect(executeCommand).toHaveBeenCalledWith('adopt-server-paths', { apply: true })
    for (const call of executeCommand.mock.calls) {
      expect(call[0]).not.toBe('reconcile-moved-paths')
    }
  })

  it('does not call reconcile-moved-paths when every named decision is adopt', async () => {
    executeCommand.mockResolvedValue(commandResult({ total: 2, succeeded: 2 }))
    const ctx = baseCtx()

    await applyAlignment(
      {
        ...NO_PLAN,
        resolvePendingMoves: true,
        pendingMoveActions: { 'id-a': 'adopt', 'id-b': 'adopt' },
      },
      ctx,
    )

    expect(executeCommand).toHaveBeenCalledTimes(1)
    expect(executeCommand).toHaveBeenCalledWith('adopt-server-paths', {
      apply: true,
      fileIds: ['id-a', 'id-b'],
    })
  })

  it('calls reconcile-moved-paths with exactly the keep-local fileIds, after adopt', async () => {
    const callOrder: string[] = []
    executeCommand.mockImplementation(async (commandId) => {
      callOrder.push(commandId)
      return commandResult({ total: 1, succeeded: 1 })
    })
    const ctx = baseCtx()

    const outcome = await applyAlignment(
      {
        ...NO_PLAN,
        resolvePendingMoves: true,
        pendingMoveActions: { 'id-keep-server': 'adopt', 'id-keep-local': 'reconcile' },
      },
      ctx,
    )

    expect(callOrder).toEqual(['adopt-server-paths', 'reconcile-moved-paths'])
    expect(executeCommand).toHaveBeenNthCalledWith(1, 'adopt-server-paths', {
      apply: true,
      fileIds: ['id-keep-server'],
    })
    expect(executeCommand).toHaveBeenNthCalledWith(2, 'reconcile-moved-paths', {
      apply: true,
      fileIds: ['id-keep-local'],
      skipCheckedOut: true,
    })

    const step = outcome.steps.find((s) => s.step === 'resolvePendingMoves')
    expect(step?.outcome).toBe('ok')
    expect(step?.attempted).toBe(2)
    expect(step?.succeeded).toBe(2)
  })

  it('calls only reconcile-moved-paths when every named decision is keep-local', async () => {
    executeCommand.mockResolvedValue(commandResult({ total: 1, succeeded: 1 }))
    const ctx = baseCtx()

    await applyAlignment(
      {
        ...NO_PLAN,
        resolvePendingMoves: true,
        pendingMoveActions: { 'id-keep-local': 'reconcile' },
      },
      ctx,
    )

    expect(executeCommand).toHaveBeenCalledTimes(1)
    expect(executeCommand).toHaveBeenCalledWith('reconcile-moved-paths', {
      apply: true,
      fileIds: ['id-keep-local'],
      skipCheckedOut: true,
    })
  })

  it('reports nothing-to-do when pendingMoveActions is present but empty', async () => {
    const ctx = baseCtx()

    const outcome = await applyAlignment(
      { ...NO_PLAN, resolvePendingMoves: true, pendingMoveActions: {} },
      ctx,
    )

    const step = outcome.steps.find((s) => s.step === 'resolvePendingMoves')
    expect(step?.outcome).toBe('nothing-to-do')
    expect(executeCommand).not.toHaveBeenCalled()
  })
})
