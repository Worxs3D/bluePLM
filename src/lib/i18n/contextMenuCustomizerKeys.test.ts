/**
 * Every right-click menu customizer key (`contextMenuCustomizer.*`) exists in all 7 locales with
 * English's placeholders, and every entry and built-in group of the menu registry has its name
 * (and every entry its hint), so neither the menu nor the settings page ever shows a dotted key.
 */

import { describe, expect, it } from 'vitest'

import { CONTEXT_MENU_ENTRIES, CONTEXT_MENU_GROUPS, GROUP_ICONS } from '@/lib/contextMenu/entries'

import { PREVIEW_KINDS, PREVIEW_STATES } from '@/features/settings/account/contextMenu/previewAvailability'

import { contextMenuCustomizerStrings } from './locales/contextMenuCustomizer'
import { getTranslation } from './index'
import type { Language } from './types'
import { flattenTranslations } from './utils'

const LOCALES: Array<[Language, keyof typeof contextMenuCustomizerStrings]> = [
  ['en', 'en'],
  ['de', 'de'],
  ['es', 'es'],
  ['fr', 'fr'],
  ['pt', 'pt'],
  ['zh-CN', 'zhCN'],
  ['zh-TW', 'zhTW'],
]

const english = flattenTranslations(contextMenuCustomizerStrings.en)
const englishKeys = Object.keys(english).sort()

function placeholders(text: string): string[] {
  return (text.match(/\{\{\w+\}\}/g) ?? []).sort()
}

/** Keys the code builds from registry ids and values. */
const DYNAMIC = [
  ...CONTEXT_MENU_ENTRIES.flatMap(({ id }) => [
    `contextMenuCustomizer.entry.${id}`,
    `contextMenuCustomizer.hint.${id}`,
  ]),
  ...Object.keys(CONTEXT_MENU_GROUPS).map((id) => `contextMenuCustomizer.group.${id}`),
  ...Object.keys(GROUP_ICONS).map((name) => `contextMenuCustomizer.groupIcon.${name}`),
  'contextMenuCustomizer.menu.moreActions',
  'contextMenuCustomizer.menu.lessActions',
  'contextMenuCustomizer.menu.customize',
  ...['submenu', 'inline', 'collapsed', 'auto'].flatMap((d) => [
    `contextMenuCustomizer.display.${d}`,
    `contextMenuCustomizer.displayHint.${d}`,
  ]),
  ...PREVIEW_KINDS.map((k) => `contextMenuCustomizer.previewKind.${k}`),
  ...PREVIEW_STATES.map((k) => `contextMenuCustomizer.previewState.${k}`),
]

describe('right-click menu customizer keys exist in every locale', () => {
  it('English has every key the code builds from the registry', () => {
    for (const key of DYNAMIC) expect(english[key], key).toBeTruthy()
  })

  it('More actions carries its count', () => {
    expect(placeholders(english['contextMenuCustomizer.menu.moreActions'])).toEqual(['{{count}}'])
  })

  it('English has no key for an id the registry no longer has', () => {
    const ids = new Set<string>(CONTEXT_MENU_ENTRIES.map(({ id }) => id))
    for (const key of englishKeys) {
      const match = /^contextMenuCustomizer\.(entry|hint)\.(.+)$/.exec(key)
      if (match) expect(ids.has(match[2]), key).toBe(true)
    }
  })

  it.each(LOCALES)('%s has exactly English’s keys, with the same placeholders', (_language, key) => {
    const flat = flattenTranslations(contextMenuCustomizerStrings[key])
    expect(Object.keys(flat).sort()).toEqual(englishKeys)
    for (const k of englishKeys) {
      expect(flat[k].trim().length, `${key}: ${k}`).toBeGreaterThan(0)
      expect(placeholders(flat[k]), `${key}: ${k}`).toEqual(placeholders(english[k]))
    }
  })

  it.each(LOCALES)('%s resolves the keys through getTranslation', (language) => {
    for (const k of DYNAMIC) {
      expect(getTranslation(language, k, { count: 3 }), `${language}: ${k}`).not.toBe(k)
    }
  })
})
