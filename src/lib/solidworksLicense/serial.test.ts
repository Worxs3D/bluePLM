import { describe, expect, it } from 'vitest'
import { evaluateLicenseMatch, isLicenseWarning, maskSerial, normalizeSerial } from './serial'

describe('normalizeSerial', () => {
  it('ignores spaces, dashes and case', () => {
    expect(normalizeSerial('9000 0000 0000 4821 qzxc 7tvb')).toBe('9000000000004821QZXC7TVB')
    expect(normalizeSerial('9000-0000-0000-4821-QZXC-7TVB')).toBe('9000000000004821QZXC7TVB')
    expect(normalizeSerial(' 9000000000004821QZXC7TVB ')).toBe('9000000000004821QZXC7TVB')
  })
})

describe('maskSerial', () => {
  it('keeps the last 8 characters and the grouping of a full serial', () => {
    expect(maskSerial('9000 0000 0000 4821 QZXC 7TVB')).toBe('•••• •••• •••• •••• QZXC 7TVB')
  })

  it('masks an ungrouped serial the same way', () => {
    expect(maskSerial('9000000000004821QZXC7TVB')).toBe('••••••••••••••••QZXC7TVB')
  })

  it('keeps only 4 characters of a short serial and none of a tiny one', () => {
    expect(maskSerial('ABCD EFGH IJ')).toBe('•••• ••GH IJ')
    expect(maskSerial('ABCD')).toBe('••••')
  })

  it('never reveals more than 8 characters', () => {
    const masked = maskSerial('9000 0000 0000 4821 QZXC 7TVB')
    expect(masked.replace(/[•\s]/g, '')).toHaveLength(8)
  })
})

describe('evaluateLicenseMatch', () => {
  const machine = [
    { product: 'SolidWorks', serial: '9000 0000 0000 4821 QZXC 7TVB' },
    { product: 'Inspection', serial: '9000 0000 0000 6603 KLMN 2PQR' },
  ]

  it('matches a stored serial with different spacing', () => {
    expect(evaluateLicenseMatch(['9000000000004821QZXC7TVB'], machine)).toBe('match')
  })

  it('is a mismatch when only an add-on serial is the user’s', () => {
    expect(evaluateLicenseMatch(['9000 0000 0000 6603 KLMN 2PQR'], machine)).toBe('mismatch')
  })

  it('is a mismatch when the user has another serial', () => {
    expect(evaluateLicenseMatch(['9000 0000 0000 1111 AAAA BBBB'], machine)).toBe('mismatch')
  })

  it('matches when any of several assigned serials is the core one', () => {
    expect(
      evaluateLicenseMatch(['9000 0000 0000 1111 AAAA BBBB', '9000 0000 0000 4821 QZXC 7TVB'], machine),
    ).toBe('match')
  })

  it('is unassigned when the user has none and SOLIDWORKS is licensed', () => {
    expect(evaluateLicenseMatch([], machine)).toBe('unassigned')
  })

  it('falls back to every machine serial when there is no core product value', () => {
    const only = [{ product: 'SOLIDWORKS Premium', serial: '9000 0000 0000 4821 QZXC 7TVB' }]
    expect(evaluateLicenseMatch(['9000000000004821QZXC7TVB'], only)).toBe('match')
  })

  it('is unknown when the machine could not be read or holds no serial', () => {
    expect(evaluateLicenseMatch(['9000000000004821QZXC7TVB'], null)).toBe('unknown')
    expect(evaluateLicenseMatch(['9000000000004821QZXC7TVB'], [])).toBe('unknown')
    expect(evaluateLicenseMatch([], [])).toBe('unknown')
  })

  it('warns only on mismatch and unassigned', () => {
    expect(isLicenseWarning('mismatch')).toBe(true)
    expect(isLicenseWarning('unassigned')).toBe(true)
    expect(isLicenseWarning('match')).toBe(false)
    expect(isLicenseWarning('unknown')).toBe(false)
  })
})
