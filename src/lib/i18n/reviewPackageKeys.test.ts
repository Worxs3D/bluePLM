/**
 * Every `reviewPackage.*` key, asserted to exist in all 7 locales and to keep its placeholders.
 * Follows `resolveMovesKeys.test.ts`: a missing key renders as the dotted key itself, because
 * the callers pass params, not a fallback string.
 */

import { describe, expect, it } from 'vitest'

import { getTranslation } from './index'
import { reviewPackageStrings } from './locales/reviewPackage'
import type { Language } from './types'

const LOCALES: Language[] = ['en', 'de', 'es', 'fr', 'pt', 'zh-CN', 'zh-TW']

/** Every key with the placeholders it must keep in every language. */
const KEYS: Record<string, string[]> = {
  selectFolderTitle: [],
  validationOffline: [],
  validationNotSignedIn: [],
  validationDesktopOnly: [],
  validationNoReview: [],
  validationNoDestination: [],
  validationNoVersions: [],
  progressDownload: ['title'],
  progressResolving: [],
  progressRetargeting: [],
  progressFinishing: [],
  noItems: [],
  downloadDone: ['folder', 'count'],
  downloadPartial: ['folder', 'failed', 'count'],
  missingReferences: ['count'],
  versionConflicts: ['count'],
  approximate: [],
  retargetNotRun: ['version'],
  retargetFailed: ['count'],
  openFresh: [],
  manifestFailed: ['error'],
  cancelled: [],
  failed: ['error'],
  progressPdf: [],
  pdfDone: ['generated', 'cached'],
  pdfNeedsSolidworks: ['reason'],
  pdfFailed: ['count', 'details'],
  pdfNotDrawing: ['count'],
  pdfSameNameOpen: ['files'],
  pdfPending: [],
  pdfPendingHint: [],
  previewUnsupported: [],
  'reason.service_offline': [],
  'reason.service_outdated': ['version'],
  'reason.solidworks_not_installed': [],
}

describe('reviewPackage.* keys exist in every locale', () => {
  it.each(LOCALES)('%s has every key with its placeholders', (locale) => {
    for (const [name, params] of Object.entries(KEYS)) {
      const fullKey = `reviewPackage.${name}`
      const raw = getTranslation(locale, fullKey, '__missing__')
      expect(raw, `${locale} ${fullKey}`).not.toBe('__missing__')
      for (const param of params) {
        expect(raw, `${locale} ${fullKey} keeps {{${param}}}`).toContain(`{{${param}}}`)
      }
    }
  })

  it('no locale defines a key English does not have', () => {
    const flat = (dict: object, prefix = ''): string[] =>
      Object.entries(dict).flatMap(([k, v]) =>
        typeof v === 'string' ? [`${prefix}${k}`] : flat(v as object, `${prefix}${k}.`),
      )
    const english = flat(reviewPackageStrings.en).sort()
    expect(english).toEqual(Object.keys(KEYS).sort())
    for (const [lang, dict] of Object.entries(reviewPackageStrings)) {
      expect(flat(dict).sort(), lang).toEqual(english)
    }
  })

  it('interpolates', () => {
    expect(getTranslation('en', 'reviewPackage.downloadDone', { folder: 'C:\\R', count: 3 })).toBe(
      'Review package saved to C:\\R. Files: 3.',
    )
  })
})
