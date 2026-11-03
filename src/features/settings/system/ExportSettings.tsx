import { useState, useEffect, useMemo } from 'react'
import { Building2, Eye, Loader2, RotateCcw, User } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'

import {
  Button,
  SegmentedControl,
  Switch,
  TextInput,
  type SegmentedOption,
} from '@/components/core/ui'
import { useTranslation } from '@/lib/i18n'
import { log } from '@/lib/logger'
import { outputFileName, SAMPLE_OUTPUT_NAME_VALUES } from '@/lib/outputs/fileName'
import { hasDesktop } from '@/lib/platform'
import { supabase } from '@/lib/supabase'
import { usePDMStore } from '@/stores/pdmStore'
import { ExportSettings as ExportSettingsType, DEFAULT_EXPORT_SETTINGS } from '@/types/pdm'

import { SettingRow, SettingsGroup, SettingsPage, SettingsSection } from '../components/ui'
import { AutoOutputSettingsSection } from './AutoOutputSettings'
import { QuickExportFolderRow } from './QuickExportFolderRow'

// LocalStorage key for user preferences
const USER_EXPORT_SETTINGS_KEY = 'blueplm_export_settings'

// Available tokens for filename patterns
const FILENAME_TOKENS = [
  {
    token: '{filename}',
    labelKey: 'settingsPages.export.tokens.fileName',
    descriptionKey: 'settingsPages.export.tokens.fileNameDescription',
    example: 'Part1',
  },
  {
    token: '{config}',
    labelKey: 'settingsPages.export.tokens.configuration',
    descriptionKey: 'settingsPages.export.tokens.configurationDescription',
    example: 'Default',
  },
  {
    token: '{partNumber}',
    labelKey: 'settingsPages.export.tokens.partNumber',
    descriptionKey: 'settingsPages.export.tokens.partNumberDescription',
    example: 'BR-101011-394',
  },
  {
    token: '{number}',
    labelKey: 'settingsPages.export.tokens.numberAlternate',
    descriptionKey: 'settingsPages.export.tokens.sameAsPartNumber',
    example: 'BR-101011-394',
  },
  {
    token: '{tab}',
    labelKey: 'settingsPages.export.tokens.tabNumber',
    descriptionKey: 'settingsPages.export.tokens.tabNumberDescription',
    example: '394',
  },
  {
    token: '{tabNumber}',
    labelKey: 'settingsPages.export.tokens.tabAlternate',
    descriptionKey: 'settingsPages.export.tokens.sameAsTab',
    example: '394',
  },
  {
    token: '{revision}',
    labelKey: 'settingsPages.export.tokens.revision',
    descriptionKey: 'settingsPages.export.tokens.revisionDescription',
    example: 'A',
  },
  {
    token: '{rev}',
    labelKey: 'settingsPages.export.tokens.revisionAlternate',
    descriptionKey: 'settingsPages.export.tokens.sameAsRevision',
    example: 'A',
  },
  {
    token: '{description}',
    labelKey: 'settingsPages.export.tokens.description',
    descriptionKey: 'settingsPages.export.tokens.descriptionDescription',
    example: 'Thruster Housing',
  },
  {
    token: '{desc}',
    labelKey: 'settingsPages.export.tokens.descriptionAlternate',
    descriptionKey: 'settingsPages.export.tokens.sameAsDescription',
    example: 'Thruster Housing',
  },
  {
    token: '{date}',
    labelKey: 'settingsPages.export.tokens.date',
    descriptionKey: 'settingsPages.export.tokens.dateDescription',
    example: '2026-01-01',
  },
  {
    token: '{time}',
    labelKey: 'settingsPages.export.tokens.time',
    descriptionKey: 'settingsPages.export.tokens.timeDescription',
    example: '14-30-00',
  },
  {
    token: '{datetime}',
    labelKey: 'settingsPages.export.tokens.dateTime',
    descriptionKey: 'settingsPages.export.tokens.dateTimeDescription',
    example: '2026-01-01_14-30-00',
  },
]

