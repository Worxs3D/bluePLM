import { describe, expect, it } from 'vitest'

import { describeError, isIndexedDbCorruptionError } from './errorDetails'

describe('describeError', () => {
  it('copies the fields of a PostgREST error object instead of "[object Object]"', () => {
    const details = describeError({
      message: 'canceling statement due to statement timeout',
      code: '57014',
      details: 'query ran too long',
      hint: 'add an index',
      status: 500,
    })

    expect(details).toEqual({
      message: 'canceling statement due to statement timeout',
      code: '57014',
      details: 'query ran too long',
      hint: 'add an index',
      status: 500,
    })
  })

  it('reads name, message and code off a DOMException-like error whose fields are getters', () => {
    class FakeDomException {
      get name() {
        return 'UnknownError'
      }
      get message() {
        return 'Internal error opening backing store for indexedDB.open.'
      }
      get code() {
        return 0
      }
    }

    const details = describeError(new FakeDomException())

    expect(details).toEqual({
      name: 'UnknownError',
      message: 'Internal error opening backing store for indexedDB.open.',
      code: 0,
    })
    // The plain logger would have serialized the original as {}.
    expect(JSON.stringify(new FakeDomException())).toBe('{}')
  })

  it('handles Error, strings, null and objects with no known fields', () => {
    expect(describeError(new TypeError('bad'))).toEqual({ name: 'TypeError', message: 'bad' })
    expect(describeError('plain')).toEqual({ message: 'plain' })
    expect(describeError(null)).toEqual({ message: 'null' })
    expect(describeError({ weird: 1 })).toEqual({ message: '{"weird":1}' })
  })

  it('clips very long messages', () => {
    const details = describeError({ message: 'x'.repeat(5000) })

    expect(details.message?.length).toBeLessThan(600)
  })
})

describe('isIndexedDbCorruptionError', () => {
  it('matches the backing store failure and the DOMException names that accompany it', () => {
    expect(
      isIndexedDbCorruptionError({
        name: 'UnknownError',
        message: 'Internal error opening backing store for indexedDB.open.',
      }),
    ).toBe(true)
    expect(isIndexedDbCorruptionError({ name: 'InvalidStateError', message: 'closing' })).toBe(true)
    expect(isIndexedDbCorruptionError(new Error('Failed: backing store broke'))).toBe(true)
  })

  it('does not match unrelated errors', () => {
    expect(isIndexedDbCorruptionError(new Error('network down'))).toBe(false)
    expect(isIndexedDbCorruptionError({ name: 'QuotaExceededError', message: 'full' })).toBe(false)
    expect(isIndexedDbCorruptionError(null)).toBe(false)
  })
})
