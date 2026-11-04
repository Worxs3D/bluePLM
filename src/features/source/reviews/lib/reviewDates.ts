/**
 * Dates on review surfaces, in the app's language: relative times ("2 hours ago") through
 * date-fns with the matching locale, and short calendar dates ("Nov 3"). Every review surface uses
 * these instead of calling `formatDistanceToNow` bare, which always speaks English (audit F27).
 */

import { formatDistanceToNow, type Locale } from 'date-fns'
import { de, enUS, es, fr, pt, zhCN, zhTW } from 'date-fns/locale'

import { usePDMStore } from '@/stores/pdmStore'

const LOCALES: Record<string, Locale> = { en: enUS, de, es, fr, pt, 'zh-CN': zhCN, 'zh-TW': zhTW }

function currentLanguage(): string {
  try {
    return usePDMStore.getState().language ?? 'en'
  } catch {
    return 'en'
  }
}

/** The date-fns locale for an app language; English for anything without one. */
export function dateFnsLocale(language: string = currentLanguage()): Locale {
  return LOCALES[language] ?? enUS
}

/** The BCP 47 tag `toLocaleDateString` takes for an app language. */
export function intlLocale(language: string = currentLanguage()): string {
  return language in LOCALES ? language : 'en'
}

/** "2 hours ago"; empty for a missing or unreadable timestamp. */
export function relativeTime(iso: string | null | undefined, language?: string): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return formatDistanceToNow(date, { addSuffix: true, locale: dateFnsLocale(language) })
}

/** "Nov 3" (this year) or "Nov 3, 2025"; empty for a missing or unreadable timestamp. */
export function shortDate(
  iso: string | null | undefined,
  language?: string,
  now: Date = new Date(),
): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const sameYear = date.getFullYear() === now.getFullYear()
  return date.toLocaleDateString(intlLocale(language), {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}
