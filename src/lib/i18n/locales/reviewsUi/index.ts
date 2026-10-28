import type { TranslationDict } from '../../types'

/**
 * The drawing review UI (schema 107): the package builder pane (`reviewBuilder`), the review queue
 * (`reviewQueue`), the open review (`reviewDetail`) and PDF markups (`markups`). Kept in this folder,
 * one file per locale, and spread into each locale, so the locale files only gain one line each.
 * `reviewsUiKeys.test.ts` checks every key in every locale.
 *
 * `t()` has no plural rules, so counts are phrased to read correctly for any number.
 */

import { de } from './de'
import { en } from './en'
import { es } from './es'
import { fr } from './fr'
import { pt } from './pt'
import { zhCN } from './zhCN'
import { zhTW } from './zhTW'

export const reviewsUiStrings: Record<'en' | 'de' | 'es' | 'fr' | 'pt' | 'zhCN' | 'zhTW', TranslationDict> = {
  en,
  de,
  es,
  fr,
  pt,
  zhCN,
  zhTW,
}
