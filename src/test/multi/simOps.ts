/**
 * Random multi-machine sequences: the operations, how each one runs, and the checks between them.
 *
 * An operation names a machine and picks its target by index into that machine's own view at
 * the moment it runs (sorted store rows, or folders), so any sequence is runnable whatever the
 * earlier steps did, and a shrunk sequence stays meaningful. `runSequence` is what the property
 * test runs and what a saved regression replays.
 *
 * Checks:
 * - after every step: the server is sound (one live row per file's bytes, no part number or
 *   description that was ever filled now blank), and an operation the app or the server refused
 *   left this machine's disk and the server as they were;
 * - at the end: every held queue released, every machine reconnected (missed events lost, as with
 *   Supabase), quiet, then every machine agrees with the server and its disk, and a reload changes
 *   nothing. Pending moves are allowed at the end: another machine's move is pending on this one
 *   until someone resolves it.
 */
import fc from 'fast-check'
import { expect } from 'vitest'

import type { Machine } from './machine'
import { World } from './world'

export const MACHINES = ['A', 'B'] as const
export type MachineName = (typeof MACHINES)[number]

export type Op =
  | { kind: 'checkout' | 'checkin' | 'discard' | 'deleteServer' | 'getLatest' | 'download'; on: MachineName; pick: number }
  | { kind: 'edit'; on: MachineName; pick: number }
  | { kind: 'work'; on: MachineName; pick: number; field: 'part_number' | 'description' | null; bytes: boolean }
  | { kind: 'metadata'; on: MachineName; pick: number; field: 'part_number' | 'description' }
  | { kind: 'rename'; on: MachineName; pick: number; caseOnly: boolean }
  | { kind: 'move'; on: MachineName; pick: number; folder: number }
  | { kind: 'renameFolder'; on: MachineName; folder: number }
  | { kind: 'explorerMove'; on: MachineName; pick: number; folder: number }
  | { kind: 'reload' | 'restart' | 'realign'; on: MachineName }
  | { kind: 'hold' | 'release' | 'disconnect' | 'reconnect'; on: MachineName }
  | { kind: 'wait'; ms: number }

const machine = fc.constantFrom(...MACHINES)
const pick = fc.nat(7)

export const opArbitrary: fc.Arbitrary<Op> = fc.oneof(
  { weight: 4, arbitrary: fc.record({ kind: fc.constant('checkout' as const), on: machine, pick }) },
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('checkin' as const), on: machine, pick }) },
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('edit' as const), on: machine, pick }) },
  {
    // A user's whole edit: check out, change the bytes and/or a field, check in.
    weight: 5,
    arbitrary: fc.record({
      kind: fc.constant('work' as const),
      on: machine,
      pick,
      field: fc.constantFrom('part_number' as const, 'description' as const, null),
      bytes: fc.boolean(),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant('metadata' as const),
      on: machine,
      pick,
      field: fc.constantFrom('part_number' as const, 'description' as const),
    }),
  },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('discard' as const), on: machine, pick }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('rename' as const), on: machine, pick, caseOnly: fc.boolean() }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('move' as const), on: machine, pick, folder: fc.nat(3) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('renameFolder' as const), on: machine, folder: fc.nat(3) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('explorerMove' as const), on: machine, pick, folder: fc.nat(3) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('deleteServer' as const), on: machine, pick }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('getLatest' as const), on: machine, pick }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('download' as const), on: machine, pick }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constantFrom('reload' as const, 'restart' as const, 'realign' as const), on: machine }) },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constantFrom('hold' as const, 'release' as const, 'disconnect' as const, 'reconnect' as const),
      on: machine,
    }),
  },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('wait' as const), ms: fc.integer({ min: 0, max: 3000 }) }) },
)

/** The vault every sequence starts from: on the server and on both disks. */
export function seedVault(w: World): void {
  w.seed({ path: 'a/x.sldprt', partNumber: 'P-X', description: 'Part X' })
  w.seed({ path: 'a/y.sldprt', partNumber: 'P-Y', description: 'Part Y' })
  w.seed({ path: 'b/z.sldasm', partNumber: 'P-Z', description: 'Assembly Z' })
  w.seed({ path: 'top.sldprt' })
}

