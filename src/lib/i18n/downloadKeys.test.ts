/**
 * Every locale key the download skip-hash toast reads, asserted in all seven locales.
 * A missing key is the dotted path on screen, since `t()` is called with a params
 * object and never a fallback string.
 */

import { describe, expect, it } from 'vitest'

import { getTranslation } from './index'
import type { Language } from './types'

const LOCALES: Language[] = ['en', 'de', 'es', 'fr', 'pt', 'zh-CN', 'zh-TW']

const COUNTED = [
  'fileOps.downloadSkippedNoHash_one',
  'fileOps.downloadSkippedNoHash_other',
] as const

describe('download skip-hash toast keys across all seven locales', () => {
  it.each(LOCALES)('%s resolves both plural forms and interpolates the count', (locale) => {
    for (const key of COUNTED) {
      const text = getTranslation(locale, key, { count: 34 })
      expect(text).not.toBe(key)
      expect(text.length).toBeGreaterThan(0)
      expect(text).not.toContain('{{count}}')
    }
    expect(getTranslation(locale, 'fileOps.downloadSkippedNoHash_other', { count: 34 })).toContain(
      '34',
    )
  })
})
