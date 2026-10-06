import { describe, expect, it } from 'vitest'

import type { LocalFile } from '@/stores/types'
import type { PDMFile } from '@/types/pdm'

import {
  canRemoveSource,
  isSourceRowUnchanged,
  runVaultTransfer,
  type InsertDestinationFileArgs,
  type TransferEngineDeps,
  type TransferItemResult,
} from './execute'
import { planVaultTransfer } from './plan'
import type { VaultTransferPlan } from './types'

function pdm(id: string, overrides: Partial<PDMFile> = {}): PDMFile {
  return {
    id,
    org_id: 'org',
    vault_id: 'vault-a',
    file_path: '',
    file_name: '',
    extension: '.sldprt',
    file_type: 'part',
    part_number: 'PN-1',
    description: null,
    revision: 'A',
    version: 4,
    workflow_state_id: null,
    state_changed_at: null,
    state_changed_by: null,
    checked_out_by: null,
    checked_out_at: null,
    lock_message: null,
    checked_out_by_machine_id: null,
    checked_out_by_machine_name: null,
    checked_out_file_path: null,
    checked_out_file_name: null,
    content_hash: `hash-${id}`,
    file_size: 100,
    created_at: null,
    created_by: 'user',
    updated_at: null,
    updated_by: null,
    custom_properties: null,
    deleted_at: null,
    deleted_by: null,
    ...overrides,
  }
}

function file(relativePath: string, overrides: Partial<LocalFile> = {}, tracked = true): LocalFile {
  return {
    name: relativePath.split('/').pop() ?? relativePath,
    path: `C:\\vault-a\\${relativePath.replace(/\//g, '\\')}`,
    relativePath,
    isDirectory: false,
    extension: '.sldprt',
    size: 100,
    modifiedTime: '',
    ...(tracked ? { pdmData: pdm(`id-${relativePath}`) } : {}),
    ...overrides,
  }
}

function planFor(selection: LocalFile[], destFolder = 'In'): VaultTransferPlan {
  return planVaultTransfer({
    selection,
    vaultFiles: selection,
    options: { mode: 'copy', destFolder, keepPath: false },
    target: { serverPaths: new Set(), diskPaths: new Set(), vaultPath: 'C:\\vault-b' },
  })
}

/** An in-memory pair of vaults with switches for each way a step can go wrong. */
class World {
  /** Content on the source disk by absolute path. Defaults to the row's own hash. */
  sourceDisk = new Map<string, { hash: string; data: string }>()
  destServer = new Map<string, InsertDestinationFileArgs>()
  destDisk = new Map<string, string>()
  destFolders = new Set<string>()
  destFoldersOnDisk = new Set<string>()
  protectedFiles = new Set<string>()
  calls: string[] = []
  referenceCalls: Array<Array<{ sourceFileId: string; destFileId: string }>> = []

  lockedSources = new Set<string>()
  takenOnDisk = new Set<string>()
  takenOnServer = new Set<string>()
  failingInserts = new Set<string>()
  failingCopies = new Set<string>()
  /** Destination path -> hash the copy will actually have, for a source that changed. */
  corruptCopies = new Map<string, string>()
  failingServerFolders = new Set<string>()
  cancelAfter = Number.POSITIVE_INFINITY
  started = 0

  seed(source: LocalFile, hash = source.pdmData?.content_hash ?? `local-${source.name}`) {
    this.sourceDisk.set(source.path, { hash, data: `bytes-of-${source.name}` })
  }

