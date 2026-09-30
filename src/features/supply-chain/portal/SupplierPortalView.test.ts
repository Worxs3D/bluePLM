import { describe, expect, it } from 'vitest'
import { de, en, es, fr, pt, zhCN, zhTW } from '@/lib/i18n/locales'
import { flattenTranslations } from '@/lib/i18n/utils'
import { SUPPLIER_PORTAL_STATUS_KEYS } from './SupplierPortalView'

describe('supplier portal status localization', () => {
  it('keeps exact status keys and locale parity', () => {
    expect(SUPPLIER_PORTAL_STATUS_KEYS.sent).toBe('supplierStatus.sent')
    expect(SUPPLIER_PORTAL_STATUS_KEYS.ready).toBe('supplierStatus.ready')
    expect(SUPPLIER_PORTAL_STATUS_KEYS.awarded).toBe('supplierStatus.awarded')
    expect(SUPPLIER_PORTAL_STATUS_KEYS.completed).toBe('supplierStatus.completed')

    const dictionaries = [en, de, fr, es, pt, zhCN, zhTW].map((locale) => flattenTranslations(locale))
    const expectedKeys = Object.keys(dictionaries[0]).filter((key) => key.startsWith('supplierStatus.'))
    for (const dictionary of dictionaries) {
      expect(Object.keys(dictionary).filter((key) => key.startsWith('supplierStatus.'))).toEqual(expectedKeys)
      for (const key of expectedKeys) expect(dictionary[key]).not.toBe(key)
    }
  })
})
