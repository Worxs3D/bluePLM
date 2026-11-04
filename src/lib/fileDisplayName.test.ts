import { describe, expect, it } from 'vitest'

import { fileDisplayName } from './fileDisplayName'

describe('fileDisplayName', () => {
  it('lowercases only the extension when the preference is on (the default)', () => {
    expect(fileDisplayName('PMP-2000.SLDDRW', true)).toBe('PMP-2000.slddrw')
    expect(fileDisplayName('PMP-2000.SLDDRW', undefined)).toBe('PMP-2000.slddrw')
    expect(fileDisplayName('Housing.Rev-B.SLDPRT', true)).toBe('Housing.Rev-B.sldprt')
  })

  it('keeps the stored name when the preference is off', () => {
    expect(fileDisplayName('PMP-2000.SLDDRW', false)).toBe('PMP-2000.SLDDRW')
  })

  it('leaves names without a real extension alone', () => {
    expect(fileDisplayName('README', true)).toBe('README')
    expect(fileDisplayName('.Gitignore', true)).toBe('.Gitignore')
    expect(fileDisplayName('NOTES.', true)).toBe('NOTES.')
  })
})
