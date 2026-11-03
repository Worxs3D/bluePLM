import { describe, expect, it } from 'vitest'

import { getTranslation } from '@/lib/i18n'

import { settingsSections } from './settingsCatalog'

describe('settings catalog English labels', () => {
  it('keeps every translated navigation label equal to its catalog label in English', () => {
    const catalog = settingsSections()
    const translated = settingsSections((key) => getTranslation('en', key))
    const mismatches: string[] = []

    for (const [sectionIndex, section] of catalog.entries()) {
      const translatedSection = translated[sectionIndex]
      if (translatedSection?.category !== section.category) {
        mismatches.push(`category: ${section.category} -> ${translatedSection?.category}`)
      }
      for (const [itemIndex, item] of section.items.entries()) {
        const translatedLabel = translatedSection?.items[itemIndex]?.label
        if (translatedLabel !== item.label) mismatches.push(`${item.label} -> ${translatedLabel}`)
      }
    }

    expect(mismatches).toEqual([])
    expect(getTranslation('en', 'settings.catalogLabels.signedInDevices')).toBe('Signed-in devices')
  })

  it.each(['en', 'de', 'fr', 'es', 'pt', 'zh-CN', 'zh-TW'] as const)(
    'defines every catalog label for %s',
    (locale) => {
      const labels = settingsSections((key) => getTranslation(locale, key)).flatMap((section) => [
        section.category,
        ...section.items.map((item) => item.label),
      ])

      expect(labels.every((label) => label.trim().length > 0)).toBe(true)
      expect(labels.filter((label) => label.startsWith('settings.catalogLabels.'))).toEqual([])
      expect(getTranslation(locale, 'settings.catalogLabels.signedInDevices')).not.toBe(
        'settings.catalogLabels.signedInDevices',
      )
    },
  )
})
