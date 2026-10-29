/**
 * Team permission resources contributed by installed native extensions
 * (`contributes.permissions` in their manifests), for the permissions editor.
 *
 * Manifests were validated by the main process when the admin installed the
 * package (electron/handlers/extensions/validation.ts getContributedPermissions);
 * this reader only drops anything malformed rather than re-validating.
 */

import type { PermissionAction, ResourceDefinition } from '@/types/permissions'
import type { OrgNativeExtensionRow } from '@/types/nativeExtensions'

const ACTIONS: readonly PermissionAction[] = ['view', 'create', 'edit', 'delete', 'admin']

export interface ExtensionPermissionResource extends ResourceDefinition {
  extensionId: string
}

export function readContributedPermissions(
  extensionId: string,
  manifest: unknown,
): ExtensionPermissionResource[] {
  const contributes = (manifest as { contributes?: { permissions?: unknown } } | null)?.contributes
  const list = contributes?.permissions
  if (!Array.isArray(list)) return []
  const out: ExtensionPermissionResource[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const p = item as Record<string, unknown>
    if (typeof p.resource !== 'string' || !/^[a-z][a-z0-9-]*:[a-z0-9][a-z0-9-]*$/.test(p.resource)) {
      continue
    }
    const actions = Array.isArray(p.actions)
      ? ACTIONS.filter((a) => (p.actions as unknown[]).includes(a))
      : []
    if (actions.length === 0) continue
    out.push({
      extensionId,
      id: p.resource,
      name: typeof p.label === 'string' && p.label ? p.label : p.resource,
      description: typeof p.description === 'string' ? p.description : '',
      category: p.resource.startsWith('system:') ? 'system' : 'modules',
      icon: 'Puzzle',
      applicableActions: actions,
      defaultActions: [],
    })
  }
  return out
}

/**
 * Resources from every installed native extension that core does not already
 * define, first declaration wins.
 */
export function extensionPermissionResources(
  rows: readonly Pick<OrgNativeExtensionRow, 'extensionId' | 'manifest'>[],
  coreResourceIds: ReadonlySet<string>,
): ExtensionPermissionResource[] {
  const seen = new Set<string>(coreResourceIds)
  const out: ExtensionPermissionResource[] = []
  for (const row of rows) {
    for (const resource of readContributedPermissions(row.extensionId, row.manifest)) {
      if (seen.has(resource.id)) continue
      seen.add(resource.id)
      out.push(resource)
    }
  }
  return out
}

/** A titled group of resource ids, as the permission editor and net view list them. */
export interface PermissionResourceGroup {
  id: string
  name: string
  icon: string
  color: string
  resources: string[]
}

/**
 * Core's resources and groups plus the installed extensions' resources in one
 * extra group named `groupName`. Shared by the permissions editor and the
 * read-only net permissions view so the two always list the same resources.
 */
export function withExtensionPermissionResources(
  coreResources: readonly ResourceDefinition[],
  coreGroups: readonly PermissionResourceGroup[],
  rows: readonly Pick<OrgNativeExtensionRow, 'extensionId' | 'manifest'>[],
  groupName: string,
): { allResources: ResourceDefinition[]; resourceGroups: PermissionResourceGroup[] } {
  const extra = extensionPermissionResources(rows, new Set(coreResources.map((r) => r.id)))
  if (extra.length === 0) return { allResources: [...coreResources], resourceGroups: [...coreGroups] }
  return {
    allResources: [...coreResources, ...extra],
    resourceGroups: [
      ...coreGroups,
      {
        id: 'extensions',
        name: groupName,
        icon: 'Puzzle',
        color: '#a855f7',
        resources: extra.map((r) => r.id),
      },
    ],
  }
}
