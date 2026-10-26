// @vitest-environment jsdom
/**
 * The simulator itself: two machines boot on one server, each with its own store and disk, and
 * one machine's write reaches the other over realtime.
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

describe('two machines on one server', () => {
  it('boot separately and agree', async () => {
    world = await World.create(['A', 'B'])
    world.seed({ path: 'Parts/x.sldprt', partNumber: 'BR-1', description: 'Bracket' })
    world.seed({ path: 'top.sldasm' })
    await world.boot()

    expect(world.A.store).not.toBe(world.B.store)
    expect(world.A.file('Parts/x.sldprt').diffStatus ?? 'synced').toBe('synced')
    expect(world.B.file('Parts/x.sldprt').pdmData?.part_number).toBe('BR-1')
    await world.expectConverged()
  })

  it('a checkout on A reaches B over realtime', async () => {
    world = await World.create(['A', 'B'])
    world.seed({ path: 'Parts/x.sldprt' })
    await world.boot()

    const result = await world.run(world.A.command('checkout', { files: [world.A.file('Parts/x.sldprt')] }))
    expect(result.success).toBe(true)
    await world.settle()

    expect(world.server.fileAt('Parts/x.sldprt')?.checked_out_by).toBe(USERS.A.id)
    expect(world.B.file('Parts/x.sldprt').pdmData?.checked_out_by).toBe(USERS.A.id)
    expect(world.A.disk.require(world.A.absolute('Parts/x.sldprt')).readonly).toBe(false)
    expect(world.B.disk.require(world.B.absolute('Parts/x.sldprt')).readonly).toBe(true)
    await world.expectConverged()
  })
})
