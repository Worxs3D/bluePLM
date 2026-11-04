import { t } from '@/lib/i18n'
import { getOfficialExtension, type OfficialExtensionId } from '@/lib/officialExtensions'

/** An `officialExtensions.*` key. */
export const k = (key: string): string => `officialExtensions.${key}`

export function extensionName(id: OfficialExtensionId): string {
  return t(k(getOfficialExtension(id).nameKey))
}

/** Names joined with the locale's list separator. */
export function joinNames(names: readonly string[]): string {
  return names.join(t(k('listSeparator')))
}
