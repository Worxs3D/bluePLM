import { describe, expect, it } from 'vitest'

import type { PDMFile } from '@/types/pdm'

import { createLocalWriteGuard } from './realtimeLocalWrites'

type Row = Partial<PDMFile>

/** A store with one mutable row per file id, read the way the hook reads it. */
function store(initial: Record<string, Row>) {
  const rows = new Map(Object.entries(initial))
  return {
    read: (id: string) => rows.get(id),
    write: (id: string, patch: Row) => rows.set(id, { ...rows.get(id), ...patch }),
  }
}

const event: Row = {
  id: 'f1',
  file_path: 'b/x.sldprt',
  checked_out_by: null,
  version: 2,
  custom_properties: { a: 1 } as unknown as PDMFile['custom_properties'],
}

describe('createLocalWriteGuard', () => {
  it('passes an update through when nothing local changed since it was queued', () => {
    const s = store({ f1: { id: 'f1', file_path: 'a/x.sldprt', checked_out_by: null, version: 1 } })
    const guard = createLocalWriteGuard(s.read)
    guard.queued('f1', 'pdm')
    expect(guard.withoutLocalChanges('f1', event)).toBe(event)
  })

  it('passes an update through for a file that was never queued', () => {
    const s = store({ f1: { id: 'f1', checked_out_by: 'me' } })
    const guard = createLocalWriteGuard(s.read)
    expect(guard.withoutLocalChanges('f1', event)).toBe(event)
  })

  it('passes an update through when the file has no row now, or had none when queued', () => {
    const s = store({})
    const guard = createLocalWriteGuard(s.read)
    guard.queued('f1', 'pdm')
    s.write('f1', { id: 'f1', checked_out_by: 'me' })
    expect(guard.withoutLocalChanges('f1', event)).toBe(event)

    const t = store({ f1: { id: 'f1', checked_out_by: null } })
    const other = createLocalWriteGuard(t.read)
    other.queued('f1', 'pdm')
    expect(other.withoutLocalChanges('f1', event, undefined)).toBe(event)
  })

  it('drops exactly the fields a local write changed, keeping the id and the rest', () => {
    const s = store({ f1: { id: 'f1', file_path: 'a/x.sldprt', checked_out_by: null, version: 1 } })
    const guard = createLocalWriteGuard(s.read)
    guard.queued('f1', 'location')
    // This machine checks the file out after the event was queued.
    s.write('f1', { checked_out_by: 'me' })

    const kept = guard.withoutLocalChanges('f1', event)
    expect(kept).toEqual({
      id: 'f1',
      file_path: 'b/x.sldprt',
      version: 2,
      custom_properties: { a: 1 },
    })
    expect('checked_out_by' in kept).toBe(false)
    expect(event.checked_out_by).toBeNull()
  })

  it('never drops the id, even when the stored id changed', () => {
    const s = store({ f1: { id: 'old' } })
    const guard = createLocalWriteGuard(s.read)
    guard.queued('f1', 'pdm')
    s.write('f1', { id: 'f1' })
    expect(guard.withoutLocalChanges('f1', { id: 'f1' }).id).toBe('f1')
  })

  it('compares structured values by content, not identity', () => {
    const s = store({ f1: { id: 'f1', custom_properties: { a: 1 } as unknown as PDMFile['custom_properties'] } })
    const guard = createLocalWriteGuard(s.read)
    guard.queued('f1', 'pdm')
    // A new object with the same content is not a local change.
    s.write('f1', { custom_properties: { a: 1 } as unknown as PDMFile['custom_properties'], checked_out_by: 'me' })
    expect(guard.withoutLocalChanges('f1', event).custom_properties).toEqual({ a: 1 })

    // Different content is.
    s.write('f1', { custom_properties: { a: 2 } as unknown as PDMFile['custom_properties'] })
    expect('custom_properties' in guard.withoutLocalChanges('f1', event)).toBe(false)
  })

  it('takes the row to compare from the caller when given', () => {
    const s = store({ f1: { id: 'f1', checked_out_by: null } })
    const guard = createLocalWriteGuard(s.read)
    guard.queued('f1', 'pdm')
    const kept = guard.withoutLocalChanges('f1', event, { id: 'f1', checked_out_by: 'me' })
    expect('checked_out_by' in kept).toBe(false)
  })

  it('keeps the first snapshot while the file stays queued', () => {
    const s = store({ f1: { id: 'f1', checked_out_by: null } })
    const guard = createLocalWriteGuard(s.read)
    guard.queued('f1', 'pdm')
    s.write('f1', { checked_out_by: 'me' })
    // A second event for the same file does not move the snapshot past the local write.
    guard.queued('f1', 'pdm')
    expect('checked_out_by' in guard.withoutLocalChanges('f1', event)).toBe(false)
  })

  it("after realtime's own flush, a file still waiting in another queue compares against what realtime wrote", () => {
    const s = store({ f1: { id: 'f1', file_path: 'a/x.sldprt', checked_out_by: null } })
    const guard = createLocalWriteGuard(s.read)
    guard.queued('f1', 'location')
    guard.queued('f1', 'pdm')
    // The location queue flushes: realtime, not a local write, changes the path.
    s.write('f1', { file_path: 'b/x.sldprt' })
    guard.flushed('f1', 'location')
    expect(guard.withoutLocalChanges('f1', { id: 'f1', file_path: 'c/x.sldprt' }).file_path).toBe('c/x.sldprt')
  })

  it('forgets a file once every queue holding it has flushed', () => {
    const s = store({ f1: { id: 'f1', checked_out_by: null } })
    const guard = createLocalWriteGuard(s.read)
    guard.queued('f1', 'pdm')
    guard.flushed('f1', 'pdm')
    // A local write after the flush, then a new event: a fresh snapshot, nothing dropped.
    s.write('f1', { checked_out_by: 'me' })
    guard.queued('f1', 'pdm')
    expect(guard.withoutLocalChanges('f1', event)).toBe(event)
  })

  it('ignores a flush for a file it does not hold, or from a queue it was not in', () => {
    const s = store({ f1: { id: 'f1', checked_out_by: null } })
    const guard = createLocalWriteGuard(s.read)
    guard.flushed('f1', 'pdm')
    guard.queued('f1', 'pdm')
    s.write('f1', { checked_out_by: 'me' })
    guard.flushed('f1', 'location')
    // Still queued in 'pdm': the snapshot was refreshed but the file is held, so a later local
    // write is still caught.
    s.write('f1', { checked_out_by: 'someone' })
    expect('checked_out_by' in guard.withoutLocalChanges('f1', event)).toBe(false)
  })
})
