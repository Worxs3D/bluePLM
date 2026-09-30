import { describe, expect, it } from 'vitest'

import { getTranslation, interpolate } from '.'

const locales = ['en', 'de', 'es', 'fr', 'pt', 'zh-CN', 'zh-TW'] as const

describe('MDB server digest translations', () => {
  it.each(locales)('interpolates the packaged and deployed digest preview in %s', (locale) => {
    const digest = 'fixture-digest'
    expect(getTranslation(locale, 'settingsPages.mdbServer.digestPreview', { value: digest })).toContain(digest)
    expect(getTranslation(locale, 'settingsPages.mdbServer.digestPreview', { value: digest })).not.toContain('{value}')
  })

  it.each(locales)('provides a localized update-required state in %s', (locale) => {
    for (const key of [
      'settingsPages.mdbServer.backupUpdateRequiredTitle',
      'settingsPages.mdbServer.backupUpdateRequired',
    ]) expect(getTranslation(locale, key)).not.toBe(key)
  })

  it('interpolates both placeholder forms in one non-recursive pass', () => {
    expect(interpolate('Digest {{value}} / {count}', { value: '{count}', count: 7 })).toBe('Digest {count} / 7')
    expect(interpolate('Missing {{missing}} / {alsoMissing}', { value: 'unused' })).toBe('Missing {{missing}} / {alsoMissing}')
  })
})
