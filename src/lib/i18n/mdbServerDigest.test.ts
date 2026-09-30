import { describe, expect, it } from 'vitest'

import { getTranslation } from '.'

const locales = ['en', 'de', 'es', 'fr', 'pt', 'zh-CN', 'zh-TW'] as const

describe('MDB server digest translations', () => {
  it.each(locales)('interpolates the packaged and deployed digest preview in %s', (locale) => {
    const digest = 'fixture-digest'
    expect(getTranslation(locale, 'settingsPages.mdbServer.digestPreview', { value: digest })).toContain(digest)
    expect(getTranslation(locale, 'settingsPages.mdbServer.digestPreview', { value: digest })).not.toContain('{value}')
  })

  it.each(locales)('provides a localized update-required state in %s', (locale) => {
    const key = 'settingsPages.mdbServer.backupUpdateRequired'
    expect(getTranslation(locale, key)).not.toBe(key)
  })
})
