/**
 * Keys added in 4.4.5 for the Vault Audit "Fill empty from file" action, the divergence report's
 * empty-column section and the stranded-edit checkout warning.
 *
 * Each locale is checked against its own dictionary, not through `getTranslation`, because that
 * falls back to English and would pass a locale that never translated the key.
 */

import { describe, expect, it } from 'vitest'

import { de } from './locales/de'
import { en } from './locales/en'
import { es } from './locales/es'
import { fr } from './locales/fr'
import { pt } from './locales/pt'
import { zhCN } from './locales/zhCN'
import { zhTW } from './locales/zhTW'
import type { TranslationDict } from './types'

const LOCALES: Record<string, TranslationDict> = { en, de, es, fr, pt, zhCN, zhTW }

/** Each key with the placeholders its text must carry. */
const KEYS: Record<string, readonly string[]> = {
  'divergence.emptyColumnHeading': [],
  'divergence.emptyColumnNone': [],
  'divergence.emptyColumnSummary': ['count', 'files'],
  'divergence.emptyColumnLine': ['path', 'field', 'value'],
  'divergence.emptyColumnHow': [],
  'vaultAudit.category.emptyInDatabase': [],
  'vaultAudit.category.emptyInDatabaseDescription': [],
  'vaultAudit.resolution.fillEmptyFromFile': [],
  'vaultAudit.resolution.fillEmptyFromFileHint': [],
  'vaultAudit.blocked.unsavedLocalEdit': [],
  'vaultAudit.fill.guarantee': [],
  'vaultAudit.fill.adminOnly': [],
  'vaultAudit.fill.selectPrompt': [],
  'vaultAudit.fill.selectedSummary': ['values', 'files'],
  'vaultAudit.fill.review': ['count'],
  'vaultAudit.fill.previewHeading': ['values', 'files'],
  'vaultAudit.fill.previewLine': ['path', 'field', 'value'],
  'vaultAudit.fill.previewMore': ['count'],
  'vaultAudit.fill.cancel': [],
  'vaultAudit.fill.apply': ['count'],
  'vaultAudit.fill.applying': [],
  'vaultAudit.fill.receiptFilled': ['count'],
  'vaultAudit.fill.receiptAlreadySet': ['count'],
  'vaultAudit.fill.receiptHeld': ['count'],
  'vaultAudit.fill.receiptRefused': ['refused', 'failed'],
  'vaultAudit.fill.appliedToast': ['count'],
  'strandedEdits.checkoutLost': ['name'],
  'strandedEdits.confirmTitle': ['count'],
  'strandedEdits.confirmMessage': [],
  'strandedEdits.confirmContinue': [],
  'strandedEdits.cancelled': ['count'],
  'strandedEdits.item': ['path', 'edits'],
  'strandedEdits.valueEdit': ['field', 'value'],
  'strandedEdits.clearedEdit': ['field'],
  'strandedEdits.configurationEdit': ['field', 'count'],
  'strandedEdits.field.part_number': [],
  'strandedEdits.field.tab_number': [],
  'strandedEdits.field.description': [],
  'strandedEdits.field.revision': [],
  'strandedEdits.field.config_tabs': [],
  'strandedEdits.field.config_descriptions': [],
}

function lookup(dict: TranslationDict, key: string): unknown {
  let node: unknown = dict
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object') return undefined
    node = (node as Record<string, unknown>)[part]
  }
  return node
}

describe('4.4.5 fill-empty and stranded-edit keys', () => {
  it.each(Object.keys(LOCALES))('%s defines every key itself, with its placeholders', (name) => {
    const dict = LOCALES[name]
    for (const [key, placeholders] of Object.entries(KEYS)) {
      const text = lookup(dict, key)
      expect(typeof text, `${name}: ${key}`).toBe('string')
      expect((text as string).trim().length, `${name}: ${key}`).toBeGreaterThan(0)
      for (const placeholder of placeholders) {
        expect(text as string, `${name}: ${key}`).toContain(`{{${placeholder}}}`)
      }
    }
  })
})