  deps(): TransferEngineDeps {
    let nextId = 1
    return {
      readSource: async (absolutePath) => {
        this.calls.push(`read:${absolutePath}`)
        if (this.lockedSources.has(absolutePath)) return { success: false, locked: true }
        const content = this.sourceDisk.get(absolutePath)
        if (!content) return { success: false }
        return { success: true, data: content.data, hash: content.hash, size: 321 }
      },
      destinationFileExists: async (destRelativePath) =>
        this.takenOnDisk.has(destRelativePath) || this.destDisk.has(destRelativePath),
      insertDestinationFile: async (args) => {
        this.calls.push(`insert:${args.destRelativePath}`)
        if (this.failingInserts.has(args.destRelativePath)) {
          return { ok: false, reason: 'error', message: 'boom' }
        }
        if (
          this.takenOnServer.has(args.destRelativePath) ||
          this.destServer.has(args.destRelativePath)
        ) {
          return { ok: false, reason: 'exists' }
        }
        this.destServer.set(args.destRelativePath, args)
        return { ok: true, fileId: `dest-${nextId++}`, version: 1 }
      },
      copyToDestination: async (sourceAbsolutePath, destRelativePath) => {
        this.calls.push(`copy:${destRelativePath}`)
        if (this.failingCopies.has(destRelativePath)) {
          this.destDisk.set(destRelativePath, 'partial')
          return { success: false, error: 'disk full' }
        }
        const content = this.sourceDisk.get(sourceAbsolutePath)
        this.destDisk.set(
          destRelativePath,
          this.corruptCopies.get(destRelativePath) ?? content?.hash ?? 'unknown',
        )
        return { success: true }
      },
      hashDestination: async (destRelativePath) => this.destDisk.get(destRelativePath) ?? null,
      removeFromDestination: async (destRelativePath) => {
        this.calls.push(`remove:${destRelativePath}`)
        this.destDisk.delete(destRelativePath)
      },
      protectDestination: async (destRelativePath) => {
        this.protectedFiles.add(destRelativePath)
      },
      createDestinationFolderOnDisk: async (destRelativePath) => {
        this.destFoldersOnDisk.add(destRelativePath)
        return true
      },
      createDestinationFolderOnServer: async (destRelativePath) => {
        this.calls.push(`folder:${destRelativePath}`)
        if (this.failingServerFolders.has(destRelativePath)) return false
        this.destFolders.add(destRelativePath)
        return true
      },
      copyReferences: async (pairs) => {
        this.referenceCalls.push([...pairs])
        return { copied: pairs.length, error: undefined }
      },
      isCancelled: () => this.started >= this.cancelAfter,
      onItemDone: () => {},
    }
  }

  /** Counts each file as it begins, so cancellation can take effect part-way through. */
  withProgress(deps: TransferEngineDeps): TransferEngineDeps {
    const insert = deps.insertDestinationFile
    return {
      ...deps,
      insertDestinationFile: async (args) => {
        const result = await insert(args)
        this.started++
        return result
      },
    }
  }
}

async function run(world: World, plan: VaultTransferPlan) {
  // One at a time, so ordering assertions and cancellation are deterministic.
  return runVaultTransfer(plan, world.withProgress(world.deps()), 1)
}

describe('a cloud-only file', () => {
  it('gets a row that points at the stored content and nothing on disk', async () => {
    const cloud = file('Parts/a.SLDPRT', { diffStatus: 'cloud', size: 0 })
    const world = new World()

    const { results } = await run(world, planFor([cloud]))

    expect(results[0]).toMatchObject({ status: 'transferred', localCopy: 'not-needed' })
    expect(world.destServer.get('In/a.SLDPRT')).toMatchObject({
      hash: 'hash-id-Parts/a.SLDPRT',
      base64: null,
      size: 100,
    })
    expect(world.destDisk.size).toBe(0)
    expect(world.calls.some((call) => call.startsWith('read:') || call.startsWith('copy:'))).toBe(
      false,
    )
  })
})

