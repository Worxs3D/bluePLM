import type {
  MdbAuthDialogStrings,
  MdbAuthLanguage,
} from '../../src/lib/backend/contracts/mdbAuthShared'
import localizedStrings from '../../src/lib/i18n/locales/mdbAuth.json'

const supportedLanguages: readonly MdbAuthLanguage[] = [
  'en',
  'fr',
  'de',
  'es',
  'pt',
  'zh-CN',
  'zh-TW',
  'it',
  'nl',
  'sv',
  'pl',
  'ru',
  'ja',
  'ko',
  'sindarin',
]

export function isMdbAuthLanguage(value: unknown): value is MdbAuthLanguage {
  return typeof value === 'string' && supportedLanguages.includes(value as MdbAuthLanguage)
}

export function mdbAuthDialogStrings(language: MdbAuthLanguage): MdbAuthDialogStrings {
  const locale = Object.hasOwn(localizedStrings, language) ? language : 'en'
  return localizedStrings[locale as keyof typeof localizedStrings]
}
