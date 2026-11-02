import { useState, useEffect } from 'react'
import { ExternalLink } from 'lucide-react'

import { Button } from '@/components/core/ui'
import { useTranslation } from '@/lib/i18n'
import { usePDMStore } from '@/stores/pdmStore'

import { SettingRow, SettingsGroup, SettingsPage, SettingsSection } from '../components/ui'

export function AboutSettings() {
  const { t } = useTranslation()
  const [appVersion, setAppVersion] = useState<string>('')
  const [platform, setPlatform] = useState<string>('win32')
  const updateVersion = usePDMStore((s) =>
    s.updateAvailable && !s.updateAvailable.isManualVersion ? s.updateAvailable.version : null,
  )

  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.getVersion().then(setAppVersion)
      window.electronAPI.getPlatform().then(setPlatform)
    }
  }, [])

  const platformDisplay =
    {
      win32: 'Windows',
      darwin: 'macOS',
      linux: 'Linux',
    }[platform] || platform

  const openExternal = (url: string) => {
    window.electronAPI?.openFile(url)
  }

  return (
    <SettingsPage>
      <SettingsSection
        title="BluePLM"
        description="Check in/out CAD files, track revisions, manage engineering changes, control release workflows, and collaborate with your team, all in one place."
      >
        <SettingsGroup>
          <SettingRow
            label={`Version ${appVersion || '...'} · Platform: ${platformDisplay}`}
            description={
              updateVersion
                ? t('preferences.updateReadyTitle', { version: updateVersion })
                : undefined
            }
          >
            <Button
              variant={updateVersion ? 'primary' : 'secondary'}
              onClick={() => usePDMStore.getState().setSettingsTab('updates')}
            >
              {t('preferences.openUpdates')}
            </Button>
          </SettingRow>
        </SettingsGroup>
      </SettingsSection>

      <SettingsSection title="Links">
        <SettingsGroup>
          <SettingRow label="GitHub Repository" description="View source code and contribute">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => openExternal('https://github.com/bluerobotics/bluePLM')}
            >
              Open
              <ExternalLink size={12} />
            </Button>
          </SettingRow>
          <SettingRow label="Report Issues" description="Found a bug? Let us know!">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => openExternal('https://github.com/bluerobotics/bluePLM/issues')}
            >
              Open
              <ExternalLink size={12} />
            </Button>
          </SettingRow>
        </SettingsGroup>
      </SettingsSection>

      <p className="text-[13px] text-ui-fg-secondary">
        Made by Blue Robotics and contributors worldwide.
      </p>
      <p className="text-[13px] text-ui-fg-secondary">
        Made by Blue Robotics and contributors worldwide.
      </p>
    </SettingsPage>
  )
}
