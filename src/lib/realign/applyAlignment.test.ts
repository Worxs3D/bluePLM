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

// Pinned by mutation testing (.cursor/plans/test-mutation-report.md): the outcome mapping, the
// two-command merge for mixed move decisions, and which rows each step hands to its command.
describe('applyAlignment step results', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getSyncIndex.mockResolvedValue(new Map())
    isAutomaticDiscardCoolingDown.mockReturnValue(false)
    shouldSkipAutoDiscardForOrphans.mockReturnValue(false)
  })

  async function pullOutdatedStep(result: CommandResult) {
    executeCommand.mockResolvedValue(result)
    const outcome = await applyAlignment(
      { ...NO_PLAN, pullOutdated: true },
      baseCtx({ files: [file({ diffStatus: 'outdated' })] }),
    )
    return outcome.steps.find((s) => s.step === 'pullOutdated')
  }

  it.each([
    ['nothing-to-do', commandResult({ total: 0 }), 0],
    // Work found but none attempted: a refusal, every candidate skipped.
    ['refused', commandResult({ total: 2 }), 2],
    ['ok', commandResult({ total: 2, succeeded: 2 }), 0],
    ['failed', commandResult({ success: false, total: 2, failed: 2 }), 0],
    // Something succeeded but the command did not report success: never "ok".
    ['partial', commandResult({ success: false, total: 2, succeeded: 2 }), 0],
  ])('reports %s for its command result', async (expected, result, skipped) => {
    const step = await pullOutdatedStep(result)

    expect(step?.outcome).toBe(expected)
    expect(step?.attempted).toBe(result.total)
    expect(step?.skipped).toBe(skipped)
    expect(step?.detail).toBe('ok')
  })

  it("keeps the command's own skipped count over the refusal default", async () => {
    const step = await pullOutdatedStep(commandResult({ total: 3, skipped: 1 }))

    expect(step?.outcome).toBe('refused')
    expect(step?.skipped).toBe(1)
  })

  it('adds up adopt and keep-local results into one step', async () => {
    executeCommand.mockImplementation(async (commandId) =>
      commandId === 'adopt-server-paths'
        ? commandResult({ total: 2, succeeded: 2, skipped: 1, message: 'adopted 2' })
        : commandResult({ success: false, total: 3, succeeded: 1, failed: 2, skipped: 2, message: 'kept 1' }),
    )

    const outcome = await applyAlignment(
      {
        ...NO_PLAN,
        resolvePendingMoves: true,
        pendingMoveActions: { a: 'adopt', b: 'reconcile' },
      },
      baseCtx(),
    )

    expect(outcome.steps.find((s) => s.step === 'resolvePendingMoves')).toMatchObject({
      outcome: 'partial',
      attempted: 5,
      succeeded: 3,
      failed: 2,
      skipped: 3,
      detail: 'adopted 2; kept 1',
    })
  })

  it('is not ok when only one of the two move commands succeeded', async () => {
    executeCommand.mockImplementation(async (commandId) =>
      commandId === 'adopt-server-paths'
        ? commandResult({ total: 1, succeeded: 1, message: '' })
        : commandResult({ success: false, total: 1, succeeded: 1, message: 'kept 1' }),
    )

    const outcome = await applyAlignment(
      { ...NO_PLAN, resolvePendingMoves: true, pendingMoveActions: { a: 'adopt', b: 'reconcile' } },
      baseCtx(),
    )

    const step = outcome.steps.find((s) => s.step === 'resolvePendingMoves')
    expect(step?.outcome).toBe('partial')
    expect(step?.detail).toBe('kept 1')
  })

  it('pulls only outdated files, never folders or files in another state', async () => {
    const outdated = file({ relativePath: 'old.sldprt', diffStatus: 'outdated' })
    const files = [
      outdated,
      file({ relativePath: 'edited.sldprt', diffStatus: 'modified' }),
      file({ relativePath: 'synced.sldprt', diffStatus: undefined }),
      file({ relativePath: 'Folder', isDirectory: true, diffStatus: 'outdated' }),
    ]
    executeCommand.mockResolvedValue(commandResult({ total: 1, succeeded: 1 }))

    await applyAlignment({ ...NO_PLAN, pullOutdated: true }, baseCtx({ files }))

    expect(executeCommand).toHaveBeenCalledTimes(1)
    expect(executeCommand).toHaveBeenCalledWith('get-latest', { files: [outdated] })
  })

  it('does not call get-latest when nothing is outdated', async () => {
    const outcome = await applyAlignment(
      { ...NO_PLAN, pullOutdated: true },
      baseCtx({ files: [file({ diffStatus: 'modified' })] }),
    )

    expect(executeCommand).not.toHaveBeenCalled()
    expect(outcome.steps.find((s) => s.step === 'pullOutdated')?.outcome).toBe('nothing-to-do')
  })

  it('recycles orphans through the automatic discard path, never the user-initiated one', async () => {
    const orphan = file({ relativePath: 'gone.sldprt', diffStatus: 'deleted_remote' })
    const folder = file({ relativePath: 'GoneFolder', isDirectory: true, diffStatus: 'deleted_remote' })
    runAutoDiscardForOrphans.mockImplementation(async (_vaultId, files, discard) => {
      await discard(files)
      return 'ran'
    })
    executeCommand.mockResolvedValue(commandResult({ total: 1, succeeded: 1 }))

    const outcome = await applyAlignment(
      { ...NO_PLAN, recycleOrphans: true },
      baseCtx({ files: [orphan, folder] }),
    )

    expect(runAutoDiscardForOrphans).toHaveBeenCalledWith('vault-1', [orphan], expect.any(Function))
    expect(executeCommand).toHaveBeenCalledWith('discard-orphaned', { files: [orphan], isAutomatic: true })
    expect(outcome.steps.find((s) => s.step === 'recycleOrphans')?.outcome).toBe('ok')
  })

  it.each([
    ['the discard runner found nothing', 'skipped-empty' as const],
    ['the discard runner never called the command', 'ran' as const],
  ])('reports nothing-to-do when %s', async (_label, runResult) => {
    runAutoDiscardForOrphans.mockResolvedValue(runResult)

    const outcome = await applyAlignment(
      { ...NO_PLAN, recycleOrphans: true },
      baseCtx({ files: [file({ diffStatus: 'deleted_remote' })] }),
    )

    expect(outcome.steps.find((s) => s.step === 'recycleOrphans')?.outcome).toBe('nothing-to-do')
  })
})
