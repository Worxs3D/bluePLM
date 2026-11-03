/**
 * Settings > Export: "Outputs at check-in" (5.5.0). The organization setting
 * `organization.settings.outputs.auto_on_checkin = { pdf, step }` (both on by default, read
 * through `autoOutputSettings`): after a successful check-in, the desktop app generates the PDF of
 * each checked-in drawing and a STEP of each checked-in part and assembly in the background.
 * Administrators change it; everyone else sees it read-only.
 */
import { useState } from 'react'

import { Switch } from '@/components/core/ui'
import { t } from '@/lib/i18n'
import { log } from '@/lib/logger'
import { AUTO_OUTPUT_MAX_BATCH, autoOutputSettings, type AutoOutputSettings } from '@/lib/outputs'
import { supabase } from '@/lib/supabase'
import { usePDMStore } from '@/stores/pdmStore'
import type { OrgSettings } from '@/types/pdm'

import { SettingRow, SettingsGroup, SettingsSection } from '../components/ui'

export function AutoOutputSettingsSection() {
  const organization = usePDMStore((s) => s.organization)
  const setOrganization = usePDMStore((s) => s.setOrganization)
  const addToast = usePDMStore((s) => s.addToast)
  const getEffectiveRole = usePDMStore((s) => s.getEffectiveRole)
  const isAdmin = getEffectiveRole() === 'admin'
  const [saving, setSaving] = useState(false)
  const current = autoOutputSettings(organization?.settings)

  const save = async (patch: Partial<AutoOutputSettings>) => {
    if (!organization || !isAdmin) return
    setSaving(true)
    try {
      // Read the current settings first so a concurrent change to another key is not overwritten.
      const { data: fresh } = await supabase
        .from('organization')
        .select('settings')
        .eq('id', organization.id)
        .single()
      const base = (fresh?.settings ?? organization.settings ?? {}) as OrgSettings
      const auto = { ...autoOutputSettings(base), ...patch }
      const settings: OrgSettings = { ...base, outputs: { ...base.outputs, auto_on_checkin: auto } }
      const { data, error } = await supabase
        .from('organization')
        .update({ settings: settings as never })
        .eq('id', organization.id)
        .select('settings')
        .single()
      if (error) throw error
      if (!data) throw new Error(t('source.outputs.settingsNoPermission'))
      setOrganization({ ...organization, settings })
      addToast('success', t('source.outputs.settingsSaved'))
    } catch (error) {
      log.error('[ExportSettings]', 'Saving the automatic outputs setting failed', { error })
      addToast(
        'error',
        t('source.outputs.settingsSaveFailed', { error: error instanceof Error ? error.message : String(error) }),
      )
    } finally {
      setSaving(false)
    }
  }

  const disabled = !isAdmin || saving

  return (
    <SettingsSection
      title={t('source.outputs.settingsTitle')}
      description={
        isAdmin
          ? t('source.outputs.settingsDescription', { max: AUTO_OUTPUT_MAX_BATCH })
          : `${t('source.outputs.settingsDescription', { max: AUTO_OUTPUT_MAX_BATCH })} ${t('source.outputs.settingsAdminOnly')}`
      }
    >
      <SettingsGroup>
        <SettingRow
          label={t('source.outputs.settingsPdf')}
          description={t('source.outputs.settingsPdfHint')}
        >
          <Switch
            checked={current.pdf}
            disabled={disabled}
            onChange={(checked) => void save({ pdf: checked })}
            aria-label={t('source.outputs.settingsPdf')}
          />
        </SettingRow>
        <SettingRow
          label={t('source.outputs.settingsStep')}
          description={t('source.outputs.settingsStepHint')}
        >
          <Switch
            checked={current.step}
            disabled={disabled}
            onChange={(checked) => void save({ step: checked })}
            aria-label={t('source.outputs.settingsStep')}
          />
        </SettingRow>
      </SettingsGroup>
    </SettingsSection>
  )
}
