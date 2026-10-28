/**
 * Every key the top-bar SOLIDWORKS license panel reads, asserted to exist in all 7 locales.
 * Same reasoning as `resolveMovesKeys.test.ts`: a missing key renders as the dotted key.
 */

import { describe, expect, it } from 'vitest'

import { getTranslation } from './index'
import type { Language } from './types'

const LOCALES: Language[] = ['en', 'de', 'es', 'fr', 'pt', 'zh-CN', 'zh-TW']

const KEYS = [
  'solidworksLicense.title',
  'solidworksLicense.noneAssigned',
  'solidworksLicense.checking',
  'solidworksLicense.match',
  'solidworksLicense.mismatch',
  'solidworksLicense.unassigned',
  'solidworksLicense.unknown',
  'solidworksLicense.askAdmin',
  'solidworksLicense.warningBadge',
] as const

describe('solidworksLicense.* keys exist in every locale', () => {
  it.each(LOCALES)('%s resolves every key to a sentence rather than the key', (locale) => {
    for (const key of KEYS) {
      const text = getTranslation(locale, key)
      expect(text, `${locale}: ${key}`).not.toBe(key)
      expect(text.length, `${locale}: ${key}`).toBeGreaterThan(0)
    }
  })
})
