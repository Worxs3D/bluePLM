/**
 * Whether an official extension is installed for the signed-in organization. One definition for
 * every surface that hides an extension's UI, matching the server's `is_org_extension_installed()`
 * (schema 515): only an explicit `installed: false` uninstalls, so an organization that never
 * touched the setting (every organization before 5.12, every new one) has all of them installed.
 */

import type { Organization } from '@/types/pdm'
import type { ModuleId } from '@/types/modules'
import type { SettingsTab } from '@/types/settings'
import type { CommandId } from '@/lib/commands/types'

import { OFFICIAL_EXTENSIONS, isOfficialExtensionId, type OfficialExtensionId } from './manifest'

/** One extension's entry in `organization.settings.extensions`. */
export interface OrgExtensionSetting {
  installed: boolean
  changed_at?: string
  changed_by?: string
}

export type OrgExtensionSettings = Partial<Record<string, OrgExtensionSetting>>

type OrgLike = Pick<Organization, 'settings'> | null | undefined

function settingsOf(organization: OrgLike): OrgExtensionSettings | undefined {
  const raw: unknown = organization?.settings?.extensions
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as OrgExtensionSettings) : undefined
}

export function officialExtensionInstalled(organization: OrgLike, id: OfficialExtensionId): boolean {
  const entry: unknown = settingsOf(organization)?.[id]
  if (!entry || typeof entry !== 'object') return true
  return (entry as { installed?: unknown }).installed !== false
}

const NONE: readonly OfficialExtensionId[] = Object.freeze([])

/** The official extensions this organization has uninstalled (one shared empty array when none). */
export function uninstalledOfficialExtensions(organization: OrgLike): readonly OfficialExtensionId[] {
  const out = OFFICIAL_EXTENSIONS.filter((m) => !officialExtensionInstalled(organization, m.id)).map((m) => m.id)
  return out.length === 0 ? NONE : out
}

/** The ids in a comma-joined key (what store selectors return, since a selector needs a stable value). */
export function parseExtensionIds(key: string): OfficialExtensionId[] {
  return key ? key.split(',').filter(isOfficialExtensionId) : []
}

/** The sidebar modules of uninstalled extensions: denied to everyone, admins included. */
export function modulesOfUninstalledExtensions(uninstalled: readonly OfficialExtensionId[]): ModuleId[] {
  return OFFICIAL_EXTENSIONS.filter((m) => uninstalled.includes(m.id)).flatMap((m) => [...m.contributes.modules])
}

/** The extension that adds a settings tab, if any. */
export function extensionOfSettingsTab(tab: SettingsTab): OfficialExtensionId | null {
  return OFFICIAL_EXTENSIONS.find((m) => m.contributes.settingsTabs.includes(tab))?.id ?? null
}

/** The extension that adds a command, if any. */
export function extensionOfCommand(command: CommandId): OfficialExtensionId | null {
  return OFFICIAL_EXTENSIONS.find((m) => m.contributes.commands.includes(command))?.id ?? null
}

/** The extension that adds a right-click menu entry, if any. */
export function extensionOfMenuEntry(entryId: string): OfficialExtensionId | null {
  return OFFICIAL_EXTENSIONS.find((m) => (m.contributes.contextMenuEntries as readonly string[]).includes(entryId))?.id ?? null
}

/** The extension that adds a keyboard shortcut category, if any. */
export function extensionOfShortcutCategory(category: string): OfficialExtensionId | null {
  return OFFICIAL_EXTENSIONS.find((m) => (m.contributes.shortcutCategories as readonly string[]).includes(category))?.id ?? null
}