const files = (m: Machine) =>
  m
    .files()
    .filter((f) => !f.isDirectory)
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath))
const folders = (m: Machine) =>
  m
    .files()
    .filter((f) => f.isDirectory)
    .map((f) => f.relativePath)
    .sort((a, b) => a.localeCompare(b))
const at = <T>(list: T[], index: number): T | undefined => (list.length === 0 ? undefined : list[index % list.length])

export interface Step {
  op: Op
  outcome: string
}

/** Run one operation. Returns what happened, for the failure report. */
async function apply(w: World, op: Op, counter: { n: number }): Promise<string> {
  const net = w.server.network
  if (op.kind === 'wait') {
    await w.run(new Promise((resolve) => setTimeout(resolve, op.ms)))
    return 'waited'
  }
  const m = w.machine(op.on)
  switch (op.kind) {
    case 'hold':
      net.hold(m.name)
      return 'held'
    case 'release':
      net.release(m.name)
      return 'released'
    case 'disconnect':
      net.disconnect(m.name)
      return 'disconnected'
    case 'reconnect':
      net.reconnect(m.name, { catchUp: false })
      return 'reconnected'
    case 'reload':
      await w.run(m.load(false))
      return 'reloaded'
    case 'restart':
      await w.restart(m.name)
      return 'restarted'
    case 'realign':
      return JSON.stringify(await w.run(m.realign()))
    case 'renameFolder': {
      const folder = at(folders(m), op.folder)
      if (!folder) return 'no folder'
      return outcome(await w.run(m.command('rename', { file: m.file(folder), newName: `${folder.split('/').pop()}-r${++counter.n}` })))
    }
    default:
      break
  }

  // A `moved_away` stub has nothing on disk. Move refuses it and Delete handles it on purpose;
  // the other commands are not offered it here (an open question for the UI: see the report).
  const candidates = op.kind === 'deleteServer' ? files(m) : files(m).filter((f) => f.diffStatus !== 'moved_away')
  const file = at(candidates, op.pick)
  if (!file) return 'no file'
  switch (op.kind) {
    case 'checkout':
      return outcome(await w.run(m.command('checkout', { files: [file] })))
    case 'checkin':
      return outcome(await w.run(m.command('checkin', { files: [file] })))
    case 'discard':
      return outcome(await w.run(m.command('discard', { files: [file] })))
    case 'deleteServer':
      return outcome(await w.run(m.command('delete-server', { files: [file], deleteLocal: true })))
    case 'getLatest':
      return outcome(await w.run(m.command('get-latest', { files: [file] })))
    case 'download':
      return outcome(await w.run(m.command('download', { files: [file] })))
    case 'work': {
      const out = await w.run(m.command('checkout', { files: [file] }))
      if (!out.success) return `checkout ${outcome(out)}`
      const held = m.find(file.relativePath)
      if (!held) return 'checked out, then gone'
      if (op.bytes) {
        await w.run(new Promise((resolve) => setTimeout(resolve, 6000)))
        m.on(() => m.disk.write(held.path, `${m.name} work ${++counter.n}`))
      }
      if (op.field) m.on(() => m.state().updatePendingMetadata(held.path, { [op.field!]: `${op.field}-${m.name}-${++counter.n}` }))
      await w.settle()
      const current = m.find(file.relativePath)
      if (!current) return 'edited, then gone'
      return `worked, checkin ${outcome(await w.run(m.command('checkin', { files: [current] })))}`
    }
    case 'edit': {
      const entry = m.disk.get(file.path)
      if (!entry || entry.readonly) return 'not writable'
      // A person saving in SolidWorks takes longer than the watcher's 5 s window after an
      // operation; an edit inside it is a known gap (editsAcrossMachines.test.ts).
      await w.run(new Promise((resolve) => setTimeout(resolve, 6000)))
      m.on(() => m.disk.write(file.path, `${m.name} edit ${++counter.n}`))
      return 'edited'
    }
    case 'metadata': {
      if (file.pdmData?.checked_out_by !== m.user.id) return 'not checked out here'
      m.on(() => m.state().updatePendingMetadata(file.path, { [op.field]: `${op.field}-${m.name}-${++counter.n}` }))
      return 'pending metadata'
    }
    case 'rename': {
      const dot = file.name.lastIndexOf('.')
      const stem = file.name.slice(0, dot)
      const newName = op.caseOnly
        ? `${stem === stem.toUpperCase() ? stem.toLowerCase() : stem.toUpperCase()}${file.name.slice(dot)}`
        : `${stem}-r${++counter.n}${file.name.slice(dot)}`
      return outcome(await w.run(m.command('rename', { file, newName })))
    }
    case 'move': {
      const folder = at(['', ...folders(m)], op.folder)
      if (folder === undefined) return 'no folder'
      return outcome(await w.run(m.command('move', { files: [file], targetFolder: folder })))
    }
    case 'explorerMove': {
      // The user moves the file in Windows Explorer; only the watcher tells the app.
      const folder = at(folders(m), op.folder)
      if (!folder || !m.disk.get(file.path)) return 'nothing to move'
      const target = m.absolute(`${folder}/${file.name}`)
      if (m.disk.exists(target)) return 'target exists'
      // Past the watcher's 5 s window after an operation, as a person in Explorer would be.
      await w.run(new Promise((resolve) => setTimeout(resolve, 6000)))
      if (!m.disk.get(file.path) || m.disk.exists(target)) return 'nothing to move'
      m.on(() => m.disk.move(file.path, target))
      return 'moved in Explorer'
    }
  }
  return 'unknown'
}

