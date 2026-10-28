// @vitest-environment jsdom
/**
 * Moves and renames with two machines on one server: one machine moves, the other holds the
 * files on its disk. The other machine must keep its copy, show the move as pending (a `moved`
 * row where its bytes are, a `moved_away` stub where the server says), give the same answer on
 * a reload, and land where the server says after Re-align.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/client', async (importOriginal) =>
  (await import('@/test/multi/clientMock')).mockMachineClientModule(await importOriginal()),
)

import type { Machine } from './machine'
import { USERS, World } from './world'

let world: World | null = null
afterEach(() => {
  world?.dispose()
  world = null
})

const statusOf = (m: Machine, path: string) => {
  const f = m.find(path)
  return f ? (f.diffStatus ?? 'synced') : 'absent'
}

/** B shows `from` as a pending move to the server's `to`, and still has its bytes at `from`. */
function expectPendingMove(w: World, m: Machine, from: string, to: string): void {
  expect(statusOf(m, from), w.dump()).toBe('moved')
  expect(m.file(from).pdmData?.file_path).toBe(to)
  expect(statusOf(m, to), w.dump()).toBe('moved_away')
  expect(m.file(to).movedToRelativePath).toBe(from)
  expect(m.disk.get(m.absolute(from)), `${m.name} lost its copy of ${from}`).toBeDefined()
  expect(m.disk.recycleBin, `${m.name} recycled a file another machine moved`).toEqual([])
}

