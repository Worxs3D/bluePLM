import { describe, expect, it } from 'vitest'

import type { LocalFile } from '@/stores/types'
import type { PDMFile } from '@/types/pdm'

import type { LocalCopyOutcome, SourceRowState, TransferItemResult } from './execute'
import { removeMovedSources, type RemoveSourcesDeps } from './removeSources'
import { planVaultTransfer } from './plan'

function pdm(id: string): PDMFile {
  return {
    id,
    org_id: 'org',
    vault_id: 'vault-a',
    file_path: '',
    file_name: '',
    extension: '.sldprt',
    file_type: 'part',
    part_number: null,
    description: null,
    revision: 'A',
    version: 2,
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
    file_size: 10,
    created_at: null,
    created_by: 'user',
    updated_at: null,
    updated_by: null,
    custom_properties: null,
    deleted_at: null,
    deleted_by: null,
  }
}

function file(relativePath: string, overrides: Partial<LocalFile> = {}, tracked = true): LocalFile {
  return {
    name: relativePath.split('/').pop() ?? relativePath,
    path: `C:\\a\\${relativePath.replace(/\//g, '\\')}`,
    relativePath,
    isDirectory: false,
    extension: '.sldprt',
    size: 10,
    modifiedTime: '',
    ...(tracked ? { pdmData: pdm(`id-${relativePath}`) } : {}),
    ...overrides,
  }
}

function folder(relativePath: string, overrides: Partial<LocalFile> = {}): LocalFile {
  return {
    name: relativePath.split('/').pop() ?? relativePath,
    path: `C:\\a\\${relativePath.replace(/\//g, '\\')}`,
    relativePath,
    isDirectory: true,
    extension: '',
    size: 0,
    modifiedTime: '',
    ...overrides,
  }
}

function plan(selection: LocalFile[], vaultFiles: LocalFile[] = selection) {
  return planVaultTransfer({
    selection,
    vaultFiles,
    options: { mode: 'move', destFolder: '', keepPath: true },
    target: { serverPaths: new Set(), diskPaths: new Set(), vaultPath: 'C:\\b' },
  })
}

function transferred(
  planned: ReturnType<typeof plan>['files'][number],
  localCopy: LocalCopyOutcome = 'copied',
): TransferItemResult {
  return { planned, status: 'transferred', destFileId: `dest-${planned.sourceRelativePath}`, localCopy }
}

class Fake {
  rows = new Map<string, SourceRowState>()
  unreadableRows = false
  lockedLocal = new Set<string>()
  refusedRows = new Set<string>()
  dirs = new Map<string, 'empty' | 'not-empty' | 'missing'>()
  trashFails = new Set<string>()

  localDeleted: string[] = []
  rowsDeleted: string[] = []
  dirsTrashed: string[] = []
  serverFoldersDeleted: string[] = []
  order: string[] = []

  seedRows(files: LocalFile[]) {
    for (const entry of files) {
      if (!entry.pdmData) continue
      this.rows.set(entry.pdmData.id, {
        id: entry.pdmData.id,
        version: entry.pdmData.version,
        content_hash: entry.pdmData.content_hash,
        checked_out_by: null,
        deleted_at: null,
      })
    }
  }

  deps(): RemoveSourcesDeps {
    return {
      fetchSourceRowStates: async () =>
        this.unreadableRows ? { ok: false, error: 'offline' } : { ok: true, rows: this.rows },
      deleteLocalFiles: async (paths) => {
        const removed = new Set<string>()
        for (const path of paths) {
          if (this.lockedLocal.has(path)) continue
          this.localDeleted.push(path)
          this.order.push(`local:${path}`)
          removed.add(path)
        }
        return removed
      },
      softDeleteRows: async (ids) => {
        const deleted = new Set<string>()
        const errors = new Map<string, string>()
        for (const id of ids) {
          if (this.refusedRows.has(id)) errors.set(id, 'refused')
          else {
            deleted.add(id)
            this.rowsDeleted.push(id)
            this.order.push(`row:${id}`)
          }
        }
        return { deleted, errors }
      },
      directoryState: async (path) => this.dirs.get(path) ?? 'empty',
      trashDirectory: async (path) => {
        if (this.trashFails.has(path)) return false
        this.dirsTrashed.push(path)
        return true
      },
      deleteServerFolder: async (path) => {
        this.serverFoldersDeleted.push(path)
        return true
      },
      buildPath: (relativePath) => `C:\\a\\${relativePath.replace(/\//g, '\\')}`,
    }
  }
}

