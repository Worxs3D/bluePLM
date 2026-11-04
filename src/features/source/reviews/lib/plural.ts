/**
 * `t()` has no plural rules. Strings whose count is often 1 have a `<key>One` sibling, and this
 * picks it for a count of 1 ("1 file" rather than "1 files").
 */

import { t, type TranslationParams } from '@/lib/i18n'

export function tCount(key: string, count: number, params: TranslationParams = {}): string {
  return count === 1 ? t(`${key}One`, params) : t(key, { ...params, count })
}