// Preset patterns for quick selection
const PRESET_PATTERNS = [
  { pattern: '{filename}_{config}', labelKey: 'settingsPages.export.presets.fileAndConfig', description: 'Part1_Default.step' },
  { pattern: '{partNumber}', labelKey: 'settingsPages.export.presets.partNumberOnly', description: 'BR-101011-394.step' },
  {
    pattern: '{partNumber}_Rev{rev}',
    labelKey: 'settingsPages.export.presets.partAndRevision',
    description: 'BR-101011-394_RevA.step',
  },
  { pattern: '{partNumber}-{tab}', labelKey: 'settingsPages.export.presets.partAndTab', description: 'BR-101011-394.step' },
  {
    pattern: '{partNumber}-{tab}_Rev{rev}',
    labelKey: 'settingsPages.export.presets.partTabAndRevision',
    description: 'BR-101011-394_RevA.step',
  },
  {
    pattern: '{partNumber}_{config}',
    labelKey: 'settingsPages.export.presets.partAndConfig',
    description: 'BR-101011-394_Default.step',
  },
  {
    pattern: '{partNumber}_{config}_Rev{rev}',
    labelKey: 'settingsPages.export.presets.partConfigAndRevision',
    description: 'BR-101011-394_Default_RevA.step',
  },
  { pattern: '{filename}_{date}', labelKey: 'settingsPages.export.presets.fileAndDate', description: 'Part1_2026-01-01.step' },
]

// '' stands for a stored setting that has no value yet: no segment is selected.
type ExportFormatChoice = NonNullable<ExportSettingsType['default_export_format']> | ''
type StlResolutionChoice = NonNullable<ExportSettingsType['stl_resolution']> | ''

const EXPORT_FORMAT_OPTIONS: SegmentedOption<ExportFormatChoice>[] = [
  { value: 'step', label: 'STEP' },
  { value: 'iges', label: 'IGES' },
  { value: 'stl', label: 'STL' },
]

const STL_RESOLUTION_OPTIONS: { value: StlResolutionChoice; translationKey: string }[] = [
  { value: 'coarse', translationKey: 'settingsPages.export.resolution.coarse' },
  { value: 'fine', translationKey: 'settingsPages.export.resolution.fine' },
  { value: 'custom', translationKey: 'settingsPages.export.resolution.custom' },
]

// Get user's export settings from localStorage
function getUserExportSettings(): ExportSettingsType | null {
  try {
    const stored = localStorage.getItem(USER_EXPORT_SETTINGS_KEY)
    if (stored) {
      return JSON.parse(stored)
    }
  } catch {
    // Ignore parse errors
  }
  return null
}

// Save user's export settings to localStorage
function saveUserExportSettings(settings: ExportSettingsType) {
  localStorage.setItem(USER_EXPORT_SETTINGS_KEY, JSON.stringify(settings))
}

// Clear user's export settings (revert to org default)
function clearUserExportSettings() {
  localStorage.removeItem(USER_EXPORT_SETTINGS_KEY)
}

// Get effective export settings (user override > org default > app default)
export function getEffectiveExportSettings(
  organization: { settings?: any } | null,
): ExportSettingsType {
  // First check user preference
  const userSettings = getUserExportSettings()
  if (userSettings) {
    return userSettings
  }

  // Then check org default
  const orgSettings = organization?.settings?.export_settings
  if (orgSettings) {
    return { ...DEFAULT_EXPORT_SETTINGS, ...orgSettings }
  }

  // Fall back to app default
  return DEFAULT_EXPORT_SETTINGS
}

