// @vitest-environment jsdom
/**
 * Checkout and check-in with two machines on one server, under realtime delay, loss and
 * duplication. After each scenario every machine must show what the server holds, and a reload
 * must change nothing (World.expectConverged).
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

async function twoMachines(path = 'x.sldprt'): Promise<World> {
  world = await World.create(['A', 'B'])
  world.seed({ path, partNumber: 'P-1', description: 'Bracket' })
  await world.boot()
  return world
}

/** Write new bytes into a file this machine holds, and let the watcher report it. */
async function edit(w: World, name: 'A' | 'B', path: string, body: string): Promise<void> {
  const m = w.machine(name)
  m.on(() => m.disk.write(m.absolute(path), body))
  await w.settle()
}

describe('checkout across machines', () => {
  it('B checks out right after A checks in: A shows B as the holder (stale checkout owner)', async () => {
    const w = await twoMachines()
    expect((await w.run(w.A.command('checkout', { files: [w.A.file('x.sldprt')] }))).success).toBe(true)
    await edit(w, 'A', 'x.sldprt', 'A version 2')
    expect((await w.run(w.A.command('checkin', { files: [w.A.file('x.sldprt')] }))).success).toBe(true)
    await w.settle()

    // Within the 15 s A's check-in marks the file "recently modified".
    expect((await w.run(w.B.command('checkout', { files: [w.B.file('x.sldprt')] }))).success).toBe(true)
    await w.settle()

    expect(w.server.fileAt('x.sldprt')?.checked_out_by).toBe(USERS.B.id)
    expect(w.A.file('x.sldprt').pdmData?.checked_out_by, w.dump()).toBe(USERS.B.id)
    await w.expectConverged()
  })

  it('B checks out and checks in quickly: its own late echoes do not put the checkout back', async () => {
    const w = await twoMachines()
    await w.run(w.B.command('checkout', { files: [w.B.file('x.sldprt')] }))
    await w.run(w.B.command('checkin', { files: [w.B.file('x.sldprt')] }))
    await w.settle()

    expect(w.server.fileAt('x.sldprt')?.checked_out_by).toBeNull()
    expect(w.B.file('x.sldprt').pdmData?.checked_out_by, w.dump()).toBeNull()
    await w.expectConverged()
  })

  it("A checks in while B's realtime is delayed: B's stale view refuses, then catches up", async () => {
    const w = await twoMachines()
    await w.run(w.A.command('checkout', { files: [w.A.file('x.sldprt')] }))
    await w.settle()
    w.server.network.hold('B')
    await edit(w, 'A', 'x.sldprt', 'A version 2')
    await w.run(w.A.command('checkin', { files: [w.A.file('x.sldprt')] }))
    await w.settle()

    // B still believes A holds the file, so it refuses before asking the server.
    const before = w.view(w.B)
    const refused = await w.run(w.B.command('checkout', { files: [w.B.file('x.sldprt')] }))
    expect(refused.success).toBe(false)
    expect(w.view(w.B), 'a refused checkout changed B').toEqual(before)

    w.server.network.release('B')
    await w.settle()
    expect(w.B.file('x.sldprt').diffStatus).toBe('outdated')
    await w.run(w.B.command('get-latest', { files: [w.B.file('x.sldprt')] }))
    await w.settle()
    expect(w.B.disk.bytes(w.B.absolute('x.sldprt'))).toBe(w.A.disk.bytes(w.A.absolute('x.sldprt')))
    await w.expectConverged()
  })

  it("the server refuses B's checkout of a file A holds; B's view of a stale free file is corrected", async () => {
    const w = await twoMachines()
    // B never hears about A's checkout.
    w.server.network.fault = (_event, machine) => (machine === 'B' ? { kind: 'drop' } : { kind: 'deliver' })
    await w.run(w.A.command('checkout', { files: [w.A.file('x.sldprt')] }))
    await w.settle()
    w.server.network.fault = () => ({ kind: 'deliver' })
    expect(w.B.file('x.sldprt').pdmData?.checked_out_by).toBeNull()

    const result = await w.run(w.B.command('checkout', { files: [w.B.file('x.sldprt')] }))
    await w.settle()
    expect(result.success).toBe(false)
    expect(w.server.fileAt('x.sldprt')?.checked_out_by).toBe(USERS.A.id)
    expect(w.B.disk.require(w.B.absolute('x.sldprt')).readonly, 'B made writable a file it does not hold').toBe(true)
    expect(w.B.file('x.sldprt').pdmData?.checked_out_by, w.dump()).toBe(USERS.A.id)
    await w.expectConverged()
  })

  it('B loses its realtime connection while A checks out and in: B catches up when it reconnects', async () => {
    const w = await twoMachines()
    w.server.network.disconnect('B')
    await w.run(w.A.command('checkout', { files: [w.A.file('x.sldprt')] }))
    await edit(w, 'A', 'x.sldprt', 'A version 2')
    await w.run(w.A.command('checkin', { files: [w.A.file('x.sldprt')] }))
    await w.run(w.A.command('checkout', { files: [w.A.file('x.sldprt')] }))
    await w.settle()

    // Supabase Realtime does not replay what a dropped socket missed.
    w.server.network.reconnect('B', { catchUp: false })
    await w.settle()
    expect(w.B.file('x.sldprt').pdmData?.checked_out_by, w.dump()).toBe(USERS.A.id)
    expect(w.B.file('x.sldprt').diffStatus).toBe('outdated')
    await w.expectConverged()
  })

  it('every event delivered twice changes nothing', async () => {
    const w = await twoMachines()
    w.server.network.fault = () => ({ kind: 'duplicate' })
    await w.run(w.A.command('checkout', { files: [w.A.file('x.sldprt')] }))
    await edit(w, 'A', 'x.sldprt', 'A version 2')
    await w.run(w.A.command('checkin', { files: [w.A.file('x.sldprt')] }))
    await w.settle()
    await w.run(w.B.command('get-latest', { files: [w.B.file('x.sldprt')] }))
    await w.run(w.B.command('checkout', { files: [w.B.file('x.sldprt')] }))
    await w.settle()
    expect(w.A.file('x.sldprt').pdmData?.checked_out_by, w.dump()).toBe(USERS.B.id)
    await w.expectConverged()
  })
})
