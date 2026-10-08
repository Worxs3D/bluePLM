import { describe, expect, it } from 'vitest'

import type { VerifiedAddress } from '@/lib/metadata/verifyWrite'

import {
  describeAddress,
  describeFirstShortfall,
  isComUnreachableReason,
  unsettledAddresses,
} from './syncMetadataFailures'

const PART_NUMBER: VerifiedAddress['address'] = { scope: 'file', field: 'part_number' }
const TAB_0375: VerifiedAddress['address'] = {
  scope: 'configuration',
  field: 'config_tab',
  configuration: '0375',
}

describe('describeAddress', () => {
  it('names a file-level field by its key', () => {
    expect(describeAddress(PART_NUMBER)).toBe('part_number')
  })

  it('names a configuration field with the configuration it sits in', () => {
    expect(describeAddress(TAB_0375)).toContain('config_tab')
    expect(describeAddress(TAB_0375)).toContain('0375')
  })
})

describe('unsettledAddresses', () => {
  it('keeps failed, unverified and unattempted, and drops verified and pending', () => {
    const states: VerifiedAddress['state'][] = [
      'verified',
      'pending',
      'failed',
      'unverified',
      'unattempted',
    ]
    const result = unsettledAddresses(states.map((state) => ({ address: PART_NUMBER, state })))
    expect(result.map((entry) => entry.state)).toEqual(['failed', 'unverified', 'unattempted'])
  })
})

describe('describeFirstShortfall', () => {
  it('is null when every address settled', () => {
    expect(
      describeFirstShortfall([
        { address: PART_NUMBER, state: 'verified' },
        { address: TAB_0375, state: 'pending' },
      ]),
    ).toBeNull()
  })

  it('names the field and the reason of the first failed address', () => {
    const message = describeFirstShortfall([
      { address: PART_NUMBER, state: 'verified' },
      { address: TAB_0375, state: 'failed', reason: 'the file is open in another process' },
    ])

    expect(message).toContain('config_tab')
    expect(message).toContain('0375')
    expect(message).toContain('the file is open in another process')
  })

  it('puts a failed write ahead of an unverified one that came first', () => {
    const message = describeFirstShortfall([
      { address: PART_NUMBER, state: 'unverified', reason: 'read-back failed' },
      { address: TAB_0375, state: 'failed', reason: 'refused' },
    ])

    expect(message).toContain('refused')
    expect(message).not.toContain('read-back failed')
  })

  it('names the field alone when the verdict carries no reason', () => {
    expect(describeFirstShortfall([{ address: PART_NUMBER, state: 'failed' }])).toContain(
      'part_number',
    )
  })

  it('says SolidWorks is unreachable, not the raw service text, when COM is down', () => {
    const message = describeFirstShortfall([
      { address: PART_NUMBER, state: 'failed', reason: 'MK_E_UNAVAILABLE (0x800401E3)' },
    ])

    expect(message).toContain('COM')
    expect(message).not.toContain('MK_E_UNAVAILABLE')
  })
})

describe('isComUnreachableReason', () => {
  it('recognises the service codes for an unreachable SolidWorks', () => {
    expect(isComUnreachableReason('Operation unavailable (MK_E_UNAVAILABLE)')).toBe(true)
    expect(isComUnreachableReason('SOLIDWORKS_COM_INACCESSIBLE')).toBe(true)
  })

  it('does not take an unrelated refusal for it', () => {
    expect(isComUnreachableReason('the file is read-only')).toBe(false)
    expect(isComUnreachableReason(undefined)).toBe(false)
  })
})
