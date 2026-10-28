// @vitest-environment jsdom
/**
 * Content and metadata edits, deletes and restarts with two machines on one server.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/client', async (importOriginal) =>
  (await import('@/test/multi/clientMock')).mockMachineClientModule(await importOriginal()),
)

import { USERS, World } from './world'

let world: World | null = null
afterEach(() => {
  world?.dispose()
  world = null
})

async function edit(w: World, name: 'A' | 'B', path: string, body: string): Promise<void> {
  const m = w.machine(name)
  m.on(() => m.disk.write(m.absolute(path), body))
  await w.settle()
}

describe('edits across machines', () => {
  // 2026-10-25, known failure, needs a product decision (src/test/multi report, bug "stale base").
  // B's copy is outdated (A checked in version 2). B checks it out: the checkout makes the old
  // bytes writable without fetching version 2 or saying so. B edits and checks in, and version 3
  // is B's edit of version 1: A's change is gone from the latest version, with no warning to
  // either user. Options: fetch the latest on checkout when the local copy is outdated and
  // unmodified (what PDM clients usually do); refuse a check-in whose base version is behind the
  // server's; or have checkin_file take the base version and refuse server-side (schema change).
  it.fails("B checks out a copy that is behind A's check-in: B's check-in does not bury A's version", async () => {
    const w = (world = await World.create(['A', 'B']))
    w.seed({ path: 'x.sldprt' })
    await w.boot()
    await w.run(w.A.command('checkout', { files: [w.A.file('x.sldprt')] }))
    await edit(w, 'A', 'x.sldprt', 'A version 2')
    await w.run(w.A.command('checkin', { files: [w.A.file('x.sldprt')] }))
    await w.settle()
    const aVersion = w.A.disk.bytes(w.A.absolute('x.sldprt'))
    expect(w.B.file('x.sldprt').diffStatus).toBe('outdated')

    await w.run(w.B.command('checkout', { files: [w.B.file('x.sldprt')] }))
    await w.settle()
    const bBase = w.B.disk.bytes(w.B.absolute('x.sldprt'))
    await edit(w, 'B', 'x.sldprt', 'B edit')
    const checkin = await w.run(w.B.command('checkin', { files: [w.B.file('x.sldprt')] }))
    await w.settle()

    // Either B edited version 2, or B was stopped before its edit of version 1 became the latest.
    expect(bBase === aVersion || !checkin.success, w.dump()).toBe(true)
  })

  // 2026-10-25, found by the random runner; passes since 2026-10-28. The watcher does reload the
  // path, and the background hash pass finds the edit. What called it outdated rather than
  // modified was `newerSide`: the hashes differ and the checkout's write to the row left
  // `updated_at` after the file's mtime. A file this user holds that the server has not
  // versioned past is now their edit whatever the timestamps say (fileClassification.ts).
  it('an edit saved right after a checkout shows as modified without a reload', async () => {
    const w = (world = await World.create(['A', 'B']))
    w.seed({ path: 'x.sldprt' })
    await w.boot()
    await w.run(w.A.command('checkout', { files: [w.A.file('x.sldprt')] }))
    w.A.on(() => w.A.disk.write(w.A.absolute('x.sldprt'), 'saved at once'))
    await w.settle()
    expect(w.A.file('x.sldprt').diffStatus).toBe('modified')
  })

  it('A deletes a file B is downloading: B does not keep a copy the store does not list', async () => {
    const w = (world = await World.create(['A', 'B']))
    w.seed({ path: 'x.sldprt', on: ['A'] })
    await w.boot()

    // A's delete lands while B's download is in flight.
    const realApi = w.B.ctx.electronAPI
    let deletion: Promise<unknown> | null = null
    w.B.ctx.electronAPI = new Proxy(realApi, {
      get: (target, prop, receiver) => {
        const value = Reflect.get(target, prop, receiver)
        if (prop !== 'downloadUrl') return value
        return async (...args: unknown[]) => {
          if (!deletion) {
            deletion = w.A.command('delete-server', { files: [w.A.file('x.sldprt')], deleteLocal: true })
            await new Promise((resolve) => setTimeout(resolve, 2000))
          }
          return (value as (...a: unknown[]) => unknown)(...args)
        }
      },
    })
    await w.run(w.B.command('download', { files: [w.B.file('x.sldprt')] }))
    await w.run(deletion ?? Promise.resolve())
    w.B.ctx.electronAPI = realApi
    await w.settle()

    expect(w.server.fileAt('x.sldprt')).toBeUndefined()
    await w.expectConverged()
  })

  it('A and B edit metadata in turn: both values are kept and nothing goes blank', async () => {
    const w = (world = await World.create(['A', 'B']))
    w.seed({ path: 'x.sldprt', partNumber: 'P-1', description: 'Original' })
    await w.boot()

    await w.run(w.A.command('checkout', { files: [w.A.file('x.sldprt')] }))
    w.A.on(() => w.A.state().updatePendingMetadata(w.A.file('x.sldprt').path, { description: 'From A' }))
    await w.run(w.A.command('checkin', { files: [w.A.file('x.sldprt')] }))
    await w.settle()
    await w.run(w.B.command('checkout', { files: [w.B.file('x.sldprt')] }))
    w.B.on(() => w.B.state().updatePendingMetadata(w.B.file('x.sldprt').path, { part_number: 'P-2' }))
    await w.run(w.B.command('checkin', { files: [w.B.file('x.sldprt')] }))
    await w.settle()

    const row = w.server.fileAt('x.sldprt')!
    expect([row.part_number, row.description]).toEqual(['P-2', 'From A'])
    for (const m of [w.A, w.B]) {
      expect(m.file('x.sldprt').pdmData?.part_number, `${m.name}\n${w.dump()}`).toBe('P-2')
      expect(m.file('x.sldprt').pdmData?.description, `${m.name}\n${w.dump()}`).toBe('From A')
    }
    await w.expectConverged()
  })

  it('B restarts with an unsaved metadata edit: the edit survives the restart and checks in', async () => {
    const w = (world = await World.create(['A', 'B']))
    w.seed({ path: 'x.sldprt', partNumber: 'P-1', description: 'Original' })
    await w.boot()

    await w.run(w.B.command('checkout', { files: [w.B.file('x.sldprt')] }))
    w.B.on(() => w.B.state().updatePendingMetadata(w.B.file('x.sldprt').path, { description: 'Unsaved on B' }))
    await w.settle()
    await w.restart('B')
    await w.settle()

    expect(w.B.file('x.sldprt').pendingMetadata?.description, w.dump()).toBe('Unsaved on B')
    expect(w.server.fileAt('x.sldprt')?.description).toBe('Original')
    await w.run(w.B.command('checkin', { files: [w.B.file('x.sldprt')] }))
    await w.settle()
    expect(w.server.fileAt('x.sldprt')?.description).toBe('Unsaved on B')
    expect(w.A.file('x.sldprt').pdmData?.description).toBe('Unsaved on B')
    await w.expectConverged()
  })

  it('A checks out and checks in while B is closed: B starts with the right holder and version', async () => {
    const w = (world = await World.create(['A', 'B']))
    w.seed({ path: 'x.sldprt' })
    w.seed({ path: 'y.sldprt' })
    await w.boot()
    w.B.shutdown()

    await w.run(w.A.command('checkout', { files: [w.A.file('x.sldprt'), w.A.file('y.sldprt')] }))
    await edit(w, 'A', 'x.sldprt', 'A version 2')
    await w.run(w.A.command('checkin', { files: [w.A.file('x.sldprt')] }))
    await w.settle()
    // B restarts on its IndexedDB cache: the delta query has to surface both changes.
    await w.restart('B')
    await w.settle()

    expect(w.B.file('x.sldprt').diffStatus, w.dump()).toBe('outdated')
    expect(w.B.file('y.sldprt').pdmData?.checked_out_by).toBe(USERS.A.id)
    await w.expectConverged()
  })
})
