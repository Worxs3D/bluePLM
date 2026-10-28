/**
 * Workspace registration and sidebar placement for native extensions.
 *
 * Pure functions; the store slice and the activity bar call them.
 */

import type { ComponentType } from 'react'
import { MODULES, MODULE_GROUPS, type ModuleGroupId } from '@/types/modules'
import type { ExtensionWorkspace, WorkspaceRegistration } from '@/types/nativeExtensions'

/** Workspace ids: lowercase, short, never a custom-group id. */
export const WORKSPACE_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/

/** Every id a core view uses. An extension workspace may not take one. */
export const CORE_VIEW_IDS: ReadonlySet<string> = new Set<string>([
  ...MODULES.map((m) => m.id),
  'settings',
])

const GROUP_IDS: ReadonlySet<string> = new Set(MODULE_GROUPS.map((g) => g.id))

export class WorkspaceRegistrationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkspaceRegistrationError'
  }
}

function isComponent(value: unknown): value is ComponentType {
  // Function and class components are functions; memo/forwardRef are objects with $$typeof.
  return (
    typeof value === 'function' ||
    (typeof value === 'object' && value !== null && '$$typeof' in value)
  )
}

/**
 * Validate a registration against core views and the workspaces already
 * registered. Throws WorkspaceRegistrationError with a message for the
 * extension's error line.
 */
export function validateWorkspaceRegistration(
  extensionId: string,
  registration: WorkspaceRegistration,
  existing: readonly ExtensionWorkspace[],
  coreViewIds: ReadonlySet<string> = CORE_VIEW_IDS,
): ExtensionWorkspace {
  if (!registration || typeof registration !== 'object') {
    throw new WorkspaceRegistrationError('registerWorkspace needs a registration object')
  }
  const { id, title, icon, group, permission, Navigator, Workspace, RightPanel } = registration
  if (typeof id !== 'string' || !WORKSPACE_ID_PATTERN.test(id) || id.startsWith('group-')) {
    throw new WorkspaceRegistrationError(
      `Workspace id ${JSON.stringify(id)} must be lowercase letters, digits and hyphens`,
    )
  }
  if (coreViewIds.has(id)) {
    throw new WorkspaceRegistrationError(`Workspace id "${id}" is already a core module`)
  }
  const clash = existing.find((w) => w.id === id)
  if (clash) {
    throw new WorkspaceRegistrationError(
      clash.extensionId === extensionId
        ? `Workspace "${id}" is already registered by this extension`
        : `Workspace id "${id}" is already registered by ${clash.extensionId}`,
    )
  }
  if (typeof title !== 'string' || title.trim().length === 0) {
    throw new WorkspaceRegistrationError(`Workspace "${id}" needs a title`)
  }
  if (!isComponent(Workspace)) {
    throw new WorkspaceRegistrationError(`Workspace "${id}" needs a Workspace component`)
  }
  if (Navigator !== undefined && !isComponent(Navigator)) {
    throw new WorkspaceRegistrationError(`Workspace "${id}": Navigator is not a component`)
  }
  if (RightPanel !== undefined && !isComponent(RightPanel)) {
    throw new WorkspaceRegistrationError(`Workspace "${id}": RightPanel is not a component`)
  }
  if (permission !== undefined && (typeof permission !== 'string' || permission.length === 0)) {
    throw new WorkspaceRegistrationError(`Workspace "${id}": permission must be a resource name`)
  }

  return {
    extensionId,
    id,
    title: title.trim(),
    icon: typeof icon === 'string' && icon.length > 0 ? icon : 'Package',
    group: typeof group === 'string' && GROUP_IDS.has(group) ? (group as ModuleGroupId) : null,
    permission: permission ?? null,
    Navigator: Navigator ?? null,
    Workspace,
    RightPanel: RightPanel ?? null,
  }
}

/** A sidebar entry as placement sees it. */
export interface PlacementItem {
  id: string
  group: ModuleGroupId | null
}

const PARENT_GROUP: ReadonlyMap<string, string> = new Map(
  MODULE_GROUPS.filter((g) => g.parentGroup).map((g) => [g.id, g.parentGroup as string]),
)

function inGroup(itemGroup: ModuleGroupId | null, group: ModuleGroupId): boolean {
  if (!itemGroup) return false
  return itemGroup === group || PARENT_GROUP.get(itemGroup) === group
}

/**
 * Merge extension workspaces into the visible core sidebar order. Returns the
 * combined ids in display order.
 *
 * 1. An id the user's saved module order already holds (for example a module
 *    that used to be core) goes right after the nearest earlier saved entry that
 *    is on screen, so it keeps its place.
 * 2. Otherwise it goes after the last entry of its group.
 * 3. Otherwise (no group, or nothing of it on screen) it goes before the first
 *    System module, or at the end.
 */
export function placeExtensionModules(
  coreItems: readonly PlacementItem[],
  extensions: readonly PlacementItem[],
  savedOrder: readonly string[] = [],
): string[] {
  const result: PlacementItem[] = [...coreItems]
  for (const ext of extensions) {
    let insertAt = -1
    const savedIndex = savedOrder.indexOf(ext.id)
    if (savedIndex >= 0) {
      for (let i = savedIndex - 1; i >= 0 && insertAt < 0; i--) {
        const idx = result.findIndex((r) => r.id === savedOrder[i])
        if (idx >= 0) insertAt = idx + 1
      }
      if (insertAt < 0) insertAt = 0
    }
    if (insertAt < 0 && ext.group) {
      for (let i = result.length - 1; i >= 0; i--) {
        if (inGroup(result[i].group, ext.group)) {
          insertAt = i + 1
          break
        }
      }
    }
    if (insertAt < 0) {
      const system = result.findIndex((r) => r.group === 'system')
      insertAt = system >= 0 ? system : result.length
    }
    result.splice(insertAt, 0, ext)
  }
  return result.map((r) => r.id)
}

/**
 * Whether an extension workspace shows in the sidebar for this user.
 * `denied` is the module_access allowlist result (it holds plain module ids).
 */
export function isExtensionWorkspaceVisible(
  workspace: Pick<ExtensionWorkspace, 'id' | 'permission'>,
  denied: ReadonlySet<string>,
  enabledModules: Readonly<Record<string, boolean | undefined>>,
  hasPermission: (resource: string, action: string) => boolean,
): boolean {
  if (denied.has(workspace.id)) return false
  if (enabledModules[workspace.id] === false) return false
  if (workspace.permission && !hasPermission(workspace.permission, 'view')) return false
  return true
}
