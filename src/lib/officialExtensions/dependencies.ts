/**
 * Install and uninstall plans for official extensions. The rules, which the server applies again in
 * `org_extension_set_installed()` (schema 516):
 * - Install needs every hard dependency installed. The plan installs missing ones first, in order.
 * - Uninstall is refused while an installed extension needs it; the plan names them. Nothing is
 *   uninstalled along with it, because uninstalling hides a feature people use.
 * - Optional integrations never block either way; the plan names the ones that go dark or light up.
 */

import {
  OFFICIAL_EXTENSIONS,
  getOfficialExtension,
  type OfficialExtensionId,
} from './manifest'

export type InstalledCheck = (id: OfficialExtensionId) => boolean

/** Extensions that hard-depend on `id` (direct only). */
export function dependentsOf(id: OfficialExtensionId): OfficialExtensionId[] {
  return OFFICIAL_EXTENSIONS.filter((m) => m.dependencies.extensions.includes(id)).map((m) => m.id)
}

/** Extensions with an optional integration with `id`, either direction. */
export function integrationsOf(id: OfficialExtensionId): OfficialExtensionId[] {
  const own = getOfficialExtension(id).integrations.map((i) => i.extension)
  const theirs = OFFICIAL_EXTENSIONS.filter((m) => m.integrations.some((i) => i.extension === id)).map((m) => m.id)
  return [...new Set([...own, ...theirs])].filter((x) => x !== id)
}

export interface InstallPlan {
  /** In install order: missing dependencies first, `id` last. */
  install: OfficialExtensionId[]
  /** Integrations that light up because the other side is installed. */
  integrations: OfficialExtensionId[]
}

export function planInstall(id: OfficialExtensionId, installed: InstalledCheck): InstallPlan {
  const order: OfficialExtensionId[] = []
  const visiting = new Set<OfficialExtensionId>()
  const visit = (next: OfficialExtensionId) => {
    if (order.includes(next) || installed(next)) return
    if (visiting.has(next)) throw new Error(`Dependency cycle at ${next}`)
    visiting.add(next)
    for (const dep of getOfficialExtension(next).dependencies.extensions) visit(dep)
    visiting.delete(next)
    order.push(next)
  }
  visit(id)
  if (!order.includes(id)) order.push(id)
  return { install: order, integrations: integrationsOf(id).filter((x) => installed(x)) }
}

export interface UninstallPlan {
  /** Installed extensions that need `id`; uninstall is refused while any remain. */
  blockedBy: OfficialExtensionId[]
  /** Integrations that go dark because `id` leaves. */
  integrations: OfficialExtensionId[]
}

export function planUninstall(id: OfficialExtensionId, installed: InstalledCheck): UninstallPlan {
  return {
    blockedBy: dependentsOf(id).filter((x) => installed(x)),
    integrations: integrationsOf(id).filter((x) => installed(x)),
  }
}
