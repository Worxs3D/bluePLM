import { describe, expect, it } from 'vitest'

import {
  MAX_DRAWING_SYNC_STAMPS,
  autoBarState,
  boundStamps,
  clearExtract,
  decideAutoRun,
  drawingSyncStatus,
  isOffered,
  recordBalloon,
  recordExtract,
  syncReasonKey,
  type AutoRunInput,
  type DrawingSyncStamps,
} from './drawingSync'

const V = '1.28.0'

describe('drawingSyncStatus', () => {
  it('a drawing never extracted counts as changed for both flows', () => {
    expect(drawingSyncStatus(undefined, 'h1', V)).toEqual({ extract: 'never', balloon: 'never' })
    expect(drawingSyncStatus(undefined, null, V)).toEqual({ extract: 'never', balloon: 'never' })
  })

  it('extract alone leaves Balloon offered, and only Extract in sync', () => {
    const stamps = recordExtract({}, 'f', 'h1', V, 1)
    expect(drawingSyncStatus(stamps.f, 'h1', V)).toEqual({ extract: 'inSync', balloon: 'never' })
  })

  it('balloon records its own save as in sync for both flows', () => {
    const stamps = recordBalloon(recordExtract({}, 'f', 'h1', V, 1), 'f', 'h2', V, 2)
    expect(drawingSyncStatus(stamps.f, 'h2', V)).toEqual({ extract: 'inSync', balloon: 'inSync' })
  })

  it('a changed hash offers both again', () => {
    const stamps = recordBalloon({}, 'f', 'h2', V, 2)
    expect(drawingSyncStatus(stamps.f, 'h3', V)).toEqual({ extract: 'changed', balloon: 'changed' })
  })

  it('another service version counts as a change', () => {
    const stamps = recordBalloon({}, 'f', 'h2', '1.27.0', 2)
    expect(drawingSyncStatus(stamps.f, 'h2', V)).toEqual({ extract: 'service', balloon: 'service' })
  })

  it('an unknown current hash keeps the buttons offered', () => {
    const stamps = recordBalloon({}, 'f', 'h2', V, 2)
    const status = drawingSyncStatus(stamps.f, null, V)
    expect(status.extract).toBe('unknown')
    expect(isOffered(status.extract)).toBe(true)
  })

  it('only inSync disables', () => {
    expect(isOffered('inSync')).toBe(false)
    for (const r of ['never', 'changed', 'service', 'unknown'] as const)
      expect(isOffered(r)).toBe(true)
  })

  it('names the reason in the tooltip of a disabled button', () => {
    expect(syncReasonKey('extract', 'inSync')).toBe('source.inspection.extractUpToDateTitle')
    expect(syncReasonKey('balloon', 'inSync')).toBe('source.inspection.balloonUpToDateTitle')
    expect(syncReasonKey('balloon', 'changed')).toBe('source.inspection.balloonTitle')
  })
})

describe('stamp records', () => {
  it('re-extracting an unchanged ballooned drawing keeps its balloons in sync', () => {
    const ballooned = recordBalloon({}, 'f', 'h2', V, 1)
    expect(recordExtract(ballooned, 'f', 'h2', V, 2).f.balloonHash).toBe('h2')
    expect(recordExtract(ballooned, 'f', 'h3', V, 2).f.balloonHash).toBeNull()
  })

  it('undo of an extraction offers Extract again', () => {
    const stamps = clearExtract(recordExtract({}, 'f', 'h1', V, 1), 'f', 2)
    expect(drawingSyncStatus(stamps.f, 'h1', V).extract).toBe('never')
    expect(clearExtract({}, 'none', 3)).toEqual({})
  })

  it('keeps at most the bound, dropping the oldest', () => {
    let stamps: DrawingSyncStamps = {}
    for (let i = 0; i < MAX_DRAWING_SYNC_STAMPS + 5; i++) {
      stamps = recordExtract(stamps, `f${i}`, 'h', V, i)
    }
    expect(Object.keys(stamps)).toHaveLength(MAX_DRAWING_SYNC_STAMPS)
    expect(stamps.f0).toBeUndefined()
    expect(stamps[`f${MAX_DRAWING_SYNC_STAMPS + 4}`]).toBeDefined()
    expect(boundStamps({ a: stamps.f10 }, 1)).toEqual({ a: stamps.f10 })
  })
})

