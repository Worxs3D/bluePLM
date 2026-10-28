import { describe, expect, it } from 'vitest'

import { mapDecisionKey, nextOwedItem, stepItem, type DecisionKeyEvent } from './decisionKeys'

function key(k: string, extra: Partial<DecisionKeyEvent> = {}): DecisionKeyEvent {
  return { key: k, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, inEditable: false, ...extra }
}

describe('mapDecisionKey', () => {
  it('maps A, Shift+A, C and R to decisions', () => {
    expect(mapDecisionKey(key('a'))).toEqual({ kind: 'decide', decision: 'approved' })
    expect(mapDecisionKey(key('A', { shiftKey: true }))).toEqual({
      kind: 'decide',
      decision: 'approved_with_comments',
    })
    expect(mapDecisionKey(key('c'))).toEqual({ kind: 'decide', decision: 'changes_requested' })
    expect(mapDecisionKey(key('r'))).toEqual({ kind: 'decide', decision: 'rejected' })
  })

  it('maps J and K to next and previous', () => {
    expect(mapDecisionKey(key('j'))).toEqual({ kind: 'next' })
    expect(mapDecisionKey(key('K'))).toEqual({ kind: 'previous' })
  })

  it('ignores typing in fields and keys with Ctrl, Cmd or Alt', () => {
    expect(mapDecisionKey(key('a', { inEditable: true }))).toBeNull()
    expect(mapDecisionKey(key('a', { ctrlKey: true }))).toBeNull()
    expect(mapDecisionKey(key('r', { metaKey: true }))).toBeNull()
    expect(mapDecisionKey(key('j', { altKey: true }))).toBeNull()
  })

  it('never decides on a held-down key, but still moves between items', () => {
    expect(mapDecisionKey(key('a', { repeat: true }))).toBeNull()
    expect(mapDecisionKey(key('A', { shiftKey: true, repeat: true }))).toBeNull()
    expect(mapDecisionKey(key('c', { repeat: true }))).toBeNull()
    expect(mapDecisionKey(key('r', { repeat: true }))).toBeNull()
    expect(mapDecisionKey(key('j', { repeat: true }))).toEqual({ kind: 'next' })
  })

  it('ignores other keys and shifted C, R, J, K', () => {
    expect(mapDecisionKey(key('x'))).toBeNull()
    expect(mapDecisionKey(key('Enter'))).toBeNull()
    expect(mapDecisionKey(key('C', { shiftKey: true }))).toBeNull()
    expect(mapDecisionKey(key('J', { shiftKey: true }))).toBeNull()
  })
})

describe('stepItem', () => {
  const ids = ['a', 'b', 'c']
  it('moves and wraps', () => {
    expect(stepItem(ids, 'a', 1)).toBe('b')
    expect(stepItem(ids, 'c', 1)).toBe('a')
    expect(stepItem(ids, 'a', -1)).toBe('c')
  })
  it('starts at the first item when none or an unknown one is current', () => {
    expect(stepItem(ids, null, 1)).toBe('a')
    expect(stepItem(ids, 'zzz', -1)).toBe('a')
    expect(stepItem([], null, 1)).toBeNull()
  })
})

describe('nextOwedItem', () => {
  const ids = ['a', 'b', 'c', 'd']
  it('goes to the next owed item after the decided one, wrapping', () => {
    expect(nextOwedItem(ids, ['a', 'c', 'd'], 'a')).toBe('c')
    expect(nextOwedItem(ids, ['a', 'b', 'd'], 'd')).toBe('a')
  })
  it('skips items already decided', () => {
    expect(nextOwedItem(ids, ['b', 'd'], 'b')).toBe('d')
  })
  it('returns null when the decided item was the last owed', () => {
    expect(nextOwedItem(ids, ['c'], 'c')).toBeNull()
    expect(nextOwedItem(ids, [], 'c')).toBeNull()
  })
})
