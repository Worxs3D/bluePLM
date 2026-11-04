/**
 * `officialExtensions.*` (schema 515): the Settings > Extensions catalog of the built-in
 * extensions (Reviews, Inspection, Orders), its install and uninstall dialogs, and the message a
 * command of an uninstalled extension shows. One flat namespace, one file per locale, spread into
 * each locale as `officialExtensions`; `officialExtensionsKeys.test.ts` checks every key in every
 * locale.
 */

import { de } from './de'
import { en } from './en'
import { es } from './es'
import { fr } from './fr'
import { pt } from './pt'
import { zhCN } from './zhCN'
import { zhTW } from './zhTW'

export type OfficialExtensionsKey = keyof typeof en
export type OfficialExtensionsDict = Record<OfficialExtensionsKey, string>

export const officialExtensionsStrings: Record<
  'en' | 'de' | 'es' | 'fr' | 'pt' | 'zhCN' | 'zhTW',
  OfficialExtensionsDict
> = {
  en,
  de,
  es,
  fr,
  pt,
  zhCN,
  zhTW,
}
