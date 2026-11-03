import { describe, expect, it } from 'vitest'

import { en } from '@/lib/i18n/locales/en'
import type { AppliedInspectionBalloons } from '@/lib/inspection/types'

import { balloonOutcome } from './balloonOutcome'

const base: AppliedInspectionBalloons = {
  placed: 0,
  missing: [],
  removedPrevious: 0,
  keptPositions: 0,
  saved: true,
}

describe('balloonOutcome', () => {
  it('an unchanged reply on an Auto run is quiet, also about missing characteristics', () => {
    const out = balloonOutcome(
      { ...base, kept: 4, unchanged: true, saved: false, missing: ['k'] },
      true,
    )
    expect(out).toEqual({ status: 'unchanged', toasts: [] })
  })

  it('an unchanged reply on a click says so and is not a failed save', () => {
    const out = balloonOutcome({ ...base, kept: 4, unchanged: true, saved: false }, false)
    expect(out.status).toBe('unchanged')
    expect(out.toasts).toEqual([
      { kind: 'info', parts: [{ key: 'balloonUnchanged', values: { kept: 4 } }] },
    ])
  })

  it('an incremental update reports kept, placed and removed', () => {
    const out = balloonOutcome(
      {
        ...base,
        kept: 5,
        placed: 2,
        removedPrevious: 1,
        keptPositions: 1,
        unchanged: false,
        missing: ['a', 'b'],
      },
      true,
    )
    expect(out.status).toBe('saved')
    expect(out.toasts).toEqual([
      {
        kind: 'success',
        parts: [{ key: 'balloonUpdated', values: { kept: 5, placed: 2, removed: 1 } }],
      },
      { kind: 'warning', parts: [{ key: 'balloonMissing', values: { count: 2 } }] },
    ])
  })

  it('a service before 1.29.0 reads as before', () => {
    const out = balloonOutcome({ ...base, placed: 3, removedPrevious: 3, keptPositions: 2 }, false)
    expect(out.status).toBe('saved')
    expect(out.toasts).toEqual([
      {
        kind: 'success',
        parts: [
          { key: 'balloonApplied', values: { placed: 3, removedPrevious: 3 } },
          { key: 'balloonKeptPositions', values: { count: 2 } },
        ],
      },
    ])
  })

  it('a failed save is a warning and nothing else', () => {
    const out = balloonOutcome(
      { ...base, placed: 2, saved: false, kept: 1, unchanged: false, missing: ['x'] },
      false,
    )
    expect(out).toEqual({
      status: 'notSaved',
      toasts: [{ kind: 'warning', parts: [{ key: 'balloonNotSaved', values: { placed: 2 } }] }],
    })
  })

  it('every key it names exists in English', () => {
    const keys = [
      'balloonUnchanged',
      'balloonUpdated',
      'balloonApplied',
      'balloonKeptPositions',
      'balloonNotSaved',
      'balloonMissing',
    ]
    const inspection = (en as unknown as { source: { inspection: Record<string, unknown> } }).source
      .inspection
    for (const key of keys) expect(typeof inspection[key], key).toBe('string')
  })
})
