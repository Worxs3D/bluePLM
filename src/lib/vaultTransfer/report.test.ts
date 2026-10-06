import { describe, expect, it } from 'vitest'

import type { LocalFile } from '@/stores/types'

import type { TransferItemResult, TransferRunResult } from './execute'
import { planVaultTransfer } from './plan'
import type { RemoveSourcesOutcome } from './removeSources'
import { buildTransferReport } from './report'

function file(relativePath: string, overrides: Partial<LocalFile> = {}): LocalFile {
  return {
    name: relativePath,
    path: `C:\\a\\${relativePath}`,
    relativePath,
    isDirectory: false,
    extension: '.sldprt',
    size: 1,
    modifiedTime: '',
    diffStatus: 'added',
    ...overrides,
  }
}

function plan(files: LocalFile[]) {
  return planVaultTransfer({
    selection: files,
    vaultFiles: files,
    options: { mode: 'copy', destFolder: '', keepPath: false },
    target: { serverPaths: new Set(), diskPaths: new Set(), vaultPath: 'C:\\b' },
  })
}

function run(results: TransferItemResult[], overrides: Partial<TransferRunResult> = {}) {
  return {
    results,
    foldersCreated: 0,
    folderFailures: [],
    referencesCopied: 0,
    cancelled: false,
    ...overrides,
  } satisfies TransferRunResult
}

describe('buildTransferReport', () => {
  const planned = plan([file('a.SLDPRT'), file('b.SLDPRT')])
  const [a, b] = planned.files

  it('is a success only when nothing was left undone', () => {
    const report = buildTransferReport(
      planned,
      run([
        { planned: a, status: 'transferred', localCopy: 'copied' },
        { planned: b, status: 'transferred', localCopy: 'copied' },
      ]),
      null,
    )

    expect(report).toMatchObject({ transferred: 2, placedOnDisk: 2, severity: 'success' })
  })

  it('is a warning when some files arrived and one did not', () => {
    const report = buildTransferReport(
      planned,
      run([
        { planned: a, status: 'transferred', localCopy: 'copied' },
        { planned: b, status: 'failed', failure: 'source-locked' },
      ]),
      null,
    )

    expect(report.severity).toBe('warning')
    expect(report.failures).toEqual([
      { relativePath: 'b.SLDPRT', failure: 'source-locked', message: undefined },
    ])
  })

  it('is an error when nothing arrived', () => {
    const report = buildTransferReport(
      planned,
      run([
        { planned: a, status: 'failed', failure: 'server-error' },
        { planned: b, status: 'failed', failure: 'server-error' },
      ]),
      null,
    )

    expect(report.severity).toBe('error')
    expect(report.transferred).toBe(0)
  })

  it('counts cancelled files apart from failures', () => {
    const report = buildTransferReport(
      planned,
      run(
        [
          { planned: a, status: 'transferred', localCopy: 'copied' },
          { planned: b, status: 'failed', failure: 'cancelled' },
        ],
        { cancelled: true },
      ),
      null,
    )

    expect(report.cancelled).toBe(1)
    expect(report.failures).toHaveLength(0)
    expect(report.severity).toBe('warning')
  })

  it('does not call a run a success when a file was skipped', () => {
    const withSkip = plan([file('a.SLDPRT'), file('b.SLDPRT', { diffStatus: 'outdated' })])

    const report = buildTransferReport(
      withSkip,
      run([{ planned: withSkip.files[0], status: 'transferred', localCopy: 'copied' }]),
      null,
    )

    expect(report.skipped).toHaveLength(1)
    expect(report.severity).toBe('warning')
  })

  it('names files whose local copy did not make it', () => {
    const report = buildTransferReport(
      planned,
      run([
        { planned: a, status: 'transferred', localCopy: 'failed' },
        { planned: b, status: 'transferred', localCopy: 'diverged' },
      ]),
      null,
    )

    expect(report.placedOnDisk).toBe(0)
    expect(report.localCopyProblems).toEqual([
      { relativePath: 'a.SLDPRT', outcome: 'failed' },
      { relativePath: 'b.SLDPRT', outcome: 'diverged' },
    ])
    expect(report.severity).toBe('warning')
  })

  it('does not count a cloud-only transfer as placed on disk, or as a problem', () => {
    const report = buildTransferReport(
      planned,
      run([
        { planned: a, status: 'transferred', localCopy: 'not-needed' },
        { planned: b, status: 'transferred', localCopy: 'not-needed' },
      ]),
      null,
    )

    expect(report).toMatchObject({ placedOnDisk: 0, severity: 'success' })
  })

  it('carries a move that left sources behind as a warning', () => {
    const removal: RemoveSourcesOutcome = {
      removed: [a],
      kept: [{ planned: b, reason: 'local-delete-failed' }],
      foldersRemoved: [],
    }

    const report = buildTransferReport(
      planned,
      run([
        { planned: a, status: 'transferred', localCopy: 'copied' },
        { planned: b, status: 'transferred', localCopy: 'copied' },
      ]),
      removal,
    )

    expect(report).toMatchObject({ removed: 1, severity: 'warning' })
    expect(report.keptInSource).toHaveLength(1)
  })

  it('treats folder and reference problems as something the user should hear about', () => {
    const results: TransferItemResult[] = [
      { planned: a, status: 'transferred', localCopy: 'copied' },
      { planned: b, status: 'transferred', localCopy: 'copied' },
    ]

    expect(buildTransferReport(planned, run(results, { folderFailures: ['In'] }), null).severity).toBe(
      'warning',
    )
    expect(
      buildTransferReport(planned, run(results, { referenceError: 'rls' }), null).severity,
    ).toBe('warning')
  })

  it('succeeds for a selection of only empty folders', () => {
    const empty = { ...plan([]), folders: ['In/Empty'] }

    const report = buildTransferReport(empty, run([], { foldersCreated: 1 }), null)

    expect(report.severity).toBe('success')
  })
})