describe('an unchanged checked-in file', () => {
  it('creates the row first, then copies and verifies the local file', async () => {
    const synced = file('a.SLDPRT')
    const world = new World()
    world.seed(synced)

    const { results } = await run(world, planFor([synced]))

    expect(results[0]).toMatchObject({ status: 'transferred', localCopy: 'copied' })
    expect(world.calls.indexOf('insert:In/a.SLDPRT')).toBeLessThan(
      world.calls.indexOf('copy:In/a.SLDPRT'),
    )
    // The bytes are already stored, so none are read or uploaded.
    expect(world.destServer.get('In/a.SLDPRT')?.base64).toBeNull()
    expect(world.calls.some((call) => call.startsWith('read:'))).toBe(false)
    expect(world.protectedFiles.has('In/a.SLDPRT')).toBe(true)
  })

  it('carries the metadata and asks for the source version history', async () => {
    const synced = file('a.SLDPRT')
    const world = new World()
    world.seed(synced)

    await run(world, planFor([synced]))

    expect(world.destServer.get('In/a.SLDPRT')).toMatchObject({
      name: 'a.SLDPRT',
      extension: '.sldprt',
      copiedFromFileId: 'id-a.SLDPRT',
      metadata: { partNumber: 'PN-1', revision: 'A' },
    })
  })
})

describe('a file the server has never seen, or one that was edited', () => {
  it('reads and uploads what is on disk and records its real size', async () => {
    const added = file('a.SLDPRT', { diffStatus: 'added' }, false)
    const world = new World()
    world.seed(added, 'disk-hash')

    const { results } = await run(world, planFor([added]))

    expect(results[0]).toMatchObject({ status: 'transferred', localCopy: 'copied' })
    expect(world.destServer.get('In/a.SLDPRT')).toMatchObject({
      hash: 'disk-hash',
      base64: 'bytes-of-a.SLDPRT',
      size: 321,
      copiedFromFileId: null,
    })
  })

  it('names a locked file and touches nothing in the destination', async () => {
    const added = file('a.SLDPRT', { diffStatus: 'added' }, false)
    const world = new World()
    world.seed(added)
    world.lockedSources.add(added.path)

    const { results } = await run(world, planFor([added]))

    expect(results[0]).toMatchObject({ status: 'failed', failure: 'source-locked' })
    expect(world.destServer.size).toBe(0)
    expect(world.destDisk.size).toBe(0)
  })

  it('reports an unreadable file as such', async () => {
    const added = file('a.SLDPRT', { diffStatus: 'added' }, false)

    const { results } = await run(new World(), planFor([added]))

    expect(results[0]).toMatchObject({ status: 'failed', failure: 'source-unreadable' })
  })
})

describe('a path that is taken', () => {
  it('leaves a file already on the destination disk alone and creates no row', async () => {
    const synced = file('a.SLDPRT')
    const world = new World()
    world.seed(synced)
    world.takenOnDisk.add('In/a.SLDPRT')

    const { results } = await run(world, planFor([synced]))

    expect(results[0]).toMatchObject({ status: 'failed', failure: 'exists-on-disk' })
    expect(world.destServer.size).toBe(0)
    expect(world.calls.some((call) => call.startsWith('copy:') || call.startsWith('remove:'))).toBe(
      false,
    )
  })

  it('stops at the row when the database says the path was taken in the meantime', async () => {
    const synced = file('a.SLDPRT')
    const world = new World()
    world.seed(synced)
    world.takenOnServer.add('In/a.SLDPRT')

    const { results } = await run(world, planFor([synced]))

    expect(results[0]).toMatchObject({ status: 'failed', failure: 'exists-in-destination' })
    // Nothing reached the destination's disk, so there is nothing to clean up.
    expect(world.destDisk.size).toBe(0)
    expect(world.calls.some((call) => call.startsWith('copy:'))).toBe(false)
  })

  it('does not let one refusal stop the files after it', async () => {
    const first = file('a.SLDPRT')
    const second = file('b.SLDPRT')
    const world = new World()
    world.seed(first)
    world.seed(second)
    world.failingInserts.add('In/a.SLDPRT')

    const { results } = await run(world, planFor([first, second]))

    expect(results.map((result) => result.status)).toEqual(['failed', 'transferred'])
    expect(results[0]).toMatchObject({ failure: 'server-error', message: 'boom' })
  })
})