describe('removing the sources of a move', () => {
  it('deletes the local file, then the row, for each verified transfer', async () => {
    const a = file('a.SLDPRT')
    const fake = new Fake()
    fake.seedRows([a])
    const { files, sourceFolders } = plan([a])

    const outcome = await removeMovedSources(
      { results: files.map((entry) => transferred(entry)), sourceFolders, vaultFiles: [a] },
      fake.deps(),
    )

    expect(outcome.removed).toHaveLength(1)
    expect(outcome.kept).toHaveLength(0)
    // Local first: the row must not say "deleted" about a file that is still on disk.
    expect(fake.order).toEqual([`local:${a.path}`, 'row:id-a.SLDPRT'])
  })

  it('does not touch the local disk for a cloud-only file', async () => {
    const cloud = file('a.SLDPRT', { diffStatus: 'cloud', size: 0 })
    const fake = new Fake()
    fake.seedRows([cloud])
    const { files } = plan([cloud])

    const outcome = await removeMovedSources(
      { results: [transferred(files[0], 'not-needed')], sourceFolders: [], vaultFiles: [cloud] },
      fake.deps(),
    )

    expect(outcome.removed).toHaveLength(1)
    expect(fake.localDeleted).toHaveLength(0)
    expect(fake.rowsDeleted).toEqual(['id-a.SLDPRT'])
  })

  it('removes only the local file of a file that was never checked in', async () => {
    const added = file('a.SLDPRT', { diffStatus: 'added' }, false)
    const fake = new Fake()
    const { files } = plan([added])

    const outcome = await removeMovedSources(
      { results: [transferred(files[0])], sourceFolders: [], vaultFiles: [added] },
      fake.deps(),
    )

    expect(outcome.removed).toHaveLength(1)
    expect(fake.localDeleted).toEqual([added.path])
    expect(fake.rowsDeleted).toHaveLength(0)
  })

  it('keeps a source whose destination copy is not whole', async () => {
    const a = file('a.SLDPRT')
    const b = file('b.SLDPRT')
    const fake = new Fake()
    fake.seedRows([a, b])
    const { files } = plan([a, b])

    const outcome = await removeMovedSources(
      {
        results: [transferred(files[0], 'failed'), transferred(files[1], 'diverged')],
        sourceFolders: [],
        vaultFiles: [a, b],
      },
      fake.deps(),
    )

    expect(outcome.removed).toHaveLength(0)
    expect(outcome.kept.map((entry) => entry.reason)).toEqual(['not-verified', 'not-verified'])
    expect(fake.localDeleted).toHaveLength(0)
    expect(fake.rowsDeleted).toHaveLength(0)
  })

  it('ignores files that never transferred', async () => {
    const a = file('a.SLDPRT')
    const fake = new Fake()
    fake.seedRows([a])
    const { files } = plan([a])

    const outcome = await removeMovedSources(
      {
        results: [{ planned: files[0], status: 'failed', failure: 'server-error' }],
        sourceFolders: [],
        vaultFiles: [a],
      },
      fake.deps(),
    )

    expect(outcome.removed).toHaveLength(0)
    expect(outcome.kept).toHaveLength(0)
    expect(fake.localDeleted).toHaveLength(0)
  })
})

