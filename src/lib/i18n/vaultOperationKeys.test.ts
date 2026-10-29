import { describe, expect, it } from 'vitest'
import { en, de, es, fr, pt, zhCN, zhTW } from './locales'
import { getTranslation } from './index'
import type { Language } from './types'
import { flattenTranslations } from './utils'

const locales = { en, de, es, fr, pt, zhCN, zhTW }
const placeholders = (text: string) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort()

describe('vault operation messages', () => {
  it.each(Object.entries(locales))(
    'provides the same keys and parameters in %s',
    (_name, locale) => {
      const reference = flattenTranslations(en)
      const actual = flattenTranslations(locale)
      const keys = Object.keys(reference)
        .filter((key) => key.startsWith('vaultOperations.'))
        .sort()
      expect(
        Object.keys(actual)
          .filter((key) => key.startsWith('vaultOperations.'))
          .sort(),
      ).toEqual(keys)
      for (const key of keys) {
        expect(placeholders(actual[key])).toEqual(placeholders(reference[key]))
      }
    },
  )

  it('retains dynamic values in English messages', () => {
    expect(getTranslation('en', 'vaultOperations.localDeleted', { count: 2, total: 5 })).toBe(
      'Deleted 2 of 5 local items',
    )
    expect(getTranslation('en', 'vaultOperations.renameErrorDetails', { error: 'example' })).toBe(
      'Failed to rename vault: example',
    )
  })

  it.each<Language>(['en', 'de', 'es', 'fr', 'pt', 'zh-CN', 'zh-TW'])(
    'interpolates counts and errors for %s',
    (language) => {
      expect(
        getTranslation(language, 'vaultOperations.localDeleted', { count: 2, total: 5 }),
      ).toContain('2')
      expect(
        getTranslation(language, 'vaultOperations.localDeleted', { count: 2, total: 5 }),
      ).toContain('5')
      expect(
        getTranslation(language, 'vaultOperations.renameErrorDetails', { error: 'example' }),
      ).toContain('example')
    },
  )
})