describe('moves and renames across machines', () => {
  it('A cannot rename a folder while B holds a file in it; nothing changes anywhere', async () => {
    const w = (world = await World.create(['A', 'B']))
    w.seed({ path: 'Parts/x.sldprt', checkedOutBy: USERS.B.id })
    w.seed({ path: 'Parts/y.sldprt' })
    await w.boot()
    const server = w.serverView()

    const result = await w.run(w.A.command('rename', { file: w.A.file('Parts'), newName: 'Parts2' }))
    await w.settle()

    expect(result.success).toBe(false)
    expect(w.serverView()).toEqual(server)
    expect(w.view(w.A).disk.map((d) => d.path)).toEqual(['Parts/x.sldprt', 'Parts/y.sldprt'])
    await w.expectConverged()
  })

  it('A moves a file B has: B keeps its copy as a pending move, and Re-align follows the server', async () => {
    const w = (world = await World.create(['A', 'B']))
    w.seed({ path: 'a/x.sldprt' })
    w.seed({ path: 'a/y.sldprt' })
    // The UI moves into a folder that exists (a drop target).
    w.seed({ path: 'b/z.sldprt' })
    await w.boot()

    expect((await w.run(w.A.command('move', { files: [w.A.file('a/x.sldprt')], targetFolder: 'b' }))).success).toBe(true)
    await w.settle()
    expectPendingMove(w, w.B, 'a/x.sldprt', 'b/x.sldprt')
    await w.expectStableAcrossReload(w.B)
    expectPendingMove(w, w.B, 'a/x.sldprt', 'b/x.sldprt')

    await w.run(w.B.realign())
    await w.settle()
    expect(statusOf(w.B, 'b/x.sldprt'), w.dump()).toBe('synced')
    expect(w.B.find('a/x.sldprt')).toBeUndefined()
    await w.expectConverged()
  })

  it('A renames a folder B has: every file in it is a pending move on B until Re-align', async () => {
    const w = (world = await World.create(['A', 'B']))
    w.seed({ path: 'a/x.sldprt' })
    w.seed({ path: 'a/y.sldprt' })
    await w.boot()

    expect((await w.run(w.A.command('rename', { file: w.A.file('a'), newName: 'c' }))).success).toBe(true)
    await w.settle()
    expectPendingMove(w, w.B, 'a/x.sldprt', 'c/x.sldprt')
    expectPendingMove(w, w.B, 'a/y.sldprt', 'c/y.sldprt')
    await w.expectStableAcrossReload(w.B)

    await w.run(w.B.realign())
    await w.settle()
    expect(w.view(w.B).disk.map((d) => d.path)).toEqual(['c/x.sldprt', 'c/y.sldprt'])
    await w.expectConverged()
  })

  it('A moves a file while B is closed: B starts, keeps its copy as a pending move, recycles nothing', async () => {
    const w = (world = await World.create(['A', 'B']))
    w.seed({ path: 'a/x.sldprt' })
    w.seed({ path: 'b/z.sldprt' })
    await w.boot()
    w.B.shutdown()

    await w.run(w.A.command('move', { files: [w.A.file('a/x.sldprt')], targetFolder: 'b' }))
    await w.settle()
    await w.restart('B')
    await w.settle()

    expectPendingMove(w, w.B, 'a/x.sldprt', 'b/x.sldprt')
    await w.expectStableAcrossReload(w.B)
    await w.run(w.B.realign())
    await w.expectConverged()
  })

  // 2026-10-25, known failure, needs a product decision (found by the random runner). B renamed
  // folder a; A holds that as a pending move, checks a/x out and back in. Check-in sees a local
  // path that differs from the server's and asks "This file was renamed or moved locally. Update
  // the server path?" - but A moved nothing: B did. Answering yes, as the wording invites, moves
  // the row back to a/x and undoes B's rename for that file. Options: refuse the check-in of a
  // file whose pending move came from the server, as Move already does ("resolve the pending
  // move first"); offer to adopt the server path first; or at least say who moved it.
  it.fails("checking in a file another machine moved does not undo that move", async () => {
    const w = (world = await World.create(['A', 'B']))
    w.seed({ path: 'a/x.sldprt' })
    await w.boot()
    await w.run(w.B.command('rename', { file: w.B.file('a'), newName: 'a-r1' }))
    await w.settle()
    expectPendingMove(w, w.A, 'a/x.sldprt', 'a-r1/x.sldprt')

    await w.run(w.A.command('checkout', { files: [w.A.file('a/x.sldprt')] }))
    await w.run(w.A.command('checkin', { files: [w.A.file('a/x.sldprt')] }))
    await w.settle()

    expect(w.server.fileAt('a-r1/x.sldprt'), `B's rename was undone\n${w.dump()}`).toBeDefined()
  })

  it('a file moved in Explorer while a checkout runs is noticed when the checkout finishes', async () => {
    const w = (world = await World.create(['A', 'B']))
    w.seed({ path: 'a/x.sldprt' })
    w.seed({ path: 'a/y.sldprt' })
    w.seed({ path: 'b/z.sldprt' })
    await w.boot()
    // The checkout spends a few seconds clearing read-only bits.
    const api = w.A.ctx.electronAPI
    w.A.ctx.electronAPI = new Proxy(api, {
      get: (target, prop, receiver) => {
        const value = Reflect.get(target, prop, receiver)
        if (prop !== 'setReadonlyBatch' && prop !== 'setReadonly') return value
        return async (...args: unknown[]) => {
          await new Promise((resolve) => setTimeout(resolve, 3000))
          return (value as (...a: unknown[]) => unknown)(...args)
        }
      },
    })
    const checkout = w.A.command('checkout', { files: [w.A.file('a/x.sldprt')] })
    await w.run(new Promise((resolve) => setTimeout(resolve, 500)))
    expect(w.A.state().processingOperations.size, 'the checkout should still be running').toBeGreaterThan(0)
    w.A.on(() => w.A.disk.move(w.A.absolute('b/z.sldprt'), w.A.absolute('a/z.sldprt')))
    await w.run(checkout)
    w.A.ctx.electronAPI = api
    await w.settle()

    expectPendingMove(w, w.A, 'a/z.sldprt', 'b/z.sldprt')
  })

  it('a case-only rename on A: B keeps one row per file in its own spelling, and a reload agrees', async () => {
    const w = (world = await World.create(['A', 'B']))
    w.seed({ path: 'Parts/x.sldprt' })
    await w.boot()

    await w.run(w.A.command('rename', { file: w.A.file('Parts/x.sldprt'), newName: 'X.sldprt' }))
    await w.settle()
    await w.run(w.A.command('rename', { file: w.A.file('Parts'), newName: 'PARTS' }))
    await w.settle()

    expect(w.server.fileAt('PARTS/X.sldprt')).toBeDefined()
    const rows = w.B.files().filter((f) => !f.isDirectory)
    expect(rows.map((f) => [f.relativePath, f.diffStatus ?? 'synced']), w.dump()).toEqual([['Parts/x.sldprt', 'synced']])
    await w.expectConverged()
  })

  it('barxt600: B moves a folder in Explorer and uploads from it: one row per file, the move stays pending', async () => {
    const w = (world = await World.create(['A', 'B']))
    w.seed({ path: 'Old/x.sldprt' })
    await w.boot()

    w.B.on(() => w.B.disk.move(w.B.absolute('Old'), w.B.absolute('New')))
    await w.settle()
    expectPendingMove(w, w.B, 'New/x.sldprt', 'Old/x.sldprt')

    await w.run(w.B.command('sync', { files: [w.B.file('New/x.sldprt')] }))
    await w.settle()
    w.expectServerSound()
    expect(w.serverView().map((r) => r.path)).toEqual(['Old/x.sldprt'])
    await w.expectConverged({ allowPendingMoves: true })
  })
})
