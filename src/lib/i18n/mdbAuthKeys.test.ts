import { describe, expect, it } from 'vitest'

import { de } from './locales/de'
import { en } from './locales/en'
import { es } from './locales/es'
import { fr } from './locales/fr'
import { pt } from './locales/pt'
import { zhCN } from './locales/zhCN'
import { zhTW } from './locales/zhTW'

const locales = { en, de, es, fr, pt, zhCN, zhTW }
const englishKeys = Object.keys(en.mdbAuth).sort()

describe('mdbAuth translation keys', () => {
  it('defines the same keys in every locale', () => {
    expect(englishKeys.length).toBeGreaterThan(0)
    for (const [locale, translations] of Object.entries(locales)) {
      expect(Object.keys(translations.mdbAuth).sort(), locale).toEqual(englishKeys)
    }
  })
})