function outcome(result: { success: boolean; succeeded?: number; message?: string }): string {
  return `${result.success ? 'ok' : 'refused'}: ${result.message ?? ''}`
}

/** Operations whose refusal must leave the machine's disk and the server untouched. */
const COMMANDS = new Set(['checkout', 'checkin', 'discard', 'deleteServer', 'rename', 'move', 'renameFolder'])

export async function runSequence(ops: readonly Op[]): Promise<Step[]> {
  const w = await World.create([...MACHINES])
  const steps: Step[] = []
  const counter = { n: 0 }
  try {
    seedVault(w)
    await w.boot()
    for (const op of ops) {
      const before = op.kind !== 'wait' && COMMANDS.has(op.kind)
        ? { disk: w.view(w.machine(op.on)).disk, server: w.serverView() }
        : null
      const result = await apply(w, op, counter)
      steps.push({ op, outcome: result })
      const label = () => `after ${JSON.stringify(op)} -> ${result}\n${describe(steps)}\n${w.dump()}`
      w.expectServerSound()
      if (before && result.startsWith('refused') && !result.includes('/')) {
        expect(w.serverView(), `a refused operation changed the server\n${label()}`).toEqual(before.server)
        expect(w.view(w.machine((op as { on: MachineName }).on)).disk, `a refused operation changed the disk\n${label()}`).toEqual(
          before.disk,
        )
      }
    }
    for (const name of MACHINES) {
      if (w.server.network.link(name).held) w.server.network.release(name)
      if (!w.server.network.link(name).connected) w.server.network.reconnect(name, { catchUp: false })
    }
    await w.settle()
    try {
      await w.expectConverged({ allowPendingMoves: true })
      if (process.env.MULTI_SIM_TRACE) console.warn(`SEQUENCE
${describe(steps)}`)
    } catch (error) {
      ;(error as Error).message = `${(error as Error).message}\n${describe(steps)}\n${w.dump()}`
      throw error
    }
    return steps
  } finally {
    w.dispose()
  }
}

function describe(steps: Step[]): string {
  return steps.map((s, i) => `  ${i + 1}. ${JSON.stringify(s.op)} -> ${s.outcome}`).join('\n')
}
