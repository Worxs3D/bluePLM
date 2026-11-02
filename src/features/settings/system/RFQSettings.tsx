import { useState, useEffect, useRef } from 'react'
import { Loader2, Save } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'

import { Button, Switch, TextArea, TextInput } from '@/components/core/ui'
import { log } from '@/lib/logger'
import { useTranslation } from '@/lib/i18n'
import { supabase } from '@/lib/supabase'
import { usePDMStore } from '@/stores/pdmStore'

import { SettingRow, SettingsGroup, SettingsPage, SettingsSection } from '../components/ui'

interface RFQSettingsData {
  default_payment_terms: string
  default_incoterms: string
  default_valid_days: number
  show_company_logo: boolean
  show_revision_column: boolean
  show_material_column: boolean
  show_finish_column: boolean
  show_notes_column: boolean
  terms_and_conditions: string
  footer_text: string
}

type RFQColumnKey =
  | 'show_company_logo'
  | 'show_revision_column'
  | 'show_material_column'
  | 'show_finish_column'
  | 'show_notes_column'

const COLUMN_TOGGLES: { key: RFQColumnKey; translationKey: string }[] = [
  { key: 'show_company_logo', translationKey: 'settingsPages.rfq.showLogo' },
  { key: 'show_revision_column', translationKey: 'settingsPages.rfq.showRevision' },
  { key: 'show_material_column', translationKey: 'settingsPages.rfq.showMaterial' },
  { key: 'show_finish_column', translationKey: 'settingsPages.rfq.showFinish' },
  { key: 'show_notes_column', translationKey: 'settingsPages.rfq.showNotes' },
]

const DEFAULT_RFQ_SETTINGS: RFQSettingsData = {
  default_payment_terms: 'Net 30',
  default_incoterms: 'FOB',
  default_valid_days: 30,
  show_company_logo: true,
  show_revision_column: true,
  show_material_column: true,
  show_finish_column: true,
  show_notes_column: true,
  terms_and_conditions: '',
  footer_text: '',
}

