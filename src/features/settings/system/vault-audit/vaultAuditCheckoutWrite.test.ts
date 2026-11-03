import { describe, expect, it } from 'vitest'

import type { LocalFile } from '@/stores/pdmStore'

import { writeWithCheckout, type CheckoutWriteDeps } from './vaultAuditCheckoutWrite'

const ME = 'user-me'
const OTHER = 'user-other'

function fileOf(id: string, checkedOutBy: string | null, note?: string): LocalFile {
  return {
    name: `${id}.SLDPRT`,
    path: `C:\\vault\\${id}.SLDPRT`,
    relativePath: `${id}.SLDPRT`,
    extension: '.sldprt',
    diffStatus: undefined,
    pendingCheckinNote: note,
    pdmData: { id, checked_out_by: checkedOutBy },
  } as unknown as LocalFile
}

/** A fake store and command layer: checkout locks the ids in `lockable`, the rest stay free. */
function harness(initial: LocalFile[], lockable: ReadonlySet<string>) {
  let files = initial
  const calls: string[] = []
  const notes = new Map<string, string>()
  const ids = (list: LocalFile[]) => list.map((file) => file.pdmData?.id).join(',')

  const deps: CheckoutWriteDeps = {
    checkout: async (list) => {
      calls.push(`checkout:${ids(list)}`)
      files = files.map((file) =>
        lockable.has(file.pdmData?.id ?? '')
          ? ({ ...file, pdmData: { ...file.pdmData, checked_out_by: ME } } as LocalFile)
          : file,
      )
    },
    syncMetadata: async (list) => {
      calls.push(`sync:${ids(list)}`)
    },
    checkin: async (list) => {
      calls.push(`checkin:${ids(list)}`)
    },
    currentFiles: () => files,
    setCheckinNote: (path, note) => {
      notes.set(path, note)
      files = files.map((file) => (file.path === path ? { ...file, pendingCheckinNote: note } : file))
    },
  }
  return { deps, calls, notes }
}

describe('writeWithCheckout', () => {
  it('checks out, writes, then checks in only what it checked out', async () => {
    const mine = fileOf('a', ME)
    const free = fileOf('b', null)
    const { deps, calls, notes } = harness([mine, free], new Set(['b']))

    const outcome = await writeWithCheckout(
      { writable: [mine], checkoutable: [free], userId: ME, checkInAfter: true, checkinNote: 'n' },
      deps,
    )

    expect(calls).toEqual(['checkout:b', 'sync:a,b', 'checkin:b'])
    expect(outcome).toEqual({ written: ['a', 'b'], checkedOut: ['b'], notCheckedOut: [], checkedIn: ['b'] })
    expect([...notes.keys()]).toEqual([free.path])
  })

  // A colleague took the lock between the scan and the click: the file is not ours, so not written.
  it('leaves out a file the checkout did not give us', async () => {
    const lost = fileOf('c', null)
    const { deps, calls } = harness([{ ...lost, pdmData: { id: 'c', checked_out_by: OTHER } } as LocalFile], new Set())

    const outcome = await writeWithCheckout(
      { writable: [], checkoutable: [lost], userId: ME, checkInAfter: true, checkinNote: 'n' },
      deps,
    )

    expect(calls).toEqual(['checkout:c'])
    expect(outcome.notCheckedOut).toEqual(['c'])
    expect(outcome.written).toEqual([])
  })

  it('keeps everything checked out when check-in is off', async () => {
    const free = fileOf('d', null)
    const { deps, calls } = harness([free], new Set(['d']))

    const outcome = await writeWithCheckout(
      { writable: [], checkoutable: [free], userId: ME, checkInAfter: false, checkinNote: 'n' },
      deps,
    )

    expect(calls).toEqual(['checkout:d', 'sync:d'])
    expect(outcome.checkedIn).toEqual([])
  })

  it('never checks in a file that was already checked out, and keeps an existing note', async () => {
    const mine = fileOf('e', ME)
    const free = fileOf('f', null, 'my own note')
    const { deps, calls, notes } = harness([mine, free], new Set(['f']))

    await writeWithCheckout(
      { writable: [mine], checkoutable: [free], userId: ME, checkInAfter: true, checkinNote: 'n' },
      deps,
    )

    expect(calls).toEqual(['checkout:f', 'sync:e,f', 'checkin:f'])
    expect(notes.size).toBe(0)
  })

  it('skips checkout when nothing needs one', async () => {
    const mine = fileOf('g', ME)
    const { deps, calls } = harness([mine], new Set())

    await writeWithCheckout(
      { writable: [mine], checkoutable: [], userId: ME, checkInAfter: true, checkinNote: 'n' },
      deps,
    )

    expect(calls).toEqual(['sync:g'])
  })
})
