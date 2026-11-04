/**
 * Settings > Extensions, first section: the official BluePLM extensions (Reviews, Inspection,
 * Orders). Each row says whether it is installed, what it adds, what it needs and what it works
 * with; an admin installs or uninstalls it for the whole organization after a confirmation that
 * names the impact. The rules live in `src/lib/officialExtensions/`; the server applies them again
 * in `org_extension_set_installed()` (schema 515). Works on the web build as well.
 */
import { useState } from 'react'
import { ClipboardCheck, Ruler, ShoppingCart, type LucideIcon } from 'lucide-react'

import { usePDMStore } from '@/stores/pdmStore'
import { t } from '@/lib/i18n'
import { log } from '@/lib/logger'
import {
  OFFICIAL_EXTENSIONS,
  dependentsOf,
  integrationsOf,
  officialExtensionInstalled,
  type OfficialExtensionId,
  type OfficialExtensionManifest,
} from '@/lib/officialExtensions'
import { setOfficialExtensionInstalled } from '@/lib/supabase/officialExtensions'
import { Button, Row, RowGroup, Section, StatusText } from '@/components/core/ui'

import { ExtensionChangeDialog, planChange, type PendingChange } from './ExtensionChangeDialog'
import { extensionName, joinNames, k } from './names'

const ICONS: Record<OfficialExtensionId, LucideIcon> = {
  'blueplm.reviews': ClipboardCheck,
  'blueplm.inspection': Ruler,
  'blueplm.orders': ShoppingCart,
}

/** The version every official extension carries: the app's own, since it ships with it. */
const APP_VERSION: string = import.meta.env.PACKAGE_VERSION || '0.0.0'


function Meta({ label, children }: { label: string; children: string }) {
  return (
    <div className="flex gap-2 text-[13px] leading-5">
      <span className="w-24 flex-shrink-0 text-ui-fg-tertiary">{label}</span>
      <span className="min-w-0 text-ui-fg-secondary">{children}</span>
    </div>
  )
}

function ExtensionRow({
  manifest,
  installed,
  isAdmin,
  busy,
  onChange,
}: {
  manifest: OfficialExtensionManifest
  installed: boolean
  isAdmin: boolean
  busy: boolean
  onChange: () => void
}) {
  const Icon = ICONS[manifest.id]
  const needs = [
    ...manifest.dependencies.core.map((c) => t(k(`core_${c}`))),
    ...manifest.dependencies.extensions.map(extensionName),
  ]
  const neededBy = dependentsOf(manifest.id).map(extensionName)
  const worksWith = integrationsOf(manifest.id).map(extensionName)
  const adds = manifest.contributes.surfaceKeys.map((key) => t(k(key)))

  return (
    <Row
      data-extension-id={manifest.id}
      label={
        <span className="flex items-center gap-2">
          <Icon size={16} className="text-ui-fg-secondary" aria-hidden />
          <span className="font-medium">{t(k(manifest.nameKey))}</span>
        </span>
      }
      badge={
        <span className="flex items-center gap-3">
          <StatusText tone={installed ? 'success' : 'neutral'}>
            {installed ? t(k('statusInstalled')) : t(k('statusNotInstalled'))}
          </StatusText>
          <span className="text-[12px] tabular-nums text-ui-fg-tertiary">
            {t(k('version'), { version: APP_VERSION })}
          </span>
        </span>
      }
      description={
        <div className="space-y-2">
          <p>{t(k(manifest.descriptionKey))}</p>
          <div className="space-y-0.5">
            <Meta label={t(k('adds'))}>{joinNames(adds)}</Meta>
            <Meta label={t(k('needs'))}>{needs.length ? joinNames(needs) : t(k('none'))}</Meta>
            {neededBy.length > 0 && <Meta label={t(k('neededBy'))}>{joinNames(neededBy)}</Meta>}
            {worksWith.length > 0 && <Meta label={t(k('worksWith'))}>{joinNames(worksWith)}</Meta>}
          </div>
        </div>
      }
    >
      {isAdmin && (
        <Button
          variant="secondary"
          size="sm"
          loading={busy}
          disabled={busy}
          onClick={onChange}
        >
          {installed ? t(k('uninstall')) : t(k('install'))}
        </Button>
      )}
    </Row>
  )
}

export function OfficialExtensionsSection() {
  const isAdmin = usePDMStore((s) => s.getEffectiveRole() === 'admin')
  const organization = usePDMStore((s) => s.organization)
  const setOrganization = usePDMStore((s) => s.setOrganization)
  const addToast = usePDMStore((s) => s.addToast)
  const [pending, setPending] = useState<PendingChange | null>(null)
  const [busy, setBusy] = useState<OfficialExtensionId | null>(null)

  const installed = (id: OfficialExtensionId) => officialExtensionInstalled(organization, id)

  const apply = async (change: PendingChange) => {
    const name = extensionName(change.id)
    setBusy(change.id)
    try {
      // Missing dependencies first, in order (none today: the three need only core).
      const steps = change.install ? change.plan.install : [change.id]
      let settings = organization?.settings
      for (const id of steps) {
        const result = await setOfficialExtensionInstalled(id, change.install)
        if (!result.ok) {
          const message = result.code ? t(k(`error_${result.code}`)) : result.message
          addToast('error', t(k('failed'), { name, message }))
          log.warn('[OfficialExtensions]', 'Install state change refused', { id, code: result.code, error: result.message })
          return
        }
        settings = result.settings
      }
      if (organization && settings) setOrganization({ ...organization, settings })
      addToast('success', t(k(change.install ? 'installed' : 'uninstalled'), { name }))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Section
      title={t(k('sectionTitle'))}
      description={isAdmin ? t(k('sectionIntro')) : `${t(k('sectionIntro'))} ${t(k('sectionIntroMember'))}`}
    >
      <RowGroup>
        {OFFICIAL_EXTENSIONS.map((manifest) => (
          <ExtensionRow
            key={manifest.id}
            manifest={manifest}
            installed={installed(manifest.id)}
            isAdmin={isAdmin}
            busy={busy === manifest.id}
            onChange={() => setPending(planChange(manifest.id, !installed(manifest.id), installed))}
          />
        ))}
      </RowGroup>
      <ExtensionChangeDialog
        change={pending}
        orgName={organization?.name ?? null}
        onClose={() => setPending(null)}
        onConfirm={(change) => void apply(change)}
      />
    </Section>
  )
}
