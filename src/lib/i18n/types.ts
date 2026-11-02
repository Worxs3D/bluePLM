// Supported languages
export type Language =
  | 'en'
  | 'fr'
  | 'de'
  | 'es'
  | 'pt'
  | 'zh-CN'
  | 'zh-TW'
  | 'it'
  | 'nl'
  | 'sv'
  | 'pl'
  | 'ru'
  | 'ja'
  | 'ko'
  | 'sindarin'

// Translation values can be strings or recursively nested objects.
export type TranslationValue = string | { [key: string]: TranslationValue }

// Translation dictionary structure
export type TranslationDict = Record<string, TranslationValue>

// Flattened translations (dot notation keys)
export type FlatTranslations = Record<string, string>
