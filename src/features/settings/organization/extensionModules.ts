/**
 * Visibility of native extension workspaces in a module config.
 *
 * Extension workspaces use their id verbatim as a module id (for example
 * 'customers' for the Customers extension), and the sidebar hides one only when
 * `enabledModules[id] === false` (see isExtensionWorkspaceVisible). These two
 * helpers are what the module settings toggle reads and writes, so a saved
 * `customers: false` - Customers was hidden by default while it was a core
 * module - can be turned back on.
 */

import type { ModuleConfig, ModuleId } from '@/types/modules'

export function isExtensionModuleEnabled(config: ModuleConfig, workspaceId: string): boolean {
  return (config.enabledModules as Readonly<Record<string, boolean | undefined>>)[workspaceId] !== false
}

export function setExtensionModuleEnabled(
  config: ModuleConfig,
  workspaceId: string,
  enabled: boolean,
): ModuleConfig {
  return {
    ...config,
    // Extension ids are not core ModuleIds; enabledModules is stored as JSON and
    // read back by id, so the key is written as-is.
    enabledModules: { ...config.enabledModules, [workspaceId as ModuleId]: enabled },
  }
}