export function ExportSettings() {
  const { t } = useTranslation()
  const { organization, addToast, getEffectiveRole, updateOrganization } = usePDMStore(
    useShallow((s) => ({
      organization: s.organization,
      addToast: s.addToast,
      getEffectiveRole: s.getEffectiveRole,
      updateOrganization: s.updateOrganization,
    })),
  )
  const isAdmin = getEffectiveRole() === 'admin'
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [settings, setSettings] = useState<ExportSettingsType>(DEFAULT_EXPORT_SETTINGS)
  const [hasUserOverride, setHasUserOverride] = useState(false)

  // Load settings - user override takes priority over org default
  useEffect(() => {
    if (!organization) return

    const userSettings = getUserExportSettings()
    if (userSettings) {
      setSettings(userSettings)
      setHasUserOverride(true)
    } else {
      const orgSettings = (organization.settings as any)?.export_settings // TODO: type this
      if (orgSettings) {
        setSettings({ ...DEFAULT_EXPORT_SETTINGS, ...orgSettings })
      } else {
        setSettings(DEFAULT_EXPORT_SETTINGS)
      }
      setHasUserOverride(false)
    }
    setLoading(false)
  }, [organization])

  // Get org default for comparison
  const orgDefault = useMemo(() => {
    const orgSettings = (organization?.settings as any)?.export_settings // TODO: type this
    return orgSettings ? { ...DEFAULT_EXPORT_SETTINGS, ...orgSettings } : DEFAULT_EXPORT_SETTINGS
  }, [organization?.settings])

  // A live preview of the file name, named exactly as saved outputs are (src/lib/outputs).
  const livePreview = useMemo(
    () => outputFileName(settings.filename_pattern, SAMPLE_OUTPUT_NAME_VALUES, 'step'),
    [settings.filename_pattern],
  )

  // Save as user preference (localStorage)
  const handleSaveUserPreference = () => {
    saveUserExportSettings(settings)
    setHasUserOverride(true)
    addToast('success', t('settingsPages.export.savedPersonal'))
  }

  // Reset to org default
  const handleResetToOrgDefault = () => {
    clearUserExportSettings()
    setSettings(orgDefault)
    setHasUserOverride(false)
    addToast('info', t('settingsPages.export.resetOrganization'))
  }

  // Save as org default (admin only)
  const handleSaveOrgDefault = async () => {
    if (!organization?.id || !isAdmin) return

    setSaving(true)
    try {
      // Get current settings and merge
      const currentSettings = organization.settings || {}
      const newSettings = {
        ...currentSettings,
        export_settings: settings,
      }

      const { error } = await (supabase.from('organization') as any) // TODO: type this
        .update({ settings: newSettings })
        .eq('id', organization.id)
        .select()

      if (error) {
        log.error('[ExportSettings]', 'Supabase error', { error })
        throw error
      }

      // Update local state
      updateOrganization({ settings: newSettings } as any) // TODO: type this
      addToast('success', t('settingsPages.export.savedOrganization'))
    } catch (error) {
      log.error('[ExportSettings]', 'Failed to save org export settings', { error: error })
      addToast(
        'error',
        `${t('settingsPages.export.saveFailed')}: ${
          error instanceof Error ? error.message : t('settingsPages.export.unknownError')
        }`,
      )
    } finally {
      setSaving(false)
    }
  }

  // Insert token at cursor or end of pattern
  const insertToken = (token: string) => {
    setSettings((prev) => ({
      ...prev,
      filename_pattern: prev.filename_pattern + token,
    }))
  }

  if (!organization) {
    return (
      <div className="py-12 text-center text-[14px] text-ui-fg-secondary">
        {t('settingsPages.noOrganizationSelected')}
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-[14px] text-ui-fg-secondary">
        <Loader2 className="animate-spin" size={16} />
        <span>{t('settingsPages.export.loading')}</span>
      </div>
    )
  }

  return (
    <SettingsPage>
      <SettingsSection
        title={t('settingsPages.export.title')}
        description={
          hasUserOverride
            ? t('settingsPages.export.usingPersonal')
            : t('settingsPages.export.usingOrganization')
        }
        actions={
          <>
            {hasUserOverride && (
              <Button
                variant="ghost"
                size="sm"
                icon={<RotateCcw size={14} />}
                onClick={handleResetToOrgDefault}
                title={t('settingsPages.export.resetOrganization')}
              >
                {t('settingsPages.export.resetDefault')}
              </Button>
            )}
            {isAdmin && (
              <Button
                size="sm"
                icon={<Building2 size={14} />}
                loading={saving}
                onClick={handleSaveOrgDefault}
                title={t('settingsPages.export.organizationWideDefault')}
              >
                {t('settingsPages.export.saveOrganizationDefault')}
              </Button>
            )}
            <Button
              variant="primary"
              size="sm"
              icon={<User size={14} />}
              onClick={handleSaveUserPreference}
            >
              {t('settingsPages.export.saveForMe')}
            </Button>
          </>
        }
      >
        <SettingsGroup>
          <SettingRow
            label={t('settingsPages.export.filenamePattern')}
            htmlFor="export-filename-pattern"
            description={t('settingsPages.export.tokenHelp', {
              examples: '{partNumber}, {config}, {rev}',
            })}
            stacked
          >
            <TextInput
              id="export-filename-pattern"
              value={settings.filename_pattern}
              onChange={(e) =>
                setSettings((prev) => ({ ...prev, filename_pattern: e.target.value }))
              }
              placeholder="{filename}_{config}"
              className="font-mono"
            />
            <div className="mt-2 flex items-center gap-3 rounded-lg border border-ui-border bg-ui-field/50 px-3 py-2.5 text-[12px] text-ui-fg-secondary">
              <Eye size={14} className="shrink-0" />
              <span className="shrink-0">{t('settingsPages.export.preview')}</span>
              <span className="truncate font-mono text-[13px] text-ui-fg" title={livePreview}>
                {livePreview}
              </span>
            </div>
          </SettingRow>

          <SettingRow label={t('settingsPages.export.quickPresets')} stacked>
            <div className="flex flex-wrap gap-1.5">
              {PRESET_PATTERNS.map((preset) => (
                <button
                  type="button"
                  key={preset.pattern}
                  onClick={() =>
                    setSettings((prev) => ({ ...prev, filename_pattern: preset.pattern }))
                  }
                  aria-pressed={settings.filename_pattern === preset.pattern}
                  className={`h-7 rounded-lg border px-2.5 text-[13px] text-ui-fg transition-colors ${
                    settings.filename_pattern === preset.pattern
                      ? 'border-ui-selected-border bg-ui-selected'
                      : 'border-ui-field-border bg-ui-field hover:bg-ui-hover'
                  }`}
                  title={preset.description}
                >
                  {t(preset.labelKey)}
                </button>
              ))}
            </div>
          </SettingRow>

          <SettingRow label={t('settingsPages.export.availableTokens')} stacked>
            {/* Keep the compact token chips introduced in 5.9.0, with translated details. */}
            <div className="flex flex-wrap gap-1">
              {FILENAME_TOKENS.map(({ token, labelKey, descriptionKey, example }) => (
                <button
                  type="button"
                  key={token}
                  onClick={() => insertToken(token)}
                  className="rounded-md border border-ui-field-border bg-ui-field px-1.5 py-0.5 font-mono text-[12px] text-ui-fg-secondary transition-colors hover:border-ui-accent/50 hover:bg-ui-accent/10 hover:text-ui-fg"
                  title={`${t(labelKey)}: ${t(descriptionKey)} (${t('settingsPages.export.exampleAbbreviation')} ${example})`}
                >
                  {token}
                </button>
              ))}
            </div>
          </SettingRow>
        </SettingsGroup>
      </SettingsSection>

      <SettingsSection title={t('settingsPages.export.additionalOptions')}>
        <SettingsGroup>
          <SettingRow
            label={t('settingsPages.export.includeConfiguration')}
            description={t('settingsPages.export.includeConfigurationHelp')}
          >
            <Switch
              checked={settings.include_config_in_filename}
              onChange={(checked) =>
                setSettings((prev) => ({ ...prev, include_config_in_filename: checked }))
              }
              aria-label={t('settingsPages.export.includeConfiguration')}
            />
          </SettingRow>
          <SettingRow
            label={t('settingsPages.export.defaultFormat')}
            description={t('settingsPages.export.defaultFormatHelp')}
          >
            <SegmentedControl<ExportFormatChoice>
              value={settings.default_export_format ?? ''}
              onChange={(format) => {
                if (!format) return
                const next = format
                setSettings((prev) => ({ ...prev, default_export_format: next }))
              }}
              options={EXPORT_FORMAT_OPTIONS}
              aria-label={t('settingsPages.export.defaultFormat')}
            />
          </SettingRow>
        </SettingsGroup>
      </SettingsSection>

      <AutoOutputSettingsSection />

      <SettingsSection title={t('settingsPages.export.stlOptions')}>
        <SettingsGroup>
          <SettingRow
            label={t('settingsPages.export.resolutionQuality')}
            description={
              <>
                {settings.stl_resolution === 'coarse' &&
                  t('settingsPages.export.resolution.coarseHelp')}
                {settings.stl_resolution === 'fine' &&
                  t('settingsPages.export.resolution.fineHelp')}
                {settings.stl_resolution === 'custom' &&
                  t('settingsPages.export.resolution.customHelp')}
              </>
            }
          >
            <SegmentedControl<StlResolutionChoice>
              value={settings.stl_resolution ?? ''}
              onChange={(res) => {
                if (!res) return
                const next = res
                setSettings((prev) => ({ ...prev, stl_resolution: next }))
              }}
              options={STL_RESOLUTION_OPTIONS.map(({ value, translationKey }) => ({
                value,
                label: t(translationKey),
              }))}
              aria-label={t('settingsPages.export.resolutionQuality')}
            />
          </SettingRow>

          {settings.stl_resolution === 'custom' && (
            <SettingRow
              label={t('settingsPages.export.deviation')}
              htmlFor="export-stl-deviation"
              description={t('settingsPages.export.deviationHelp')}
            >
              <TextInput
                id="export-stl-deviation"
                type="number"
                step="0.01"
                min="0.001"
                max="10"
                value={settings.stl_custom_deviation ?? 0.1}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    stl_custom_deviation: parseFloat(e.target.value) || 0.1,
                  }))
                }
                className="!w-28"
              />
            </SettingRow>
          )}
          {settings.stl_resolution === 'custom' && (
            <SettingRow
              label={t('settingsPages.export.angleTolerance')}
              htmlFor="export-stl-angle"
              description={t('settingsPages.export.angleToleranceHelp')}
            >
              <TextInput
                id="export-stl-angle"
                type="number"
                step="1"
                min="1"
                max="45"
                value={settings.stl_custom_angle ?? 10}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    stl_custom_angle: parseFloat(e.target.value) || 10,
                  }))
                }
                className="!w-28"
              />
            </SettingRow>
          )}

          <SettingRow
            label={t('settingsPages.export.binaryFormat')}
            description={t('settingsPages.export.binaryFormatHelp')}
          >
            <Switch
              checked={settings.stl_binary_format ?? true}
              onChange={(checked) =>
                setSettings((prev) => ({ ...prev, stl_binary_format: checked }))
              }
              aria-label={t('settingsPages.export.binaryFormat')}
            />
          </SettingRow>
        </SettingsGroup>
      </SettingsSection>

      {hasDesktop() && (
        <SettingsSection
          title={t('contextMenu.quickExport.sectionTitle')}
          description={t('contextMenu.quickExport.sectionDescription')}
        >
          <SettingsGroup>
            <QuickExportFolderRow />
          </SettingsGroup>
        </SettingsSection>
      )}

      <SettingsSection title={t('settingsPages.export.tokenReference')}>
        <SettingsGroup>
          <table className="w-full text-[14px]">
            <thead>
              <tr className="border-b border-ui-divider">
                <th className="pb-2 pr-4 pt-3 text-left text-[13px] font-normal text-ui-fg-secondary">
                  {t('settingsPages.export.token')}
                </th>
                <th className="pb-2 pr-4 pt-3 text-left text-[13px] font-normal text-ui-fg-secondary">
                  {t('settingsPages.export.tokenDescription')}
                </th>
                <th className="pb-2 pt-3 text-left text-[13px] font-normal text-ui-fg-secondary">
                  {t('settingsPages.export.example')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ui-divider">
              {FILENAME_TOKENS.map(({ token, descriptionKey, example }) => (
                <tr key={token}>
                  <td className="py-3 pr-4 font-mono text-ui-fg">{token}</td>
                  <td className="py-3 pr-4 text-ui-fg-secondary">{t(descriptionKey)}</td>
                  <td className="py-3 text-ui-fg">{example}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </SettingsGroup>
      </SettingsSection>
    </SettingsPage>
  )
}
