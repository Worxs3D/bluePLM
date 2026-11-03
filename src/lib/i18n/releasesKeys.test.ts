/**
 * Every `releases.*` key (released versions in the workflow UI, 5.9.0) resolves in all 7 locales,
 * and each translation takes the same `{{placeholders}}` as the English one. Same pattern as
 * `resolveMovesKeys.test.ts`: a missing key renders as the dotted key on screen.
 */
import { describe, expect, it } from 'vitest'

import { getTranslation } from './index'
import { releasesStrings } from './locales/releases'
import type { Language } from './types'

const LOCALES: Language[] = ['en', 'de', 'es', 'fr', 'pt', 'zh-CN', 'zh-TW']

const KEYS = Object.keys(releasesStrings.en).map((key) => `releases.${key}`)

const placeholders = (text: string) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort()

describe('releases.* keys exist in every locale', () => {
  it('has keys to check', () => {
    expect(KEYS).toContain('releases.forceConfirm')
    expect(KEYS).toContain('releases.stateReleasesToggle')
  })

  it.each(LOCALES)('%s resolves every key with the English placeholders', (locale) => {
    for (const key of KEYS) {
      const english = getTranslation('en', key)
      const text = getTranslation(locale, key)
      expect(text, `${locale}: ${key}`).not.toBe(key)
      expect(text.length, `${locale}: ${key}`).toBeGreaterThan(0)
      expect(placeholders(text), `${locale}: ${key}`).toEqual(placeholders(english))
    }
  })

  it('every locale defines every key itself rather than falling back to English', () => {
    for (const [locale, dict] of Object.entries(releasesStrings)) {
      for (const key of Object.keys(releasesStrings.en)) {
        expect(dict[key], `${locale}: ${key}`).toBeTruthy()
      }
    }
  })
})
