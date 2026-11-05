/**
 * Every `versionOpen.*` key (the assembly reference freeze, 5.13.0) resolves in all 7 locales,
 * each locale defines it itself, and each translation takes the same `{{placeholders}}` as the
 * English one. Also the keys the UI builds at run time exist.
 */
import { describe, expect, it } from 'vitest'

import { getTranslation } from './index'
import { versionOpenStrings } from './locales/versionOpen'
import type { Language } from './types'

const LOCALES: Language[] = ['en', 'de', 'es', 'fr', 'pt', 'zh-CN', 'zh-TW']

const KEYS = Object.keys(versionOpenStrings.en).map((key) => `versionOpen.${key}`)

const placeholders = (text: string) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort()

describe('versionOpen.* keys exist in every locale', () => {
  it('has keys to check', () => {
    expect(KEYS).toContain('versionOpen.openWithReferences')
    expect(KEYS).toContain('versionOpen.frozen')
    expect(KEYS).toContain('versionOpen.releaseConfirm')
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
    for (const [locale, dict] of Object.entries(versionOpenStrings)) {
      for (const key of Object.keys(versionOpenStrings.en)) {
        expect(dict[key as keyof typeof dict], `${locale}: ${key}`).toBeTruthy()
      }
    }
  })

  it('has the keys the UI builds at run time', () => {
    const keys = new Set(Object.keys(versionOpenStrings.en))
    const built = [
      ...['resolving', 'checking', 'downloading', 'retargeting', 'opening'].map(
        (p) => `progress${p[0].toUpperCase()}${p.slice(1)}`,
      ),
      ...['missing', 'conflicts', 'retargetFailed'].flatMap((k) => [`${k}One`, `${k}Many`]),
      ...['frozen', 'approximate', 'missing'].flatMap((s) => [s, `${s}Title`]),
      'needsServiceOffline',
      'needsServiceOutdated',
      'releaseBodyOne',
      'releaseBodyMany',
    ]
    for (const key of built) expect(keys.has(key), key).toBe(true)
  })
})
