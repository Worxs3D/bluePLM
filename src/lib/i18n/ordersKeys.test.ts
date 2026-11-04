/**
 * Every `orders.*` key (the Orders module, 5.11.0) resolves in all 7 locales, and each
 * translation takes the same `{{placeholders}}` as the English one. Same pattern as
 * `resolveMovesKeys.test.ts`: a missing key renders as the dotted key on screen. Also the
 * keys the UI builds at run time (statuses, kinds, error codes, skip reasons) exist.
 */
import { describe, expect, it } from 'vitest'

import {
  ORDER_ERROR_CODES,
  ORDER_OUTPUT_KINDS,
  ORDER_STATUSES,
  type OrderExportErrorCode,
} from '@/types/orders'

import { getTranslation } from './index'
import { ordersStrings } from './locales/orders'
import type { Language } from './types'

const LOCALES: Language[] = ['en', 'de', 'es', 'fr', 'pt', 'zh-CN', 'zh-TW']

const KEYS = Object.keys(ordersStrings.en).map((key) => `orders.${key}`)

const placeholders = (text: string) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort()

const EXPORT_ERROR_CODES: OrderExportErrorCode[] = [
  'NOTHING_TO_EXPORT',
  'DESKTOP_ONLY',
  'BLOCKED_CONTENT',
  'TOO_MANY_FILES',
  'TOO_LARGE',
  'NO_URL',
  'HASH_MISMATCH',
  'DOWNLOAD_FAILED',
  'WRITE_FAILED',
  'INVALID_REQUEST',
  'UNKNOWN',
]

const SKIP_REASONS = [
  'NotCheckedIn',
  'Folder',
  'Unsupported',
  'NotFound',
  'NoVaultAccess',
  'NotADrawing',
  'WrongOrg',
]

describe('orders.* keys exist in every locale', () => {
  it('has keys to check', () => {
    expect(KEYS).toContain('orders.newOrder')
    expect(KEYS).toContain('orders.sendAnyway')
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
    for (const [locale, dict] of Object.entries(ordersStrings)) {
      for (const key of Object.keys(ordersStrings.en)) {
        expect(dict[key as keyof typeof dict], `${locale}: ${key}`).toBeTruthy()
      }
    }
  })

  it('has the keys the UI builds at run time', () => {
    const keys = new Set(Object.keys(ordersStrings.en))
    const built = [
      ...ORDER_STATUSES.flatMap((s) => [`status_${s}`, `statusAt_${s}`, `toastStatus_${s}`]),
      ...ORDER_OUTPUT_KINDS.map((k) => `kind_${k}`),
      ...['ready', 'missing', 'unsupported', 'checking', 'excluded'].map((s) => `chip_${s}`),
      ...['send', 'receive', 'close', 'reopen', 'restore', 'cancel'].map((a) => `action_${a}`),
      ...[...ORDER_ERROR_CODES, 'UNKNOWN'].map((c) => `error${c}`),
      ...EXPORT_ERROR_CODES.map((c) => `exportError${c}`),
      ...SKIP_REASONS.flatMap((r) => [`skippedOne${r}`, `skippedMany${r}`]),
      'purpose_quote',
      'purpose_purchase',
    ]
    for (const key of built) expect(keys.has(key), key).toBe(true)
  })

  it('labels the module in the sidebar', () => {
    expect(getTranslation('en', 'sidebar.orders')).toBe('Orders')
  })
})
