import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  getInodeMap,
  getSyncIndex,
  getVersionMap,
  removeFromSyncIndex,
  updateInodes,
  SYNC_INDEX_WRITE_CHUNK,
  updateSyncIndexFromServer,
} from './localSyncIndex'

const VAULT_ID = 'vault-a'
const DAY_MS = 24 * 60 * 60 * 1000

interface StoredRecord {
  key: string
  vaultId: string
  relativePath: string
}

/**
 * Minimal in-memory IndexedDB fake covering what localSyncIndex.ts uses: one object
 * store keyed by 'key', a 'vaultId' index queried with getAll/getAllKeys over
 * IDBKeyRange.only, and get/put/delete. vitest's environment is 'node', so there is
 * no real indexedDB.
 */
function installFakeIndexedDB(): {
  records: Map<string, StoredRecord>
  deletes: string[]
  putBursts: number[]
} {
  const records = new Map<string, StoredRecord>()
  const deletes: string[] = []
  // Puts queued between two request callbacks: what one callback did on the main thread.
  const putBursts: number[] = []
  let putsSinceCallback = 0

  class FakeRequest {
    result: unknown
    error: unknown = null
    onsuccess: (() => void) | null = null
    onerror: (() => void) | null = null
  }

  function succeed(request: FakeRequest, result: unknown) {
    request.result = result
    queueMicrotask(() => {
      if (putsSinceCallback > 0) putBursts.push(putsSinceCallback)
      putsSinceCallback = 0
      request.onsuccess?.()
    })
  }

  class FakeIndex {
    constructor(private readonly property: 'vaultId') {}
    private matching(range: { value: string }) {
      return [...records.values()].filter((record) => record[this.property] === range.value)
    }
    getAll(range: { value: string }) {
      const request = new FakeRequest()
      succeed(request, this.matching(range))
      return request
    }
    getAllKeys(range: { value: string }) {
      const request = new FakeRequest()
      succeed(
        request,
        this.matching(range).map((record) => record.key),
      )
      return request
    }
  }

  class FakeStore {
    createIndex() {
      // Index lookups are served from the record map, so there is nothing to build.
    }
    index(name: string) {
      if (name !== 'vaultId') throw new Error(`Unexpected index ${name}`)
      return new FakeIndex('vaultId')
    }
    get(key: string) {
      const request = new FakeRequest()
      succeed(request, records.get(key))
      return request
    }
    put(value: StoredRecord) {
      const request = new FakeRequest()
      putsSinceCallback++
      records.set(value.key, { ...value })
      succeed(request, undefined)
      return request
    }
    delete(key: string) {
      const request = new FakeRequest()
      deletes.push(key)
      records.delete(key)
      succeed(request, undefined)
      return request
    }
  }

  const fakeDb = {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => new FakeStore(),
    transaction: () => ({ objectStore: () => new FakeStore() }),
  }

  const globals = globalThis as {
    indexedDB?: unknown
    IDBKeyRange?: unknown
  }

  globals.indexedDB = {
    open() {
      const request = new FakeRequest()
      queueMicrotask(() => {
        request.result = fakeDb
        request.onsuccess?.()
      })
      return request
    },
  }
  globals.IDBKeyRange = { only: (value: string) => ({ value }) }

  return { records, deletes, putBursts }
}