describe('a local copy that goes wrong after the row exists', () => {
  it('removes a partial file, keeps the row, and says the source must stay', async () => {
    const synced = file('a.SLDPRT')
    const world = new World()
    world.seed(synced)
    world.failingCopies.add('In/a.SLDPRT')

    const { results } = await run(world, planFor([synced]))

    expect(results[0]).toMatchObject({ status: 'transferred', localCopy: 'failed' })
    expect(world.destServer.has('In/a.SLDPRT')).toBe(true)
    expect(world.destDisk.has('In/a.SLDPRT')).toBe(false)
    expect(canRemoveSource(results[0])).toBe(false)
  })

  it('discards a copy whose hash is not the one that was transferred', async () => {
    // The file on disk changed after the vault last looked at it. The row holds the old content,
    // and the new content on disk must not be deleted from the source as if it had moved.
    const synced = file('a.SLDPRT')
    const world = new World()
    world.seed(synced)
    world.corruptCopies.set('In/a.SLDPRT', 'someone-edited-it')

    const { results } = await run(world, planFor([synced]))

    expect(results[0]).toMatchObject({ status: 'transferred', localCopy: 'diverged' })
    expect(world.destDisk.has('In/a.SLDPRT')).toBe(false)
    expect(world.protectedFiles.size).toBe(0)
    expect(canRemoveSource(results[0])).toBe(false)
  })

  it('treats an unverifiable copy as failed rather than diverged', async () => {
    const synced = file('a.SLDPRT')
    const world = new World()
    world.seed(synced)
    const deps = world.deps()
    deps.hashDestination = async () => null

    const { results } = await runVaultTransfer(planFor([synced]), deps, 1)

    expect(results[0]).toMatchObject({ localCopy: 'failed' })
    expect(canRemoveSource(results[0])).toBe(false)
  })
})

describe('which sources a move may remove', () => {
  const planned = planFor([file('a.SLDPRT')]).files[0]

  function result(overrides: Partial<TransferItemResult>): TransferItemResult {
    return { planned, status: 'transferred', ...overrides }
  }

  it('allows a verified local copy and a cloud-only transfer', () => {
    expect(canRemoveSource(result({ localCopy: 'copied' }))).toBe(true)
    expect(canRemoveSource(result({ localCopy: 'not-needed' }))).toBe(true)
  })

  it('refuses anything that did not transfer or did not verify', () => {
    expect(canRemoveSource(result({ status: 'failed', failure: 'server-error' }))).toBe(false)
    expect(canRemoveSource(result({ localCopy: 'failed' }))).toBe(false)
    expect(canRemoveSource(result({ localCopy: 'diverged' }))).toBe(false)
    expect(canRemoveSource(result({ localCopy: undefined }))).toBe(false)
  })
})

describe('isSourceRowUnchanged', () => {
  const planned = planFor([file('a.SLDPRT')]).files[0]
  const row = {
    id: 'id-a.SLDPRT',
    version: 4,
    content_hash: 'hash-id-a.SLDPRT',
    checked_out_by: null,
    deleted_at: null,
  }

  it('accepts the row that was transferred', () => {
    expect(isSourceRowUnchanged(planned, row)).toBe(true)
  })

  it.each([
    ['gone', undefined],
    ['already deleted', { ...row, deleted_at: '2026-10-06T00:00:00Z' }],
    ['checked out since', { ...row, checked_out_by: 'someone' }],
    ['checked in again', { ...row, version: 5, content_hash: 'newer' }],
    ['same version, other content', { ...row, content_hash: 'newer' }],
  ])('refuses a row that is %s', (_label, changed) => {
    expect(isSourceRowUnchanged(planned, changed)).toBe(false)
  })
})

