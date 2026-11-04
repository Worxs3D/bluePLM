/**
 * Settings > Inspection templates > Templates folder (schema 511): the vault folder whose
 * checked-in .xlsx files are the organization's templates
 * (`organization.settings.inspection_reports.templates_folder`). Administrators choose the vault and
 * the folder (typed, or browsed when the vault is connected on this computer); everyone sees it and
 * can sync. The library itself follows the folder through `inspection_template_sync_folder()`.
 */
import { useEffect, useMemo, useState } from 'react'
import { Check, FolderOpen, RefreshCw, X } from 'lucide-react'

import { Badge, Button, Callout, Select, TextInput } from '@/components/core/ui'
import { t } from '@/lib/i18n'
import { log } from '@/lib/logger'
import { hasDesktop } from '@/lib/platform'
import { getAccessibleVaults, supabase, type TemplateFolderSyncResult } from '@/lib/supabase'
import { usePDMStore } from '@/stores/pdmStore'
import type { InspectionTemplatesFolder, OrgSettings } from '@/types/pdm'

import { SettingRow, SettingsGroup, SettingsSection } from '../../components/ui'
import { folderRelativeToVault, normalizeFolderPath } from './templateModel'

interface VaultOption {
  id: string
  name: string
}

export interface TemplateFolderSettingsProps {
  /** The last sync's result, or null before one ran. */
  lastSync: TemplateFolderSyncResult | null
  syncing: boolean
  /** Sync the library with the folder and reload it. */
  onSync: (force?: boolean) => Promise<void>
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function TemplateFolderSettings({ lastSync, syncing, onSync }: TemplateFolderSettingsProps) {
  const organization = usePDMStore((s) => s.organization)
  const setOrganization = usePDMStore((s) => s.setOrganization)
  const user = usePDMStore((s) => s.user)
  const connectedVaults = usePDMStore((s) => s.connectedVaults)
  const addToast = usePDMStore((s) => s.addToast)
  const getEffectiveRole = usePDMStore((s) => s.getEffectiveRole)
  const isAdmin = getEffectiveRole() === 'admin'

  const saved = organization?.settings?.inspection_reports?.templates_folder ?? null
  const [vaults, setVaults] = useState<VaultOption[]>([])
  const [vaultDraft, setVaultDraft] = useState<string | null>(null)
  const [pathDraft, setPathDraft] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const vaultId = vaultDraft ?? saved?.vault_id ?? ''
  const pathText = pathDraft ?? saved?.path ?? ''
  const normalized = normalizeFolderPath(pathText)
  const dirty = (vaultDraft !== null && vaultDraft !== (saved?.vault_id ?? '')) || (pathDraft !== null && normalized !== (saved?.path ?? null))
  const pathInvalid = pathText.trim() !== '' && normalized === null

  const orgId = organization?.id
  const userId = user?.id
  useEffect(() => {
    if (!orgId || !userId) return
    let cancelled = false
    void getAccessibleVaults(userId, orgId, isAdmin ? 'admin' : 'engineer').then(({ vaults: list, error }) => {
      if (cancelled) return
      if (error) log.warn('[InspectionTemplates]', 'Vault list failed', { error })
      setVaults(list.map((v) => ({ id: v.id, name: v.name })))
    })
    return () => {
      cancelled = true
    }
  }, [orgId, userId, isAdmin])

  const vaultName = useMemo(() => {
    const id = saved?.vault_id
    if (!id) return null
    return vaults.find((v) => v.id === id)?.name ?? connectedVaults.find((v) => v.id === id)?.name ?? null
  }, [saved?.vault_id, vaults, connectedVaults])

  const localRoot = connectedVaults.find((v) => v.id === vaultId)?.localPath ?? null

  const browse = async () => {
    const vault = vaults.find((v) => v.id === vaultId)
    if (!localRoot) {
      addToast('info', t('source.inspection.tfBrowseNotConnected'))
      return
    }
    const result = await window.electronAPI?.selectFolder()
    if (!result?.success || !result.folderPath) return
    const relative = folderRelativeToVault(localRoot, result.folderPath)
    if (!relative) {
      addToast('warning', t('source.inspection.tfBrowseOutside', { vault: vault?.name ?? '' }))
      return
    }
    setPathDraft(relative)
  }

  const save = async (folder: InspectionTemplatesFolder | null) => {
    if (!organization) return
    setSaving(true)
    try {
      // Read the current settings first so a concurrent change to another key is not overwritten.
      const { data: current } = await supabase.from('organization').select('settings').eq('id', organization.id).single()
      const base = (current?.settings ?? organization.settings ?? {}) as OrgSettings
      const settings: OrgSettings = {
        ...base,
        inspection_reports: { ...base.inspection_reports, templates_folder: folder },
      }
      const { data, error } = await supabase
        .from('organization')
        .update({ settings: settings as never })
        .eq('id', organization.id)
        .select('settings')
        .single()
      if (error) throw error
      if (!data) throw new Error(t('source.inspection.tfNoPermission'))
      setOrganization({ ...organization, settings })
      setVaultDraft(null)
      setPathDraft(null)
      addToast('success', t(folder ? 'source.inspection.tfSaved' : 'source.inspection.tfCleared'))
      // Always sync after a change: clearing the folder archives its templates.
      await onSync(true)
    } catch (err) {
      log.error('[InspectionTemplates]', 'Saving the templates folder failed', { error: errorText(err) })
      addToast('error', t('source.inspection.tfSaveFailed', { error: errorText(err) }))
    } finally {
      setSaving(false)
    }
  }

  const status =
    lastSync?.skipped === 'NO_VAULT_ACCESS'
      ? { tone: 'warning' as const, text: t('source.inspection.tfNoVaultAccess') }
      : lastSync?.skipped === 'VAULT_NOT_FOUND'
        ? { tone: 'warning' as const, text: t('source.inspection.tfVaultMissing') }
        : null

  return (
    <SettingsSection
      title={
        <span className="flex items-center gap-2">
          <span>{t('source.inspection.tfTitle')}</span>
          {dirty && <Badge tone="warning">{t('source.inspection.tfUnsaved')}</Badge>}
        </span>
      }
      description={t('source.inspection.tfIntro')}
      actions={
        saved ? (
          <Button
            variant="ghost"
            size="sm"
            icon={<RefreshCw size={14} />}
            onClick={() => void onSync()}
            loading={syncing}
            disabled={saving}
          >
            {t('source.inspection.tfSyncNow')}
          </Button>
        ) : undefined
      }
    >
      <SettingsGroup>
        {isAdmin ? (
          <>
            <SettingRow label={t('source.inspection.tfVault')} htmlFor="tpl-folder-vault">
              <Select
                id="tpl-folder-vault"
                value={vaultId}
                onChange={(e) => setVaultDraft(e.target.value)}
                disabled={saving}
                className="w-64"
              >
                <option value="">{t('source.inspection.tfVaultPick')}</option>
                {vaults.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </Select>
            </SettingRow>
            <SettingRow
              label={t('source.inspection.tfPath')}
              description={t('source.inspection.tfPathDescription')}
              htmlFor="tpl-folder-path"
              stacked
            >
              <div className="flex items-center gap-2">
                <TextInput
                  id="tpl-folder-path"
                  value={pathText}
                  onChange={(e) => setPathDraft(e.target.value)}
                  placeholder={t('source.inspection.tfPathPlaceholder')}
                  disabled={saving || !vaultId}
                  spellCheck={false}
                  className="flex-1 font-mono"
                />
                {hasDesktop() && (
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<FolderOpen size={14} />}
                    onClick={() => void browse()}
                    disabled={saving || !vaultId}
                    title={localRoot ? undefined : t('source.inspection.tfBrowseNotConnected')}
                  >
                    {t('source.inspection.tfBrowse')}
                  </Button>
                )}
                <Button
                  variant="primary"
                  size="sm"
                  icon={<Check size={14} />}
                  onClick={() => normalized && vaultId && void save({ vault_id: vaultId, path: normalized })}
                  disabled={!dirty || !normalized || !vaultId}
                  loading={saving}
                >
                  {t('source.inspection.tfSave')}
                </Button>
                {saved && (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<X size={14} />}
                    onClick={() => void save(null)}
                    disabled={saving}
                  >
                    {t('source.inspection.tfClear')}
                  </Button>
                )}
              </div>
              {pathInvalid && <p className="mt-1 text-[12px] text-ui-danger">{t('source.inspection.tfInvalidPath')}</p>}
            </SettingRow>
          </>
        ) : (
          <p className="py-3.5 text-[14px] text-ui-fg-secondary">
            {saved ? (
              <span className="font-mono text-ui-fg">
                {vaultName ? `${vaultName}: ` : ''}
                {saved.path}
              </span>
            ) : (
              t('source.inspection.tfNotSet')
            )}
          </p>
        )}
        {isAdmin && !saved && !dirty && (
          <p className="pb-3 text-[13px] text-ui-fg-secondary">{t('source.inspection.tfNotSet')}</p>
        )}
        {status && (
          <div className="py-2">
            <Callout tone={status.tone}>{status.text}</Callout>
          </div>
        )}
        {saved && lastSync && !lastSync.skipped && (
          <p className="pb-3 text-[12px] text-ui-fg-secondary">
            {lastSync.created + lastSync.updated + lastSync.restored + lastSync.archived > 0
              ? t('source.inspection.tfSynced', {
                  created: lastSync.created,
                  updated: lastSync.updated,
                  restored: lastSync.restored,
                  archived: lastSync.archived,
                })
              : t('source.inspection.tfUpToDate')}
          </p>
        )}
      </SettingsGroup>
    </SettingsSection>
  )
}
