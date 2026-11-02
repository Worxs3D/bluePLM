import { useState, useEffect, useRef } from 'react'
import { Loader2, Save } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'

import { Button, Switch } from '@/components/core/ui'
import { log } from '@/lib/logger'
import { useTranslation } from '@/lib/i18n'
import { supabase } from '@/lib/supabase'
import { usePDMStore } from '@/stores/pdmStore'
import { DEFAULT_AUTH_PROVIDERS, type AuthProviderSettings } from '@/types/pdm'

import { SettingRow, SettingsGroup, SettingsPage, SettingsSection } from '../components/ui'

export function AuthProvidersSettings() {
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

  // Track if we're currently saving to avoid overwriting with stale realtime data
  const savingRef = useRef(false)

  const [settings, setSettings] = useState<AuthProviderSettings>(DEFAULT_AUTH_PROVIDERS)

  // Load current settings
  useEffect(() => {
    if (!organization?.id) return

    const loadSettings = async () => {
      setLoading(true)
      try {
        const { data, error } = await supabase
          .from('organization')
          .select('auth_providers')
          .eq('id', organization.id)
          .single()

        if (error) throw error

        // Merge with defaults to ensure all fields exist
        const authProviders = data?.auth_providers as AuthProviderSettings | null
        setSettings({
          users: {
            google: authProviders?.users?.google ?? true,
            email: authProviders?.users?.email ?? true,
            phone: authProviders?.users?.phone ?? true,
          },
          suppliers: {
            google: authProviders?.suppliers?.google ?? true,
            email: authProviders?.suppliers?.email ?? true,
            phone: authProviders?.suppliers?.phone ?? true,
          },
        })
      } catch (error) {
        log.error('[AuthProviders]', 'Failed to load auth provider settings', { error: error })
        addToast('error', t('settingsPages.authProviders.loadFailed'))
      } finally {
        setLoading(false)
      }
    }

    loadSettings()
  }, [organization?.id])

  // Sync with realtime organization changes
  useEffect(() => {
    if (savingRef.current || loading) return

    if (organization?.auth_providers) {
      const authProviders = organization.auth_providers
      setSettings({
        users: {
          google: authProviders?.users?.google ?? true,
          email: authProviders?.users?.email ?? true,
          phone: authProviders?.users?.phone ?? true,
        },
        suppliers: {
          google: authProviders?.suppliers?.google ?? true,
          email: authProviders?.suppliers?.email ?? true,
          phone: authProviders?.suppliers?.phone ?? true,
        },
      })
    }
  }, [organization?.auth_providers])

  // Save settings
  const handleSave = async () => {
    if (!organization?.id) return

    // Validate: at least one provider must be enabled for each category
    if (!settings.users.google && !settings.users.email && !settings.users.phone) {
      addToast('error', t('settingsPages.authProviders.userMethodRequired'))
      return
    }
    if (!settings.suppliers.google && !settings.suppliers.email && !settings.suppliers.phone) {
      addToast('error', t('settingsPages.authProviders.supplierMethodRequired'))
      return
    }

    setSaving(true)
    savingRef.current = true
    try {
      const { error } = await supabase
        .from('organization')
        .update({ auth_providers: JSON.parse(JSON.stringify(settings)) })
        .eq('id', organization.id)

      if (error) throw error
      addToast('success', t('settingsPages.authProviders.saved'))
    } catch (error) {
      log.error('[AuthProviders]', 'Failed to save auth provider settings', { error: error })
      addToast('error', t('settingsPages.authProviders.saveFailed'))
    } finally {
      setSaving(false)
      setTimeout(() => {
        savingRef.current = false
      }, 1000)
    }
  }

  // Update a provider setting
  const updateProvider = (
    accountType: 'users' | 'suppliers',
    provider: 'google' | 'email' | 'phone',
    enabled: boolean,
  ) => {
    setSettings((prev) => ({
      ...prev,
      [accountType]: {
        ...prev[accountType],
        [provider]: enabled,
      },
    }))
  }

  if (!organization) {
    return <div className="py-12 text-center text-[14px] text-ui-fg-secondary">{t('settingsPages.noOrganization')}</div>
  }

  if (!isAdmin) {
    return (
      <div className="py-12 text-center text-[14px] text-ui-fg-secondary">
        {t('settingsPages.authProviders.adminOnly')}
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

  const providers: { key: 'google' | 'email' | 'phone'; label: string }[] = [
    { key: 'google', label: t('settingsPages.authProviders.google') },
    { key: 'email', label: t('settingsPages.authProviders.emailPassword') },
    { key: 'phone', label: t('settingsPages.authProviders.phoneSms') },
  ]

  const renderProviders = (accountType: 'users' | 'suppliers') => (
    <SettingsGroup>
      {providers.map((provider) => {
        const id = `auth-${accountType}-${provider.key}`
        return (
          <SettingRow
            key={provider.key}
            htmlFor={id}
            label={provider.label}
          >
            <Switch
              id={id}
              checked={settings[accountType][provider.key]}
              onChange={(enabled) => updateProvider(accountType, provider.key, enabled)}
            />
          </SettingRow>
        )
      })}
    </SettingsGroup>
  )

  return (
    <SettingsPage>
      <SettingsSection
        title={t('settingsPages.authProviders.teamMembers')}
        description={t('settingsPages.authProviders.teamDescription')}
      >
        {renderProviders('users')}
      </SettingsSection>

      <SettingsSection
        title={t('settingsPages.authProviders.suppliers')}
        description={t('settingsPages.authProviders.supplierDescription')}
      >
        {renderProviders('suppliers')}
      </SettingsSection>

      <div className="flex items-start justify-between gap-12">
        <p className="text-[14px] leading-[1.4] text-ui-fg-secondary">
          {t('settingsPages.authProviders.securityDescription')}
        </p>
        <Button variant="primary" loading={saving} icon={<Save size={14} />} onClick={handleSave}>
          {t('settingsPages.saveSettings')}
        </Button>
      </div>
    </SettingsPage>
  )
}
