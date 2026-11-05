import { useMemo } from 'react'
import { usePDMStore } from '@/stores/pdmStore'
import { hasDesktop } from '@/lib/platform'
import { useTranslation } from '@/lib/i18n'
import { parseExtensionIds, uninstalledOfficialExtensions } from '@/lib/officialExtensions'
import { isSettingsTabAvailable, settingsCatalogFor, settingsSections } from './settingsCatalog'
import {
  buildSettingsSearchIndex,
  flattenSettingsSearch,
  searchSettings,
  type SettingsSearchGroup,
  type SettingsSearchHit,
} from './settingsSearch'

interface SettingsSearchState {
  query: string
  groups: SettingsSearchGroup[]
  hits: SettingsSearchHit[]
}

// The sidebar and the results view both read the same search on every keystroke; one cached
// result keeps that to a single pass.
let cache: { key: string; value: SettingsSearchState } | null = null

function runSearch(
  query: string,
  isAdmin: boolean,
  desktop: boolean,
  language: string,
  t: (key: string) => string,
  uninstalledKey: string,
): SettingsSearchState {
  const key = `${language}\u0000${isAdmin ? 1 : 0}${desktop ? 1 : 0}${uninstalledKey}\u0000${query}`
  if (cache?.key === key) return cache.value
  const uninstalled = parseExtensionIds(uninstalledKey)
  const sections = settingsSections(t).map((section) => ({
    ...section,
    items: section.items.filter((item) => isSettingsTabAvailable(item, isAdmin, desktop, uninstalled)),
  }))
  const groups = query.trim()
    ? searchSettings(buildSettingsSearchIndex(sections, settingsCatalogFor(desktop)), query)
    : []
  const value = { query: query.trim(), groups, hits: flattenSettingsSearch(groups) }
  cache = { key, value }
  return value
}

/** The live settings search: the trimmed query, hits grouped by tab, and the flat hit list. */
export function useSettingsSearch(): SettingsSearchState {
  const query = usePDMStore((s) => s.settingsSearchQuery)
  const isAdmin = usePDMStore((s) => s.getEffectiveRole() === 'admin')
  const desktop = hasDesktop()
  const { t, language } = useTranslation()
  // A comma-joined key: a store selector must return a stable value.
  const uninstalledKey = usePDMStore((s) => uninstalledOfficialExtensions(s.organization).join(','))
  return useMemo(
    () => runSearch(query, isAdmin, desktop, language, t, uninstalledKey),
    [query, isAdmin, desktop, language, t, uninstalledKey],
  )
}