describe('folders', () => {
  it('asks the server for each directory once, however many files go into it', async () => {
    const files = ['a', 'b', 'c'].map((name) => file(`${name}.SLDPRT`))
    const world = new World()
    files.forEach((entry) => world.seed(entry))
    const deps = world.deps()

    await runVaultTransfer(planFor(files, 'In/Deep'), deps, 3)

    expect(world.calls.filter((call) => call === 'folder:In/Deep')).toHaveLength(1)
  })

  it('does not fail a file because its folder row could not be written', async () => {
    const synced = file('a.SLDPRT')
    const world = new World()
    world.seed(synced)
    world.failingServerFolders.add('In')

    const result = await run(world, planFor([synced]))

    expect(result.results[0].status).toBe('transferred')
    expect(result.folderFailures).toEqual(['In'])
  })

  it('creates selected folders on the server and on disk, empty ones included', async () => {
    const world = new World()
    const plan = { ...planFor([]), folders: ['In/Empty', 'In/Empty/Nested'] }

    const result = await run(world, plan)

    expect(result.foldersCreated).toBe(2)
    expect([...world.destFolders]).toEqual(['In/Empty', 'In/Empty/Nested'])
    expect([...world.destFoldersOnDisk]).toEqual(['In/Empty', 'In/Empty/Nested'])
  })

  it('creates no folders once cancelled', async () => {
    const world = new World()
    world.cancelAfter = 0
    const plan = { ...planFor([]), folders: ['In/Empty'] }

    const result = await run(world, plan)

    expect(result.foldersCreated).toBe(0)
    expect(world.destFolders.size).toBe(0)
  })
})

describe('references', () => {
  it('copies references only between files that both arrived', async () => {
    const files = ['a', 'b', 'c'].map((name) => file(`${name}.SLDPRT`))
    const world = new World()
    files.forEach((entry) => world.seed(entry))
    world.failingInserts.add('In/c.SLDPRT')

    const result = await run(world, planFor(files))

    expect(world.referenceCalls).toHaveLength(1)
    expect(world.referenceCalls[0].map((pair) => pair.sourceFileId).sort()).toEqual([
      'id-a.SLDPRT',
      'id-b.SLDPRT',
    ])
    expect(result.referencesCopied).toBe(2)
  })

  it('does not ask when fewer than two files arrived, since a reference needs two ends', async () => {
    const only = file('a.SLDPRT')
    const world = new World()
    world.seed(only)

    await run(world, planFor([only]))

    expect(world.referenceCalls).toHaveLength(0)
  })

  it('leaves local-only files out of it, since they have no source row', async () => {
    const tracked = file('a.SLDPRT')
    const added = file('b.SLDPRT', { diffStatus: 'added' }, false)
    const world = new World()
    world.seed(tracked)
    world.seed(added)

    await run(world, planFor([tracked, added]))

    expect(world.referenceCalls).toHaveLength(0)
  })

  it('reports the reference failure without failing the transfer', async () => {
    const files = ['a', 'b'].map((name) => file(`${name}.SLDPRT`))
    const world = new World()
    files.forEach((entry) => world.seed(entry))
    const deps = world.deps()
    deps.copyReferences = async () => ({ copied: 0, error: 'rls' })

    const result = await runVaultTransfer(planFor(files), deps, 1)

    expect(result.results.every((entry) => entry.status === 'transferred')).toBe(true)
    expect(result.referenceError).toBe('rls')
  })
})

describe('cancelling', () => {
  it('lets the file in flight finish and does not start the next', async () => {
    const files = ['a', 'b', 'c'].map((name) => file(`${name}.SLDPRT`))
    const world = new World()
    files.forEach((entry) => world.seed(entry))
    world.cancelAfter = 1

    const result = await run(world, planFor(files))

    expect(result.results.map((entry) => entry.status)).toEqual(['transferred', 'failed', 'failed'])
    expect(result.results[1].failure).toBe('cancelled')
    expect(result.cancelled).toBe(true)
    expect(world.destServer.size).toBe(1)
  })

  it('is not reported as cancelled when nothing was skipped for it', async () => {
    const only = file('a.SLDPRT')
    const world = new World()
    world.seed(only)

    expect((await run(world, planFor([only]))).cancelled).toBe(false)
  })
})

describe('progress', () => {
  it('reports each file once, ending at the total', async () => {
    const files = ['a', 'b', 'c'].map((name) => file(`${name}.SLDPRT`))
    const world = new World()
    files.forEach((entry) => world.seed(entry))
    const seen: Array<[number, number]> = []
    const deps = world.deps()
    deps.onItemDone = (done, total) => seen.push([done, total])

    await runVaultTransfer(planFor(files), deps, 1)

    expect(seen).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ])
  })
})
