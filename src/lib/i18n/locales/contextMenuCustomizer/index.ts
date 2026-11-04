import type { TranslationDict } from '../../types'

/**
 * The right-click menu customizer (`contextMenuCustomizer.*`): entry and group names and hints for
 * every id in `src/lib/contextMenu/entries.ts`, the menu's own rows (More actions, Customize this
 * menu), Settings > Right-click menu and Settings > Menu templates. One file per locale, spread into
 * each locale, so the locale files only gain one line each. `contextMenuCustomizerKeys.test.ts`
 * checks every key in every locale and every registry id.
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

export const contextMenuCustomizerStrings: Record<
  'en' | 'de' | 'es' | 'fr' | 'pt' | 'zhCN' | 'zhTW',
  TranslationDict
> = {
  en,
  de,
  es,
  fr,
  pt,
  zhCN,
  zhTW,
}
