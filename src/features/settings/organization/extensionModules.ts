/**
 * Visibility and placement of native extension workspaces in a module config.
 *
 * Extension workspaces use their id verbatim as a module id (for example
 * 'customers' for the Customers extension), and the sidebar hides one only when
 * `enabledModules[id] === false` (see isExtensionWorkspaceVisible). These two
 * helpers are what the module settings toggle reads and writes, so a saved
 * `customers: false` - Customers was hidden by default while it was a core
 * module - can be turned back on.
 */

import {
  buildCombinedOrderList,
  extractFromCombinedList,
  type ModuleConfig,
  type ModuleId,
} from '@/types/modules'

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

/**
 * Where a workspace sits in the saved sidebar order: `'default'` when the order
 * does not hold it (placed by its group), `'top'` when it is first, otherwise
 * the id of the entry right before it. placeExtensionModules puts a saved
 * workspace after the nearest earlier saved entry that is on screen.
 */
export type ExtensionModulePlacement = 'default' | 'top' | { after: string }

export function getExtensionModulePlacement(
  config: ModuleConfig,
  workspaceId: string,
): ExtensionModulePlacement {
  const order = config.moduleOrder as readonly string[]
  const index = order.indexOf(workspaceId)
  if (index < 0) return 'default'
  if (index === 0) return 'top'
  return { after: order[index - 1] }
}

/**
 * Move a workspace in the saved order. Goes through the combined order list so
 * divider and custom-group positions (indexes into moduleOrder) stay with the
 * modules they belong to. An `after` id that is not in the order puts the
 * workspace at the end.
 */
export function setExtensionModulePlacement(
  config: ModuleConfig,
  workspaceId: string,
  placement: ExtensionModulePlacement,
): ModuleConfig {
  const customGroups = config.customGroups || []
  const list = buildCombinedOrderList(config.moduleOrder, config.dividers, customGroups).filter(
    (item) => !(item.type === 'module' && item.id === workspaceId),
  )
  if (placement !== 'default') {
    // Extension ids are not core ModuleIds; every order consumer skips an id
    // with no core definition, and the sidebar places it from here.
    const entry = { type: 'module' as const, id: workspaceId as ModuleId }
    if (placement === 'top') {
      list.unshift(entry)
    } else {
      const anchor = list.findIndex((item) => item.type === 'module' && item.id === placement.after)
      list.splice(anchor < 0 ? list.length : anchor + 1, 0, entry)
    }
  }
  return { ...config, ...extractFromCombinedList(list, config.dividers, customGroups) }
}