describe('decideAutoRun', () => {
  const base = (over: Partial<AutoRunInput> = {}): AutoRunInput => ({
    autoEnabled: true,
    editable: true,
    hasLinkedRows: true,
    ready: true,
    inFlight: false,
    currentHash: 'h3',
    stamp: recordBalloon({}, 'f', 'h2', V, 1).f,
    serviceVersion: V,
    failedHash: null,
    settleUntil: 0,
    now: 100_000,
    ...over,
  })

  it('runs on a changed drawing', () => {
    expect(decideAutoRun(base())).toEqual({ action: 'run' })
  })

  it('skips when off, not editable, not started, not ready or in flight', () => {
    expect(decideAutoRun(base({ autoEnabled: false }))).toMatchObject({ reason: 'off' })
    expect(decideAutoRun(base({ editable: false }))).toMatchObject({ reason: 'notEditable' })
    expect(decideAutoRun(base({ hasLinkedRows: false }))).toMatchObject({ reason: 'notStarted' })
    expect(decideAutoRun(base({ ready: false }))).toMatchObject({ reason: 'notReady' })
    expect(decideAutoRun(base({ inFlight: true }))).toMatchObject({ reason: 'inFlight' })
    expect(decideAutoRun(base({ currentHash: null }))).toMatchObject({ reason: 'unknown' })
  })

  it('never loops on its own save: the post-balloon hash is in sync', () => {
    expect(decideAutoRun(base({ currentHash: 'h2' }))).toMatchObject({ reason: 'inSync' })
  })

  it('adopts a late second write right after its own save instead of running again', () => {
    expect(decideAutoRun(base({ settleUntil: 100_001 }))).toEqual({ action: 'adopt' })
    expect(decideAutoRun(base({ settleUntil: 100_000 }))).toEqual({ action: 'run' })
  })

  it('stops after a failure until the content changes', () => {
    expect(decideAutoRun(base({ failedHash: 'h3' }))).toMatchObject({ reason: 'failed' })
    expect(decideAutoRun(base({ failedHash: 'h3', currentHash: 'h4' }))).toEqual({
      action: 'run',
    })
  })

  it('runs for a drawing extracted but never ballooned', () => {
    const stamp = recordExtract({}, 'f', 'h3', V, 1).f
    expect(decideAutoRun(base({ stamp, settleUntil: 999_999 }))).toEqual({ action: 'run' })
  })
})

describe('autoBarState', () => {
  const base = {
    autoEnabled: true,
    hasLinkedRows: true,
    busy: false,
    ready: true,
    paused: false,
    balloon: 'inSync' as const,
  }

  it('leaves the manual buttons when Auto is off', () => {
    expect(autoBarState({ ...base, autoEnabled: false })).toEqual({ mode: 'manual' })
    expect(autoBarState({ ...base, autoEnabled: false, hasLinkedRows: false })).toEqual({
      mode: 'manual',
    })
  })

  it('offers one start action before anything was read from the drawing', () => {
    expect(autoBarState({ ...base, hasLinkedRows: false, balloon: 'never' })).toEqual({
      mode: 'start',
    })
    expect(autoBarState({ ...base, hasLinkedRows: false, busy: true })).toEqual({ mode: 'start' })
  })

  it('offers nothing to press when the drawing is in sync', () => {
    expect(autoBarState(base)).toEqual({ mode: 'auto', status: 'inSync' })
    // In sync stays in sync while SOLIDWORKS is not running.
    expect(autoBarState({ ...base, ready: false })).toEqual({ mode: 'auto', status: 'inSync' })
  })

  it('says what Auto is doing when the drawing is not in sync', () => {
    expect(autoBarState({ ...base, busy: true })).toEqual({ mode: 'auto', status: 'syncing' })
    for (const balloon of ['changed', 'never', 'service'] as const) {
      expect(autoBarState({ ...base, balloon })).toEqual({ mode: 'auto', status: 'syncing' })
    }
    expect(autoBarState({ ...base, balloon: 'unknown' })).toEqual({
      mode: 'auto',
      status: 'checking',
    })
    expect(autoBarState({ ...base, balloon: 'changed', ready: false })).toEqual({
      mode: 'auto',
      status: 'waiting',
    })
  })

  it('shows a paused Auto, which is the only state with something to press', () => {
    expect(autoBarState({ ...base, balloon: 'changed', paused: true })).toEqual({
      mode: 'auto',
      status: 'paused',
    })
    // A run in progress wins over an old pause.
    expect(autoBarState({ ...base, paused: true, busy: true })).toEqual({
      mode: 'auto',
      status: 'syncing',
    })
  })
})