export function RFQSettings() {
  const { t } = useTranslation()
  const { organization, addToast, getEffectiveRole } = usePDMStore(
    useShallow((s) => ({
      organization: s.organization,
      addToast: s.addToast,
      getEffectiveRole: s.getEffectiveRole,
    })),
  )
  const isAdmin = getEffectiveRole() === 'admin'
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [settings, setSettings] = useState<RFQSettingsData>(DEFAULT_RFQ_SETTINGS)

  // Track if we're currently saving to avoid overwriting with stale realtime data
  const savingRef = useRef(false)

  // Load current settings on mount
  useEffect(() => {
    if (!organization?.id) return

    const loadSettings = async () => {
      setLoading(true)
      try {
        const { data, error } = await supabase
          .from('organization')
          .select('rfq_settings')
          .eq('id', organization.id)
          .single()

        if (error) throw error

        const rfqData = data?.rfq_settings
        setSettings(
          rfqData && typeof rfqData === 'object' && !Array.isArray(rfqData)
            ? (rfqData as unknown as RFQSettingsData)
            : DEFAULT_RFQ_SETTINGS,
        )
      } catch (error) {
        log.error('[RFQ]', 'Failed to load RFQ settings', { error: error })
      } finally {
        setLoading(false)
      }
    }

    loadSettings()
  }, [organization?.id])

  // Sync with realtime organization changes (when another admin updates settings)
  useEffect(() => {
    // Skip if we're currently saving (to avoid overwriting our own changes)
    if (savingRef.current) return
    // Skip if still loading initial data
    if (loading) return

    // Get rfq_settings from the organization object (updated via realtime)
    const realtimeSettings = (organization as any)?.rfq_settings // TODO: type this
    if (realtimeSettings) {
      setSettings({ ...DEFAULT_RFQ_SETTINGS, ...realtimeSettings })
    }
  }, [(organization as any)?.rfq_settings]) // TODO: type this

  // Save settings
  const handleSave = async () => {
    if (!organization?.id) return

    setSaving(true)
    savingRef.current = true
    try {
      const { error } = await supabase
        .from('organization')
        .update({ rfq_settings: JSON.parse(JSON.stringify(settings)) })
        .eq('id', organization.id)

      if (error) throw error
      addToast('success', t('settingsPages.rfq.saved'))
    } catch (error) {
      log.error('[RFQ]', 'Failed to save RFQ settings', { error: error })
      addToast('error', t('settingsPages.rfq.saveFailed'))
    } finally {
      setSaving(false)
      // Small delay before allowing realtime sync again to let the update propagate
      setTimeout(() => {
        savingRef.current = false
      }, 1000)
    }
  }

  // Update a setting
  const updateSetting = (key: keyof RFQSettingsData, value: string | number | boolean) => {
    setSettings((prev) => ({ ...prev, [key]: value }))
  }

  if (!organization) {
    return (
      <div className="py-12 text-center text-[14px] text-ui-fg-secondary">
        {t('settingsPages.noOrganization')}
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="animate-spin text-ui-fg-secondary" size={20} />
      </div>
    )
  }

  return (
    <SettingsPage>
      <SettingsSection
        title={t('settingsPages.rfq.title')}
        description={
          isAdmin
            ? undefined
            : t('settingsPages.rfq.readOnly')
        }
      >
        <SettingsGroup>
          <SettingRow label={t('settingsPages.rfq.paymentTerms')} htmlFor="rfq-payment-terms">
            <TextInput
              id="rfq-payment-terms"
              value={settings.default_payment_terms}
              onChange={(e) => updateSetting('default_payment_terms', e.target.value)}
              placeholder="Net 30"
              disabled={!isAdmin}
              className="!w-48"
            />
          </SettingRow>
          <SettingRow label={t('settingsPages.rfq.incoterms')} htmlFor="rfq-incoterms">
            <TextInput
              id="rfq-incoterms"
              value={settings.default_incoterms}
              onChange={(e) => updateSetting('default_incoterms', e.target.value)}
              placeholder="FOB"
              disabled={!isAdmin}
              className="!w-48"
            />
          </SettingRow>
          <SettingRow label={t('settingsPages.rfq.validDays')} htmlFor="rfq-valid-days">
            <TextInput
              id="rfq-valid-days"
              type="number"
              value={settings.default_valid_days}
              onChange={(e) => updateSetting('default_valid_days', parseInt(e.target.value) || 30)}
              min="1"
              disabled={!isAdmin}
              className="!w-24"
            />
          </SettingRow>
        </SettingsGroup>
      </SettingsSection>

      <SettingsSection title={t('settingsPages.rfq.documentColumns')}>
        <SettingsGroup>
          {COLUMN_TOGGLES.map(({ key, translationKey }) => {
            const label = t(translationKey)
            return (
              <SettingRow key={key} label={label}>
                <Switch
                  checked={settings[key]}
                  onChange={(checked) => updateSetting(key, checked)}
                  disabled={!isAdmin}
                  aria-label={label}
                />
              </SettingRow>
            )
          })}
        </SettingsGroup>
      </SettingsSection>

      <SettingsSection title={t('settingsPages.rfq.documentText')}>
        <SettingsGroup>
          <SettingRow label={t('settingsPages.rfq.terms')} htmlFor="rfq-terms" stacked>
            <TextArea
              id="rfq-terms"
              value={settings.terms_and_conditions}
              onChange={(e) => updateSetting('terms_and_conditions', e.target.value)}
              rows={4}
              placeholder={t('settingsPages.rfq.termsPlaceholder')}
              disabled={!isAdmin}
              className="resize-none"
            />
          </SettingRow>
          <SettingRow label={t('settingsPages.rfq.footer')} htmlFor="rfq-footer" stacked>
            <TextInput
              id="rfq-footer"
              value={settings.footer_text}
              onChange={(e) => updateSetting('footer_text', e.target.value)}
              placeholder={t('settingsPages.rfq.footerPlaceholder')}
              disabled={!isAdmin}
            />
          </SettingRow>
        </SettingsGroup>
      </SettingsSection>

      {isAdmin && (
        <div className="flex justify-end">
          <Button variant="primary" icon={<Save size={14} />} loading={saving} onClick={handleSave}>
            {t('settingsPages.saveSettings')}
          </Button>
        </div>
      )}
    </SettingsPage>
  )
}
