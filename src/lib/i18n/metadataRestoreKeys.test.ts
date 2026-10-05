/**
 * Every locale key `restore-metadata-from-files` reads, asserted in all seven locales. The
 * command calls `t()` with params and no fallback, so a missing key prints its dotted path.
 */

import { describe, expect, it } from 'vitest'

import { getTranslation } from './index'
import type { Language } from './types'

const LOCALES: Language[] = ['en', 'de', 'es', 'fr', 'pt', 'zh-CN', 'zh-TW']

const KEYS = {
  'metadataRestore.noOrganization': {},
  'metadataRestore.noVault': {},
  'metadataRestore.adminOnly': {},
  'metadataRestore.alreadyRunning': {},
  'metadataRestore.scanning': {},
  'metadataRestore.cancelled': {},
  'metadataRestore.unread': { count: 7 },
  'metadataRestore.planLine': { path: 'ELEC/A.SLDPRT', values: 'x' },
  'metadataRestore.fieldValue': { field: 'f', value: 'v' },
  'metadataRestore.field.part_number': {},
  'metadataRestore.field.description': {},
  'metadataRestore.heldByOther': { path: 'ELEC/A.SLDPRT' },
  'metadataRestore.summary': { files: 1, values: 2, excluded: 3, held: 4, pending: 5 },
  'metadataRestore.dryRun': {},
  'metadataRestore.fileFailed': { path: 'ELEC/A.SLDPRT', reason: 'boom' },
  'metadataRestore.fileRefused': { path: 'ELEC/A.SLDPRT' },
  'metadataRestore.applied': { filled: 1, alreadySet: 2, refused: 3, failed: 4 },
  'metadataRestore.failed': { reason: 'boom' },
} as const

describe('restore-metadata-from-files keys across all seven locales', () => {
  it.each(LOCALES)('%s resolves every key and fills every placeholder', (locale) => {
    for (const [key, params] of Object.entries(KEYS)) {
      const text = getTranslation(locale, key, params)
      expect(text, key).not.toBe(key)
      expect(text.length, key).toBeGreaterThan(0)
      expect(text, key).not.toMatch(/\{\{\w+\}\}/)
      for (const value of Object.values(params)) expect(text, key).toContain(String(value))
    }
  })
})
