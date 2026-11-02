import { describe, expect, it } from 'vitest'

import { getTranslation } from './index'
import type { Language } from './types'

const LOCALES: Language[] = ['en', 'de', 'es', 'fr', 'pt', 'zh-CN', 'zh-TW']

describe('vault creation error translation', () => {
  it('preserves the existing English error message', () => {
    expect(
      getTranslation('en', 'vaultOperations.createFailed', { error: 'permission denied' }),
    ).toBe('Failed to create vault: permission denied')
  })

  it.each(LOCALES)('resolves and interpolates the error for %s', (locale) => {
    const text = getTranslation(locale, 'vaultOperations.createFailed', {
      error: 'permission denied',
    })

    expect(text).not.toBe('vaultOperations.createFailed')
    expect(text).toContain('permission denied')
    expect(text).not.toContain('{{error}}')
    if (locale !== 'en') {
      expect(text).not.toBe(
        getTranslation('en', 'vaultOperations.createFailed', { error: 'permission denied' }),
      )
    }
  })
})
