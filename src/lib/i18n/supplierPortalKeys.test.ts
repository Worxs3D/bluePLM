/**
 * Every `supplierPortal.*` key (the Supplier Portal's quote orders, 5.13.0) resolves in all 7
 * locales, each locale defines it itself, and each translation takes the English placeholders.
 * Same pattern as `securityMonitoringKeys.test.ts`.
 */
import { describe, expect, it } from 'vitest'

import { getTranslation } from './index'
import { supplierPortalStrings } from './locales/supplierPortal'
import type { Language } from './types'

const LOCALES: Language[] = ['en', 'de', 'es', 'fr', 'pt', 'zh-CN', 'zh-TW']

const KEYS = Object.keys(supplierPortalStrings.en).map((key) => `supplierPortal.${key}`)

const placeholders = (text: string) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort()

describe('supplierPortal.* keys exist in every locale', () => {
  it('has keys to check', () => {
    expect(KEYS).toContain('supplierPortal.newQuote')
    expect(KEYS).toContain('supplierPortal.unavailableBody')
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
    for (const [locale, dict] of Object.entries(supplierPortalStrings)) {
      for (const key of Object.keys(supplierPortalStrings.en)) {
        expect(dict[key], `${locale}: ${key}`).toBeDefined()
      }
    }
  })

  it('the RFQ namespace is gone with the RFQ view (RFQs are quote orders)', () => {
    expect(getTranslation('en', 'rfq.newRfq')).toBe('rfq.newRfq')
  })
})