describe('a source that changed after the plan was made', () => {
  it.each([
    ['a newer version', { version: 3, content_hash: 'newer' }],
    ['a checkout', { checked_out_by: 'someone' }],
    ['a deletion', { deleted_at: '2026-10-06T00:00:00Z' }],
  ])('is kept after %s', async (_label, change) => {
    const a = file('a.SLDPRT')
    const fake = new Fake()
    fake.seedRows([a])
    fake.rows.set('id-a.SLDPRT', { ...fake.rows.get('id-a.SLDPRT')!, ...change })
    const { files } = plan([a])

    const outcome = await removeMovedSources(
      { results: [transferred(files[0])], sourceFolders: [], vaultFiles: [a] },
      fake.deps(),
    )

    expect(outcome.kept).toMatchObject([{ reason: 'source-changed' }])
    expect(fake.localDeleted).toHaveLength(0)
    expect(fake.rowsDeleted).toHaveLength(0)
  })

  it('is kept when its row has vanished from the answer', async () => {
    const a = file('a.SLDPRT')
    const fake = new Fake()
    const { files } = plan([a])

    const outcome = await removeMovedSources(
      { results: [transferred(files[0])], sourceFolders: [], vaultFiles: [a] },
      fake.deps(),
    )

    expect(outcome.kept).toMatchObject([{ reason: 'source-changed' }])
  })

  it('keeps every tracked source when the server cannot be asked, but still moves local-only ones', async () => {
    const tracked = file('a.SLDPRT')
    const added = file('b.SLDPRT', { diffStatus: 'added' }, false)
    const fake = new Fake()
    fake.seedRows([tracked])
    fake.unreadableRows = true
    const { files } = plan([tracked, added])

    const outcome = await removeMovedSources(
      {
        results: files.map((entry) => transferred(entry)),
        sourceFolders: [],
        vaultFiles: [tracked, added],
      },
      fake.deps(),
    )

    expect(outcome.kept).toMatchObject([{ reason: 'source-unverified', message: 'offline' }])
    expect(outcome.removed.map((entry) => entry.sourceRelativePath)).toEqual(['b.SLDPRT'])
    expect(fake.rowsDeleted).toHaveLength(0)
  })
})

describe('when a removal fails part-way', () => {
  it('keeps the row of a file that could not be removed from disk', async () => {
    const a = file('a.SLDPRT')
    const fake = new Fake()
    fake.seedRows([a])
    fake.lockedLocal.add(a.path)
    const { files } = plan([a])

    const outcome = await removeMovedSources(
      { results: [transferred(files[0])], sourceFolders: [], vaultFiles: [a] },
      fake.deps(),
    )

    expect(outcome.kept).toMatchObject([{ reason: 'local-delete-failed' }])
    expect(outcome.removed).toHaveLength(0)
    expect(fake.rowsDeleted).toHaveLength(0)
  })

  it('reports a refused row delete and does not count the file as removed', async () => {
    const a = file('a.SLDPRT')
    const b = file('b.SLDPRT')
    const fake = new Fake()
    fake.seedRows([a, b])
    fake.refusedRows.add('id-a.SLDPRT')
    const { files } = plan([a, b])

    const outcome = await removeMovedSources(
      { results: files.map((entry) => transferred(entry)), sourceFolders: [], vaultFiles: [a, b] },
      fake.deps(),
    )

    expect(outcome.removed.map((entry) => entry.sourceRelativePath)).toEqual(['b.SLDPRT'])
    expect(outcome.kept).toMatchObject([{ reason: 'server-delete-failed', message: 'refused' }])
  })
})

