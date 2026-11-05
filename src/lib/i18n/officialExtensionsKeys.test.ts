/**
 * Every `officialExtensions.*` key resolves in all 7 locales with the English placeholders, and every
 * key a manifest names (names, descriptions, surfaces, effects, core features) exists.
 */
import { describe, expect, it } from 'vitest'

import { OFFICIAL_EXTENSIONS } from '@/lib/officialExtensions'

import { getTranslation } from './index'
import { officialExtensionsStrings } from './locales/officialExtensions'
import type { Language } from './types'

const LOCALES: Language[] = ['en', 'de', 'es', 'fr', 'pt', 'zh-CN', 'zh-TW']
const KEYS = Object.keys(officialExtensionsStrings.en)
const placeholders = (text: string) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort()

describe('officialExtensions.* keys', () => {
  it.each(LOCALES)('%s resolves every key with the English placeholders', (locale) => {
    for (const key of KEYS) {
      const text = getTranslation(locale, `officialExtensions.${key}`)
      const english = getTranslation('en', `officialExtensions.${key}`)
      expect(text, `${locale}: ${key}`).not.toBe(`officialExtensions.${key}`)
      expect(placeholders(text), `${locale}: ${key}`).toEqual(placeholders(english))
    }
  })

  it('has every key a manifest names', () => {
    const keys = new Set(KEYS)
    for (const m of OFFICIAL_EXTENSIONS) {
      const named = [
        m.nameKey,
        m.descriptionKey,
        ...m.contributes.surfaceKeys,
        ...m.uninstallEffectKeys,
        ...m.integrations.map((i) => i.what),
        ...m.dependencies.core.map((c) => `core_${c}`),
      ]
      for (const key of named) expect(keys.has(key), `${m.id}: ${key}`).toBe(true)
    }
  })

  it('has a message for every error code the setter returns', () => {
    for (const code of ['NOT_ADMIN', 'UNKNOWN_EXTENSION', 'DEPENDENCY_INSTALLED', 'DEPENDENCY_MISSING', 'NEEDS_UPGRADE']) {
      expect(KEYS).toContain(`error_${code}`)
    }
  })
})
