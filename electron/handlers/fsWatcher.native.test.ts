import { EventEmitter } from 'events'
import fs from 'fs'
import type * as fsTypes from 'fs'
import os from 'os'
import path from 'path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createVaultWatcher, type VaultWatcher, type WatcherScanCache } from './fsWatcher'

// The native (Windows and macOS) vault watcher: batching, write settling, ignore rules,
// directory add/remove and restart after an error. fs.watch is replaced by an emitter the
// test drives, so the events are deterministic on every OS; the stats the watcher takes of
// each reported path are real, against a temporary vault.

class FakeFsWatcher extends EventEmitter {
  closed = false
  close(): void {
    this.closed = true
  }
}

const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')!

let vault: string
let watchers: FakeFsWatcher[]
let sent: Array<[string, unknown]>
let known: Map<string, 'directory' | 'file'>
let populated: boolean
let invalidated: number
let watcher: VaultWatcher

function makeScanCache(): WatcherScanCache {
  return {
    getKind: (relativePath) => known.get(relativePath),
    isPopulated: () => populated,
    setEntry: (relativePath, _fullPath, stats: fsTypes.Stats) => {
      known.set(relativePath, stats.isDirectory() ? 'directory' : 'file')
    },
    deleteEntry: (relativePath) => {
      known.delete(relativePath)
    },
    invalidate: () => {
      invalidated++
    },
  }
}

function emit(filename: string | null): void {
  watchers[watchers.length - 1].emit('change', 'rename', filename)
}

function sentOn(channel: string): unknown[] {
  return sent.filter(([name]) => name === channel).map(([, payload]) => payload)
}

beforeEach(() => {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), 'blueplm-watch-'))
  watchers = []
  sent = []
  known = new Map()
  populated = true
  invalidated = 0

  // Linux takes the chokidar path; every other platform uses the native watcher under test
  Object.defineProperty(process, 'platform', { ...platformDescriptor, value: 'win32' })
  vi.spyOn(fs, 'watch').mockImplementation(() => {
    const fake = new FakeFsWatcher()
    watchers.push(fake)
    return fake as unknown as fsTypes.FSWatcher
  })

  const window = {
    isDestroyed: () => false,
    webContents: { send: (channel: string, payload: unknown) => sent.push([channel, payload]) },
  }
  watcher = createVaultWatcher(vault, {
    log: () => {},
    getMainWindow: () => window as unknown as Electron.BrowserWindow,
    scanCache: makeScanCache(),
  })
  Object.defineProperty(process, 'platform', platformDescriptor)
})

afterEach(async () => {
  await watcher.close()
  vi.restoreAllMocks()
  fs.rmSync(vault, { recursive: true, force: true })
})

describe('native vault watcher', () => {
  it('watches the vault recursively', () => {
    expect(fs.watch).toHaveBeenCalledWith(vault, { recursive: true, persistent: true })
  })

  it('reports a burst of settled writes as one batch, with forward slashes, minus ignored paths', async () => {
    fs.mkdirSync(path.join(vault, 'Parts'))
    known.set('Parts', 'directory')
    fs.writeFileSync(path.join(vault, 'Parts', 'a.sldprt'), 'a')
    fs.writeFileSync(path.join(vault, 'Parts', 'b.sldprt'), 'b')
    fs.writeFileSync(path.join(vault, 'Parts', '~$a.sldprt'), 'lock')

    emit('Parts\\a.sldprt')
    emit('Parts/b.sldprt')
    emit('Parts/a.sldprt')
    emit('Parts\\~$a.sldprt')
    emit('Parts/b.sldprt.download')
    emit('..\\outside.txt')
    emit(null)

    await vi.waitFor(() => expect(sentOn('files-changed')).toHaveLength(1), { timeout: 5_000 })
    expect(sentOn('files-changed')[0]).toEqual(['Parts/a.sldprt', 'Parts/b.sldprt'])
    expect(known.get('Parts/a.sldprt')).toBe('file')
  })

  it('coalesces a burst of 500 changes, each reported twice, into one IPC send', async () => {
    const names: string[] = []
    for (let i = 0; i < 500; i++) {
      const name = `part-${i}.sldprt`
      fs.writeFileSync(path.join(vault, name), String(i))
      names.push(name)
    }
    for (const name of names) emit(name)
    for (const name of names) emit(name)

    await vi.waitFor(() => expect(sentOn('files-changed')).toHaveLength(1), { timeout: 8_000 })
    expect(sentOn('files-changed')[0]).toEqual(names)
    // Nothing trails behind the batch
    await new Promise((resolve) => setTimeout(resolve, 1_000))
    expect(sent).toHaveLength(1)
  }, 15_000)

  it('holds a file that is still being written until it stops changing', async () => {
    const full = path.join(vault, 'big.sldasm')
    fs.writeFileSync(full, 'first chunk')
    emit('big.sldasm')

    // Before the first flush (1s debounce), the file grows
    await new Promise((resolve) => setTimeout(resolve, 1_200))
    expect(sentOn('files-changed')).toHaveLength(0)
    fs.appendFileSync(full, ', second chunk')

    await vi.waitFor(() => expect(sentOn('files-changed')).toEqual([['big.sldasm']]), {
      timeout: 6_000,
    })
  }, 10_000)

  it('reports a removed directory and a removed file and forgets them', async () => {
    known.set('Old', 'directory')
    known.set('gone.sldprt', 'file')

    emit('Old')
    emit('gone.sldprt')

    await vi.waitFor(() => expect(sentOn('files-changed')).toHaveLength(1), { timeout: 5_000 })
    expect(sentOn('directory-removed')).toEqual(['Old'])
    expect(sentOn('files-changed')[0]).toEqual(['Old', 'gone.sldprt'])
    expect(known.has('Old')).toBe(false)
    expect(known.has('gone.sldprt')).toBe(false)
  })

  it('announces a new directory once, and not one it already knew', async () => {
    fs.mkdirSync(path.join(vault, 'New'))
    fs.mkdirSync(path.join(vault, 'Known'))
    known.set('Known', 'directory')

    emit('New')
    emit('Known')

    await vi.waitFor(() => expect(sentOn('directory-added')).toEqual(['New']), { timeout: 5_000 })
    expect(sentOn('files-changed')).toEqual([['New']])
  })

  it('reports a new directory as a change but not an addition while there is no scan to compare', async () => {
    populated = false
    fs.mkdirSync(path.join(vault, 'New'))
    emit('New')

    await vi.waitFor(() => expect(sentOn('files-changed')).toEqual([['New']]), { timeout: 5_000 })
    expect(sentOn('directory-added')).toEqual([])
  })

  it('ignores permission errors but restarts and asks for a resync on any other error', async () => {
    watchers[0].emit('error', Object.assign(new Error('denied'), { code: 'EPERM' }))
    expect(watchers[0].closed).toBe(false)

    watchers[0].emit('error', Object.assign(new Error('watch failed'), { code: 'EIO' }))
    expect(watchers[0].closed).toBe(true)

    await vi.waitFor(() => expect(sentOn('vault-resync-required')).toHaveLength(1), { timeout: 5_000 })
    expect(watchers).toHaveLength(2)
    expect(invalidated).toBe(1)
  })

  it('sends nothing for events still pending when it is closed', async () => {
    fs.writeFileSync(path.join(vault, 'a.sldprt'), 'a')
    emit('a.sldprt')
    await watcher.close()

    await new Promise((resolve) => setTimeout(resolve, 2_200))
    expect(sent).toEqual([])
    expect(watchers[0].closed).toBe(true)
  }, 10_000)
})
