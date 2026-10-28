/**
 * Every key the extension settings page reads from `extensionRuntime.*`, asserted to
 * exist in all 7 locales. Same pattern as `resolveMovesKeys.test.ts`: a missing key
 * renders as the literal dotted key, not as English.
 */

import { describe, expect, it } from 'vitest'

import { getTranslation } from './index'
import type { Language } from './types'

const LOCALES: Language[] = ['en', 'de', 'es', 'fr', 'pt', 'zh-CN', 'zh-TW']

const KEYS = [
  'extensionRuntime.notice',
  'extensionRuntime.installedNotRunning',
  'extensionRuntime.adminOnly',
  'extensionRuntime.notAdminError',
] as const

describe('extensionRuntime.* keys exist in every locale', () => {
  it.each(LOCALES)('%s resolves every key to a sentence rather than the key', (locale) => {
    for (const key of KEYS) {
      const text = getTranslation(locale, key)
      expect(text, `${locale}: ${key}`).not.toBe(key)
      expect(text.length, `${locale}: ${key}`).toBeGreaterThan(0)
    }
  })
})
