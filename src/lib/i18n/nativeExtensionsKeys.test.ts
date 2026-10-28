/**
 * Every `nativeExtensions.*` key the native extension UI reads, asserted to exist
 * in all 7 locales and to substitute its placeholders. Same pattern as
 * `resolveMovesKeys.test.ts`.
 */

import { describe, expect, it } from 'vitest'

import { getTranslation } from './index'
import type { Language } from './types'

const LOCALES: Language[] = ['en', 'de', 'es', 'fr', 'pt', 'zh-CN', 'zh-TW']

const PLAIN = [
  'crashedTitle',
  'retry',
  'notLoaded',
  'permissionsGroup',
  'modulesTitle',
  'modulesDescription',
  'moduleRestricted',
  'sectionTitle',
  'sectionDescription',
  'installButton',
  'reload',
  'confirmInstallBody',
  'confirm',
  'cancel',
  'sqlTitle',
  'sqlBody',
  'copy',
  'copied',
  'enable',
  'disable',
  'uninstall',
  'statusActive',
  'statusLoading',
  'statusError',
  'statusDisabled',
  'statusNotLoaded',
  'none',
].map((k) => `nativeExtensions.${k}`)

const WITH_PARAMS: Array<[string, Record<string, string>]> = [
  ['nativeExtensions.crashedBody', { id: 'acme.tool' }],
  ['nativeExtensions.installed', { name: 'Tool', version: '1.2.3' }],
  ['nativeExtensions.confirmInstallTitle', { name: 'Tool', version: '1.2.3' }],
  ['nativeExtensions.confirmUninstall', { name: 'Tool' }],
  ['nativeExtensions.error', { message: 'boom' }],
  ['nativeExtensions.moduleFrom', { extension: 'blueplm.customers' }],
]

describe('nativeExtensions.* keys exist in every locale', () => {
  it.each(LOCALES)('%s resolves every plain key', (locale) => {
    for (const key of PLAIN) {
      const text = getTranslation(locale, key)
      expect(text, `${locale}: ${key}`).not.toBe(key)
      expect(text.length, `${locale}: ${key}`).toBeGreaterThan(0)
    }
  })

  it.each(LOCALES)('%s substitutes every placeholder', (locale) => {
    for (const [key, params] of WITH_PARAMS) {
      const text = getTranslation(locale, key, params)
      expect(text, `${locale}: ${key}`).not.toBe(key)
      for (const value of Object.values(params)) {
        expect(text, `${locale}: ${key}`).toContain(value)
      }
      expect(text, `${locale}: ${key}`).not.toMatch(/\{\{\w+\}\}/)
    }
  })
})