/** Flushes the queueMicrotask chains the fake IndexedDB uses. */
async function flush() {
  for (let index = 0; index < 10; index++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

type Classification = 'deleted_remote' | 'added'

/**
 * The classification useLoadFiles.ts applies to a local file with no server match:
 * in the sync index means it was synced and the server row is gone, absent means the
 * user authored it. Reproduced here so the tests can run the load sequence that the
 * durability of the index is supposed to survive.
 */
async function classifyUnmatchedLocalFile(relativePath: string): Promise<Classification> {
  const syncIndex = await getSyncIndex(VAULT_ID)
  return syncIndex.has(relativePath.toLowerCase()) ? 'deleted_remote' : 'added'
}

/**
 * One committed merge's worth of sync index writes, in the order useLoadFiles.ts makes
 * them: reconcile against the server list, then stamp inodes over the result.
 */
async function runLoadWrites(options: {
  serverPaths: string[]
  localPaths: string[]
  inodeEntries?: Array<{ path: string; ino: number; localOnly?: boolean }>
}): Promise<void> {
  const localPathSet = new Set(options.localPaths.map((path) => path.toLowerCase()))
  await updateSyncIndexFromServer(VAULT_ID, options.serverPaths, localPathSet)
  if (options.inodeEntries?.length) {
    await updateInodes(VAULT_ID, options.inodeEntries)
  }
  await flush()
}

// Installed once: localSyncIndex.ts caches its IDBDatabase in a module-level promise,
// so a per-test database would be opened and then ignored. Tests get a clean index by
// emptying the records instead.
const { records, deletes, putBursts } = installFakeIndexedDB()

describe('localSyncIndex orphan durability', () => {
  beforeEach(() => {
    records.clear()
    deletes.length = 0
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps classifying a file whose server row was deleted as an orphan on every later load', async () => {
    const orphan = 'designs/bracket.slddrw'

    // Load 1: the file is on the server and on disk.
    await runLoadWrites({
      serverPaths: [orphan, 'designs/keep.sldprt'],
      localPaths: [orphan, 'designs/keep.sldprt'],
      inodeEntries: [{ path: orphan, ino: 11 }],
    })
    expect(await classifyUnmatchedLocalFile(orphan)).toBe('deleted_remote')

    // Loads 2-5: the server row is gone, the file is still on disk. Before the
    // tombstone the index entry was pruned here and the next load called it 'added'.
    for (let load = 0; load < 4; load++) {
      expect(await classifyUnmatchedLocalFile(orphan)).toBe('deleted_remote')
      await runLoadWrites({
        serverPaths: ['designs/keep.sldprt'],
        localPaths: [orphan, 'designs/keep.sldprt'],
      })
    }

    expect(await classifyUnmatchedLocalFile(orphan)).toBe('deleted_remote')
  })

  it('classifies a file the user authored as added on every load', async () => {
    const authored = 'designs/new-idea.sldprt'

    for (let load = 0; load < 3; load++) {
      expect(await classifyUnmatchedLocalFile(authored)).toBe('added')
      await runLoadWrites({
        serverPaths: ['designs/keep.sldprt'],
        localPaths: [authored, 'designs/keep.sldprt'],
      })
    }

    expect(await classifyUnmatchedLocalFile(authored)).toBe('added')
  })

  it('does not tombstone a server path that was never on this machine', async () => {
    const cloudOnly = 'designs/never-downloaded.sldprt'

    // Present on the server, absent from disk: the index records the path, but there
    // is no local file behind it.
    await runLoadWrites({
      serverPaths: [cloudOnly, 'designs/keep.sldprt'],
      localPaths: ['designs/keep.sldprt'],
    })

    // The server row goes away, and only afterwards does the user create a file of
    // their own at that path. Reusing the path must not make it look synced.
    await runLoadWrites({
      serverPaths: ['designs/keep.sldprt'],
      localPaths: ['designs/keep.sldprt'],
    })
    await runLoadWrites({
      serverPaths: ['designs/keep.sldprt'],
      localPaths: [cloudOnly, 'designs/keep.sldprt'],
    })

    expect(await classifyUnmatchedLocalFile(cloudOnly)).toBe('added')
  })

  it('drops the tombstone once the local file is gone, so a later file at that path is added', async () => {
    const orphan = 'designs/bracket.slddrw'

    await runLoadWrites({
      serverPaths: [orphan, 'designs/keep.sldprt'],
      localPaths: [orphan, 'designs/keep.sldprt'],
    })
    await runLoadWrites({
      serverPaths: ['designs/keep.sldprt'],
      localPaths: [orphan, 'designs/keep.sldprt'],
    })
    expect(await classifyUnmatchedLocalFile(orphan)).toBe('deleted_remote')

    // The user deals with it themselves - deletes it, or moves it out of the vault.
    await runLoadWrites({
      serverPaths: ['designs/keep.sldprt'],
      localPaths: ['designs/keep.sldprt'],
    })

    // A new file at the same path later is the user's own work, not an orphan.
    await runLoadWrites({
      serverPaths: ['designs/keep.sldprt'],
      localPaths: [orphan, 'designs/keep.sldprt'],
    })
    expect(await classifyUnmatchedLocalFile(orphan)).toBe('added')
  })

  it('stops asserting a path was synced once the tombstone passes its lifetime', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const orphan = 'designs/bracket.slddrw'

    await runLoadWrites({
      serverPaths: [orphan, 'designs/keep.sldprt'],
      localPaths: [orphan, 'designs/keep.sldprt'],
    })
    await runLoadWrites({
      serverPaths: ['designs/keep.sldprt'],
      localPaths: [orphan, 'designs/keep.sldprt'],
    })

    vi.setSystemTime(Date.now() + 29 * DAY_MS)
    expect(await classifyUnmatchedLocalFile(orphan)).toBe('deleted_remote')

    vi.setSystemTime(Date.now() + 2 * DAY_MS)
    expect(await classifyUnmatchedLocalFile(orphan)).toBe('added')

    // And the expired record is cleared out rather than re-read on every load.
    await runLoadWrites({
      serverPaths: ['designs/keep.sldprt'],
      localPaths: [orphan, 'designs/keep.sldprt'],
    })
    expect(records.has(`${VAULT_ID}:${orphan}`)).toBe(false)
  })

  it('forgets a path that was discarded, even while the file is still on disk', async () => {
    const orphan = 'designs/bracket.slddrw'

    await runLoadWrites({
      serverPaths: [orphan, 'designs/keep.sldprt'],
      localPaths: [orphan, 'designs/keep.sldprt'],
    })
    await runLoadWrites({
      serverPaths: ['designs/keep.sldprt'],
      localPaths: [orphan, 'designs/keep.sldprt'],
    })

    // What discardOrphaned and delete do after removing the file.
    await removeFromSyncIndex(VAULT_ID, [orphan])
    await flush()

    expect(await classifyUnmatchedLocalFile(orphan)).toBe('added')
  })

  it('clears the tombstone when the server row comes back', async () => {
    const restored = 'designs/bracket.slddrw'

    await runLoadWrites({
      serverPaths: [restored, 'designs/keep.sldprt'],
      localPaths: [restored, 'designs/keep.sldprt'],
    })
    await runLoadWrites({
      serverPaths: ['designs/keep.sldprt'],
      localPaths: [restored, 'designs/keep.sldprt'],
    })
    await runLoadWrites({
      serverPaths: [restored, 'designs/keep.sldprt'],
      localPaths: [restored, 'designs/keep.sldprt'],
    })

    const record = records.get(`${VAULT_ID}:${restored}`) as { orphanedAt?: number } | undefined
    expect(record).toBeDefined()
    expect(record?.orphanedAt).toBeUndefined()
  })
})

describe('localSyncIndex moved-file entries', () => {
  beforeEach(() => {
    records.clear()
    deletes.length = 0
  })

  /**
   * A file moved on disk whose server row still records the old path: the loader
   * stamps the inode at both, and the index must settle rather than delete and
   * recreate the local-only path on every load.
   */
  const movedFileLoad = {
    serverPaths: ['designs/old-name.sldprt', 'designs/keep.sldprt'],
    localPaths: ['designs/new-name.sldprt', 'designs/keep.sldprt'],
    inodeEntries: [
      { path: 'designs/new-name.sldprt', ino: 42, localOnly: true },
      { path: 'designs/old-name.sldprt', ino: 42 },
      { path: 'designs/keep.sldprt', ino: 7 },
    ],
  }

  it('settles instead of deleting and recreating the moved path on every load', async () => {
    await runLoadWrites(movedFileLoad)
    const afterFirstLoad = records.size
    deletes.length = 0

    for (let load = 0; load < 3; load++) {
      await runLoadWrites(movedFileLoad)
    }

    // Two server paths plus the one local-only path, load after load.
    expect(afterFirstLoad).toBe(3)
    expect(records.size).toBe(3)
    // The prune used to delete the local-only path and updateInodes used to put it
    // straight back, every load, which is what drove the index past the server count.
    expect(deletes).not.toContain(`${VAULT_ID}:designs/new-name.sldprt`)
  })

  it('keeps the moved file out of orphan detection while keeping its inode', async () => {
    await runLoadWrites(movedFileLoad)

    // The new local path is not evidence of a sync: the server has never seen it.
    expect(await classifyUnmatchedLocalFile('designs/new-name.sldprt')).toBe('added')

    // But rename detection still has the inode at both ends of the move.
    const inodeMap = await getInodeMap(VAULT_ID)
    expect(inodeMap.get(42)?.sort()).toEqual(['designs/new-name.sldprt', 'designs/old-name.sldprt'])
  })

  it('lets a path that becomes server-backed count as synced again', async () => {
    await runLoadWrites(movedFileLoad)
    const beforeCommit = await getSyncIndex(VAULT_ID)
    expect(beforeCommit.has('designs/new-name.sldprt')).toBe(false)

    // The move reaches the server. The flag has to clear here, or a genuine deletion
    // of that file later would be misread as a file the user authored.
    await runLoadWrites({
      serverPaths: ['designs/new-name.sldprt', 'designs/keep.sldprt'],
      localPaths: ['designs/new-name.sldprt', 'designs/keep.sldprt'],
      inodeEntries: [{ path: 'designs/new-name.sldprt', ino: 42 }],
    })

    const syncIndex = await getSyncIndex(VAULT_ID)
    expect(syncIndex.has('designs/new-name.sldprt')).toBe(true)
    // The old path is gone from the server and from disk, so nothing keeps it.
    expect(syncIndex.has('designs/old-name.sldprt')).toBe(false)
  })
})

describe('localSyncIndex hash stamps', () => {
  beforeEach(() => {
    records.clear()
    deletes.length = 0
  })

  const path = 'designs/bracket.sldprt'
  const stamp = { size: 1200, mtimeMs: 1_761_386_400_000 }

  it('restores a hash with the size and modified time it was computed from', async () => {
    await updateInodes(VAULT_ID, [
      { path, ino: 9, localVersion: 3, localHash: 'h1', hashStamp: stamp },
    ])
    await flush()

    expect((await getVersionMap(VAULT_ID)).get(path)).toEqual({
      localVersion: 3,
      localHash: 'h1',
      hashStamp: stamp,
    })
  })

  it('keeps the stamp through the per-load reconcile against the server list', async () => {
    await updateInodes(VAULT_ID, [{ path, ino: 9, localHash: 'h1', hashStamp: stamp }])
    await runLoadWrites({ serverPaths: [path], localPaths: [path] })

    expect((await getVersionMap(VAULT_ID)).get(path)?.hashStamp).toEqual(stamp)
  })

  it('drops the stamp when a hash is written without one, so it never vouches for that hash', async () => {
    await updateInodes(VAULT_ID, [{ path, ino: 9, localHash: 'h1', hashStamp: stamp }])
    await updateInodes(VAULT_ID, [{ path, ino: 9, localHash: 'h2' }])
    await flush()

    const saved = (await getVersionMap(VAULT_ID)).get(path)
    expect(saved?.localHash).toBe('h2')
    expect(saved?.hashStamp).toBeUndefined()
  })

  it('leaves hash and stamp alone when an inode-only write passes no hash', async () => {
    await updateInodes(VAULT_ID, [{ path, ino: 9, localHash: 'h1', hashStamp: stamp }])
    await updateInodes(VAULT_ID, [{ path, ino: 10 }])
    await flush()

    expect((await getVersionMap(VAULT_ID)).get(path)).toMatchObject({
      localHash: 'h1',
      hashStamp: stamp,
    })
  })
})

describe('localSyncIndex bulk inode writes', () => {
  beforeEach(() => {
    records.clear()
    deletes.length = 0
    putBursts.length = 0
  })

  // A first load writes every entry. All of them in one callback was 1-2 s of main thread right
  // after the vault came up (render-perf nightly); they go in chunks, in one transaction.
  it('writes every entry, at most one chunk per callback', async () => {
    const count = SYNC_INDEX_WRITE_CHUNK * 2 + 37
    const entries = Array.from({ length: count }, (_, i) => ({ path: `designs/part-${i}.sldprt`, ino: i + 1 }))
    await updateInodes(VAULT_ID, entries)
    await flush()

    expect(records.size).toBe(count)
    expect(Math.max(...putBursts)).toBeLessThanOrEqual(SYNC_INDEX_WRITE_CHUNK)
    expect(putBursts.reduce((a, b) => a + b, 0)).toBe(count)
    const inodes = await getInodeMap(VAULT_ID)
    expect(inodes.get(count)).toEqual([`designs/part-${count - 1}.sldprt`])
  })

  it('rebuilds a first load from the server list the same way', async () => {
    const count = SYNC_INDEX_WRITE_CHUNK * 3 + 5
    const paths = Array.from({ length: count }, (_, i) => `designs/part-${i}.sldprt`)
    await updateSyncIndexFromServer(VAULT_ID, paths, new Set(paths))
    await flush()

    expect(records.size).toBe(count)
    expect(Math.max(...putBursts)).toBeLessThanOrEqual(SYNC_INDEX_WRITE_CHUNK)
    expect((await getSyncIndex(VAULT_ID)).size).toBe(count)
  })
})
