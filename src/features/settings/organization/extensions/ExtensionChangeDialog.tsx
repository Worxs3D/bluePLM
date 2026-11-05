/**
 * The confirmation before an official extension is installed or uninstalled for the organization.
 * It names what appears or disappears for everyone, the extension's own effects (Reviews: drawings
 * release without a review), that nothing is deleted, and the integrations that go dark or light up.
 * An uninstall that an installed extension blocks names it and cannot be confirmed.
 */
import { ConfirmDialog } from '@/components/core/Dialog'
import { t } from '@/lib/i18n'
import {
  getOfficialExtension,
  planInstall,
  planUninstall,
  type InstallPlan,
  type InstalledCheck,
  type OfficialExtensionId,
  type UninstallPlan,
} from '@/lib/officialExtensions'

import { extensionName, joinNames, k } from './names'

export type PendingChange =
  | { id: OfficialExtensionId; install: true; plan: InstallPlan }
  | { id: OfficialExtensionId; install: false; plan: UninstallPlan }

export function planChange(id: OfficialExtensionId, install: boolean, installed: InstalledCheck): PendingChange {
  return install ? { id, install: true, plan: planInstall(id, installed) } : { id, install: false, plan: planUninstall(id, installed) }
}

export function ExtensionChangeDialog({
  change,
  orgName,
  onClose,
  onConfirm,
}: {
  change: PendingChange | null
  orgName: string | null
  onClose: () => void
  onConfirm: (change: PendingChange) => void
}) {
  if (!change) return null
  const manifest = getOfficialExtension(change.id)
  const name = extensionName(change.id)
  const org = orgName || t(k('yourOrganization'))
  const surfaces = joinNames(manifest.contributes.surfaceKeys.map((key) => t(k(key))))
  const integrationNames = joinNames(change.plan.integrations.map(extensionName))
  const blocked = !change.install && change.plan.blockedBy.length > 0
  const alsoInstalls = change.install ? change.plan.install.filter((id) => id !== change.id) : []

  return (
    <ConfirmDialog
      open
      onClose={onClose}
      title={t(k(change.install ? 'installTitle' : 'uninstallTitle'), { name })}
      message={t(k(change.install ? 'installBody' : 'uninstallBody'), { name, org, surfaces })}
      confirmText={t(k(change.install ? 'install' : 'uninstall'))}
      variant={change.install ? 'info' : 'danger'}
      confirmDisabled={blocked}
      onConfirm={() => onConfirm(change)}
    >
      <div className="space-y-2 text-[14px] leading-[1.4] text-ui-fg-secondary">
        {blocked && (
          <p className="text-ui-danger">
            {t(k('uninstallBlocked'), { names: joinNames(change.plan.blockedBy.map(extensionName)), name })}
          </p>
        )}
        {!change.install && manifest.uninstallEffectKeys.length > 0 && (
          <ul className="list-disc space-y-1 pl-5">
            {manifest.uninstallEffectKeys.map((key) => (
              <li key={key}>{t(k(key))}</li>
            ))}
          </ul>
        )}
        {alsoInstalls.length > 0 && (
          <p>{t(k('installAlso'), { names: joinNames(alsoInstalls.map(extensionName)), name })}</p>
        )}
        {change.plan.integrations.length > 0 && (
          <p>{t(k(change.install ? 'integrationsLight' : 'integrationsDark'), { names: integrationNames })}</p>
        )}
        {!change.install && <p>{t(k('uninstallKeeps'))}</p>}
      </div>
    </ConfirmDialog>
  )
}