describe('source folders', () => {
  const dir = folder('Parts')
  const inner = file('Parts/a.SLDPRT')
  const sibling = file('Parts/b.SLDPRT')
  const all = [dir, inner, sibling]

  it('removes a folder once everything in it has gone', async () => {
    const fake = new Fake()
    fake.seedRows(all)
    const { files, sourceFolders } = plan([dir], all)

    const outcome = await removeMovedSources(
      { results: files.map((entry) => transferred(entry)), sourceFolders, vaultFiles: all },
      fake.deps(),
    )

    expect(outcome.foldersRemoved).toEqual(['Parts'])
    expect(fake.dirsTrashed).toEqual(['C:\\a\\Parts'])
    expect(fake.serverFoldersDeleted).toEqual(['Parts'])
  })

  it('leaves a folder alone when anything in it stayed behind', async () => {
    const fake = new Fake()
    fake.seedRows(all)
    const { files, sourceFolders } = plan([dir], all)

    // Only one of the two went; the other was refused at the destination.
    const outcome = await removeMovedSources(
      { results: [transferred(files[0])], sourceFolders, vaultFiles: all },
      fake.deps(),
    )

    expect(outcome.foldersRemoved).toHaveLength(0)
    expect(fake.dirsTrashed).toHaveLength(0)
    expect(fake.serverFoldersDeleted).toHaveLength(0)
  })

  it('leaves a folder that is not empty on disk, whatever the file list said', async () => {
    const fake = new Fake()
    fake.seedRows(all)
    fake.dirs.set('C:\\a\\Parts', 'not-empty')
    const { files, sourceFolders } = plan([dir], all)

    const outcome = await removeMovedSources(
      { results: files.map((entry) => transferred(entry)), sourceFolders, vaultFiles: all },
      fake.deps(),
    )

    expect(outcome.foldersRemoved).toHaveLength(0)
    expect(fake.serverFoldersDeleted).toHaveLength(0)
  })

  it('keeps the server row of a folder the Recycle Bin would not take', async () => {
    const fake = new Fake()
    fake.seedRows(all)
    fake.trashFails.add('C:\\a\\Parts')
    const { files, sourceFolders } = plan([dir], all)

    const outcome = await removeMovedSources(
      { results: files.map((entry) => transferred(entry)), sourceFolders, vaultFiles: all },
      fake.deps(),
    )

    expect(outcome.foldersRemoved).toHaveLength(0)
    expect(fake.serverFoldersDeleted).toHaveLength(0)
  })

  it('removes only the server row of a cloud-only folder', async () => {
    const cloudDir = folder('Parts', { diffStatus: 'cloud' })
    const cloudFile = file('Parts/a.SLDPRT', { diffStatus: 'cloud', size: 0 })
    const fake = new Fake()
    fake.seedRows([cloudFile])
    fake.dirs.set('C:\\a\\Parts', 'missing')
    const { files, sourceFolders } = plan([cloudDir], [cloudDir, cloudFile])

    const outcome = await removeMovedSources(
      {
        results: [transferred(files[0], 'not-needed')],
        sourceFolders,
        vaultFiles: [cloudDir, cloudFile],
      },
      fake.deps(),
    )

    expect(outcome.foldersRemoved).toEqual(['Parts'])
    expect(fake.dirsTrashed).toHaveLength(0)
    expect(fake.serverFoldersDeleted).toEqual(['Parts'])
  })

  it('removes nested folders deepest first', async () => {
    const outer = folder('A')
    const inside = folder('A/B')
    const deep = file('A/B/a.SLDPRT')
    const fake = new Fake()
    fake.seedRows([deep])
    const everything = [outer, inside, deep]
    const { files, sourceFolders } = plan([outer], everything)

    await removeMovedSources(
      { results: files.map((entry) => transferred(entry)), sourceFolders, vaultFiles: everything },
      fake.deps(),
    )

    expect(fake.serverFoldersDeleted).toEqual(['A/B', 'A'])
  })

  it('does not count a moved_away stub as something left behind', async () => {
    const stub = file('Parts/old.SLDPRT', { diffStatus: 'moved_away' })
    const fake = new Fake()
    fake.seedRows([inner])
    const everything = [dir, inner, stub]
    const { files, sourceFolders } = plan([dir], everything)

    const outcome = await removeMovedSources(
      { results: files.map((entry) => transferred(entry)), sourceFolders, vaultFiles: everything },
      fake.deps(),
    )

    expect(outcome.foldersRemoved).toEqual(['Parts'])
  })
})
