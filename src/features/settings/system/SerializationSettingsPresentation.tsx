import type { Dispatch, SetStateAction } from 'react'
import {
  AlertTriangle,
  Check,
  EyeOff,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Search,
  X,
} from 'lucide-react'

import { Button, FIELD_CLASS, Select, Switch } from '@/components/core/ui'
import type { TranslationParams } from '@/lib/i18n'
import type { HighestSerialScanResult } from '@/lib/serialization'

import { SettingRow, SettingsGroup, SettingsPage, SettingsSection } from '../components/ui'
import type { SerializationSettingsData } from './serializationSettingsModel'

// The controls the presentation test reads (fields and action buttons) stay native elements with
// the primitives' classes: the test walks the returned element tree without rendering components.
const INPUT = `${FIELD_CLASS} h-7 px-2.5`
const BUTTON = {
  base: 'inline-flex flex-shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border h-7 px-2.5 text-[13px] font-medium transition-colors duration-100 outline-none focus-visible:ring-2 focus-visible:ring-ui-accent/50 disabled:cursor-not-allowed disabled:opacity-40',
  primary: 'border-transparent bg-ui-fg text-ui-bg hover:bg-ui-fg/90',
  secondary: 'border-ui-field-border bg-ui-field text-ui-fg hover:bg-ui-selected',
  ghost: 'border-transparent bg-transparent text-ui-fg hover:bg-ui-hover',
} as const
const CODE = 'rounded-md bg-ui-field px-1.5 py-0.5 font-mono text-[13px] text-ui-fg'

const EXAMPLE_PATTERNS = [
  { code: 'PN-00001', noteKey: 'settingsPages.serialization.examplePrefixDigits' },
  { code: 'BR-AB00001', noteKey: 'settingsPages.serialization.examplePrefixLetters' },
  { code: '100001', noteKey: 'settingsPages.serialization.exampleNoPrefix' },
  { code: 'PN-00001-REV', noteKey: 'settingsPages.serialization.exampleSuffix' },
]

export interface SerializationSettingsBindings {
  organization: boolean
  loading: boolean
  isAdmin: boolean
  settings: SerializationSettingsData
  livePreview: string
  loadingPreview: boolean
  fetchPreview(): Promise<void>
  previewNumber: string | null
  updateSetting<K extends keyof SerializationSettingsData>(
    key: K,
    value: SerializationSettingsData[K],
  ): void
  detecting: boolean
  handleDetectHighest(): Promise<void>
  detectedResult: HighestSerialScanResult | null
  applyDetectedCounter(): void
  basePreview: string
  newKeepout: { start: string; end: string; description: string }
  setNewKeepout: Dispatch<SetStateAction<{ start: string; end: string; description: string }>>
  showKeepoutForm: boolean
  setShowKeepoutForm: Dispatch<SetStateAction<boolean>>
  addKeepoutZone(): void
  removeKeepoutZone(index: number): void
  customExtension: string
  setCustomExtension: Dispatch<SetStateAction<string>>
  toggleExtension(extension: string): void
  addCustomExtension(): void
  t(key: string, fallbackOrParams?: string | TranslationParams): string
  saving: boolean
  handleSave(): Promise<void>
}

// Common CAD file extensions for quick selection
const COMMON_EXTENSIONS = [
  { ext: '.sldprt', labelKey: 'settingsPages.serialization.extensionLabels.solidworksPart', icon: 'part' },
  { ext: '.sldasm', labelKey: 'settingsPages.serialization.extensionLabels.solidworksAssembly', icon: 'assembly' },
  { ext: '.slddrw', labelKey: 'settingsPages.serialization.extensionLabels.solidworksDrawing', icon: 'drawing' },
  { ext: '.step', labelKey: 'settingsPages.serialization.extensionLabels.step', icon: 'step' },
  { ext: '.stp', labelKey: 'settingsPages.serialization.extensionLabels.stp', icon: 'step' },
  { ext: '.iges', labelKey: 'settingsPages.serialization.extensionLabels.iges', icon: 'step' },
  { ext: '.igs', labelKey: 'settingsPages.serialization.extensionLabels.igs', icon: 'step' },
  { ext: '.prt', labelKey: 'settingsPages.serialization.extensionLabels.creoNxPart', icon: 'part' },
  { ext: '.asm', labelKey: 'settingsPages.serialization.extensionLabels.creoAssembly', icon: 'assembly' },
  { ext: '.ipt', labelKey: 'settingsPages.serialization.extensionLabels.inventorPart', icon: 'part' },
  { ext: '.iam', labelKey: 'settingsPages.serialization.extensionLabels.inventorAssembly', icon: 'assembly' },
  { ext: '.catpart', labelKey: 'settingsPages.serialization.extensionLabels.catiaPart', icon: 'part' },
  { ext: '.catproduct', labelKey: 'settingsPages.serialization.extensionLabels.catiaAssembly', icon: 'assembly' },
]

export function SerializationSettingsPresentation({
  bindings,
}: {
  bindings: SerializationSettingsBindings
}) {
  const {
    organization,
    loading,
    isAdmin,
    settings,
    livePreview,
    loadingPreview,
    fetchPreview,
    previewNumber,
    updateSetting,
    detecting,
    handleDetectHighest,
    detectedResult,
    applyDetectedCounter,
    basePreview,
    newKeepout,
    setNewKeepout,
    showKeepoutForm,
    setShowKeepoutForm,
    addKeepoutZone,
    removeKeepoutZone,
    customExtension,
    setCustomExtension,
    toggleExtension,
    addCustomExtension,
    t,
    saving,
    handleSave,
  } = bindings

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

  const locked = !isAdmin || !settings.enabled
  const dimmed = !settings.enabled ? 'opacity-50' : ''

  return (
    <SettingsPage>
      <SettingsSection
        title={t('settingsPages.serialization.title')}
        description={
          isAdmin
            ? t('settingsPages.serialization.description')
            : t('settingsPages.serialization.readOnly')
        }
      >
        <SettingsGroup>
          <SettingRow
            label={t('settingsPages.serialization.nextPreview')}
            description={
              previewNumber ? (
                <>
                  {t('settingsPages.serialization.serverPreview')} <span className="font-mono">{previewNumber}</span>
                </>
              ) : undefined
            }
          >
            <span className="font-mono text-[14px] font-medium text-ui-fg">{livePreview}</span>
            <button
              type="button"
              onClick={fetchPreview}
              disabled={loadingPreview}
              className={`${BUTTON.base} ${BUTTON.ghost} !px-1.5`}
              title={t('settingsPages.serialization.fetchPreview')}
              aria-label={t('settingsPages.serialization.fetchPreview')}
            >
              {loadingPreview ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <RefreshCw size={14} />
              )}
            </button>
          </SettingRow>
          <SettingRow
            label={t('settingsPages.serialization.enable')}
            description={t('settingsPages.serialization.enableHelp')}
          >
            <Switch
              checked={settings.enabled}
              onChange={() => isAdmin && updateSetting('enabled', !settings.enabled)}
              disabled={!isAdmin}
              aria-label={t('settingsPages.serialization.enable')}
            />
          </SettingRow>
        </SettingsGroup>
      </SettingsSection>

      <SettingsSection
        title={t('settingsPages.serialization.fileTypes')}
        description={t('settingsPages.serialization.fileTypesHelp')}
      >
        <SettingsGroup className={dimmed}>
          <div className="grid grid-cols-3 gap-2 py-4">
            {COMMON_EXTENSIONS.map(({ ext, labelKey }) => {
              const isSelected = (settings.auto_apply_extensions || []).includes(ext)
              return (
                <button
                  type="button"
                  key={ext}
                  onClick={() => isAdmin && settings.enabled && toggleExtension(ext)}
                  disabled={locked}
                  aria-pressed={isSelected}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors ${
                    isSelected
                      ? 'border-ui-selected-border bg-ui-selected'
                      : 'border-ui-field-border bg-ui-field hover:bg-ui-hover'
                  } ${locked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] text-ui-fg">{ext}</div>
                    <div className="truncate text-[13px] text-ui-fg-secondary">{t(labelKey)}</div>
                  </div>
                  {isSelected && <Check size={14} className="flex-shrink-0 text-ui-fg" />}
                </button>
              )
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2 py-3.5">
            <span className="text-[14px] text-ui-fg">{t('settingsPages.serialization.custom')}</span>
            <input
              type="text"
              value={customExtension}
              onChange={(e) => setCustomExtension(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addCustomExtension()}
              placeholder=".xyz"
              disabled={locked}
              className={`${INPUT} !w-24 font-mono`}
            />
            <button
              type="button"
              onClick={addCustomExtension}
              disabled={locked || !customExtension.trim()}
              className={`${BUTTON.base} ${BUTTON.secondary}`}
            >
              {t('settingsPages.serialization.add')}
            </button>
            <div className="ml-2 flex flex-1 flex-wrap gap-1">
              {(settings.auto_apply_extensions || [])
                .filter((ext) => !COMMON_EXTENSIONS.some((c) => c.ext === ext))
                .map((ext) => (
                  <span
                    key={ext}
                    className="inline-flex items-center gap-1 rounded-md bg-ui-field px-2 py-0.5 text-[13px] text-ui-fg"
                  >
                    {ext}
                    {isAdmin && settings.enabled && (
                      <button
                        type="button"
                        onClick={() => toggleExtension(ext)}
                        className="text-ui-fg-secondary hover:text-ui-danger"
                        aria-label={t('settingsPages.serialization.removeExtension', {
                          extension: ext,
                        })}
                      >
                        <X size={12} />
                      </button>
                    )}
                  </span>
                ))}
            </div>
          </div>

          {(settings.auto_apply_extensions || []).length > 0 && (
            <div className="py-3.5 text-[14px] text-ui-fg-secondary">
              {t('settingsPages.serialization.enabledFor')}{' '}
              <span className="text-ui-fg">
                {(settings.auto_apply_extensions || []).join(', ')}
              </span>
            </div>
          )}
          {(settings.auto_apply_extensions || []).length === 0 && settings.enabled && (
            <div className="flex items-center gap-1.5 py-3.5 text-[14px] text-ui-warning">
              <AlertTriangle size={14} />
              {t('settingsPages.serialization.noFileTypes')}
            </div>
          )}
        </SettingsGroup>
      </SettingsSection>

      <SettingsSection title={t('settingsPages.serialization.numberFormat')}>
        <SettingsGroup className={dimmed}>
          <SettingRow label={t('settingsPages.serialization.prefix')} htmlFor="serial-prefix" description={t('settingsPages.serialization.prefixHelp')}>
            <input
              id="serial-prefix"
              type="text"
              value={settings.prefix}
              onChange={(e) => updateSetting('prefix', e.target.value)}
              placeholder="PN-"
              disabled={locked}
              className={`${INPUT} !w-40 font-mono`}
            />
          </SettingRow>
          <SettingRow label={t('settingsPages.serialization.suffix')} htmlFor="serial-suffix" description={t('settingsPages.serialization.suffixHelp')}>
            <input
              id="serial-suffix"
              type="text"
              value={settings.suffix}
              onChange={(e) => updateSetting('suffix', e.target.value)}
              placeholder="-A"
              disabled={locked}
              className={`${INPUT} !w-40 font-mono`}
            />
          </SettingRow>
          <SettingRow
            label={t('settingsPages.serialization.letterPrefix')}
            htmlFor="serial-letter-prefix"
            description={t('settingsPages.serialization.letterPrefixHelp')}
          >
            <input
              id="serial-letter-prefix"
              type="text"
              value={settings.letter_prefix}
              onChange={(e) => updateSetting('letter_prefix', e.target.value.toUpperCase())}
              placeholder="AB"
              maxLength={4}
              disabled={locked}
              className={`${INPUT} !w-40 font-mono uppercase`}
            />
          </SettingRow>
          <SettingRow
            label={t('settingsPages.serialization.numberPadding')}
            htmlFor="serial-padding"
            description={t('settingsPages.serialization.numberPaddingHelp')}
          >
            <Select
              id="serial-padding"
              value={settings.padding_digits}
              onChange={(e) => updateSetting('padding_digits', parseInt(e.target.value))}
              disabled={locked}
              className="w-40"
            >
              {[3, 4, 5, 6, 7, 8].map((digits) => (
                <option key={digits} value={digits}>
                  {t('settingsPages.serialization.digitsOption', {
                    digits,
                    sample: String(1).padStart(digits, '0'),
                  })}
                </option>
              ))}
            </Select>
          </SettingRow>
          <SettingRow
            label={t('settingsPages.serialization.currentCounter')}
            htmlFor="serial-counter"
            description={
              <>
                The next number generated will be this value + 1. Next number will be:{' '}
                <span className="font-mono font-medium text-ui-fg">
                  {settings.current_counter + 1}
                </span>
              </>
            }
          >
            <input
              id="serial-counter"
              type="number"
              value={settings.current_counter}
              onChange={(e) =>
                updateSetting('current_counter', Math.max(0, parseInt(e.target.value) || 0))
              }
              min="0"
              disabled={locked}
              className={`${INPUT} !w-32 font-mono`}
            />
          </SettingRow>
          {isAdmin && (
            <div className="flex items-center gap-1.5 py-3.5 text-[14px] text-ui-warning">
              <AlertTriangle size={14} />
              {t('settingsPages.serialization.counterWarning')}
            </div>
          )}

          {isAdmin && settings.enabled && (
            <SettingRow
              label={t('settingsPages.serialization.detectHighest')}
              description={t('settingsPages.serialization.detectHighestHelp')}
            >
              <button
                type="button"
                onClick={handleDetectHighest}
                disabled={detecting}
                className={`${BUTTON.base} ${BUTTON.secondary}`}
              >
                {detecting ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
                {t('settingsPages.serialization.scanVault')}
              </button>
            </SettingRow>
          )}
          {isAdmin && settings.enabled && detectedResult && (
            <div className="py-3.5">
              <div className="text-[14px] text-ui-fg-secondary">
                {t('settingsPages.serialization.scannedFiles', {
                  count: detectedResult.totalScanned,
                })}
              </div>
              {detectedResult.skippedHidden > 0 && (
                <div className="mt-1 flex items-center gap-1 text-[13px] text-ui-fg-secondary">
                  <EyeOff size={11} />
                  {t('hiddenFolders.scanSkipped', { count: detectedResult.skippedHidden })}
                </div>
              )}
              {detectedResult.highestCounter > 0 ? (
                <div className="mt-2 flex items-center justify-between">
                  <div>
                    <div className="text-[14px] text-ui-fg">
                      {t('settingsPages.serialization.highestFound')}{' '}
                      <span className="font-mono font-medium text-ui-fg">
                        {detectedResult.highestPartNumber}
                      </span>
                    </div>
                    <div className="text-[13px] text-ui-fg-secondary">
                      {t('settingsPages.serialization.counterValue', {
                        counter: detectedResult.highestCounter,
                      })}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={applyDetectedCounter}
                    className={`${BUTTON.base} ${BUTTON.primary}`}
                  >
                    {t('settingsPages.serialization.apply')}
                  </button>
                </div>
              ) : (
                <div className="mt-1 text-[14px] text-ui-fg-secondary">
                  {t('settingsPages.serialization.noMatches')}
                </div>
              )}
            </div>
          )}
        </SettingsGroup>
      </SettingsSection>

      <SettingsSection
        title={t('settingsPages.serialization.tabNumbers')}
        description={t('settingsPages.serialization.tabNumbersHelp')}
        actions={
          <Switch
            checked={settings.tab_enabled}
            onChange={() =>
              isAdmin && settings.enabled && updateSetting('tab_enabled', !settings.tab_enabled)
            }
            disabled={locked}
            aria-label={t('settingsPages.serialization.tabNumbers')}
          />
        }
      >
        {settings.tab_enabled && (
          <SettingsGroup className={dimmed}>
            <SettingRow
              label={t('settingsPages.serialization.tabSeparator')}
              htmlFor="serial-tab-separator"
              description={t('settingsPages.serialization.tabSeparatorHelp')}
            >
              <input
                id="serial-tab-separator"
                type="text"
                value={settings.tab_separator}
                onChange={(e) => updateSetting('tab_separator', e.target.value)}
                placeholder="-"
                maxLength={3}
                disabled={locked}
                className={`${INPUT} !w-24 font-mono`}
              />
            </SettingRow>
            <SettingRow
              label={t('settingsPages.serialization.tabDigits')}
              htmlFor="serial-tab-digits"
              description={t('settingsPages.serialization.tabDigitsHelp')}
            >
              <Select
                id="serial-tab-digits"
                value={settings.tab_padding_digits}
                onChange={(e) => updateSetting('tab_padding_digits', parseInt(e.target.value))}
                disabled={locked}
                className="w-40"
              >
                {[1, 2, 3, 4].map((digits) => {
                  const rangeEnd = 10 ** digits - 1
                  return (
                    <option key={digits} value={digits}>
                      {t(
                        digits === 1
                          ? 'settingsPages.serialization.tabDigitsOptionOne'
                          : 'settingsPages.serialization.tabDigitsOption',
                        { digits, first: 1, last: rangeEnd },
                      )}
                    </option>
                  )
                })}
              </Select>
            </SettingRow>
            <SettingRow
              label={t('settingsPages.serialization.autoPad')}
              description={t('settingsPages.serialization.autoPadHelp')}
            >
              <Switch
                checked={settings.auto_pad_numbers}
                onChange={(checked) => updateSetting('auto_pad_numbers', checked)}
                disabled={locked}
                aria-label={t('settingsPages.serialization.autoPad')}
              />
            </SettingRow>
            <SettingRow
              label={t('settingsPages.serialization.tabRequired')}
              description={
                settings.tab_required
                  ? t('settingsPages.serialization.tabRequiredHelp')
                  : t('settingsPages.serialization.tabOptionalHelp')
              }
            >
              <Switch
                checked={settings.tab_required}
                onChange={(checked) => updateSetting('tab_required', checked)}
                disabled={locked}
                aria-label={t('settingsPages.serialization.tabRequired')}
              />
            </SettingRow>
            <div className="space-y-3 py-4">
              <div>
                <div className="mb-1.5 text-[14px] text-ui-fg-secondary">{t('settingsPages.serialization.exampleWithTab')}</div>
                <div className="flex flex-wrap items-center gap-2">
                  {['1', '2', '3'].map((tab, index) => (
                    <span key={tab} className="flex items-center gap-2">
                      {index > 0 && <span className="text-[13px] text-ui-fg-secondary">→</span>}
                      <code className={CODE}>
                        {basePreview}
                        {settings.tab_separator}
                        {tab.padStart(settings.tab_padding_digits, '0')}
                        {settings.suffix}
                      </code>
                    </span>
                  ))}
                </div>
              </div>
              {!settings.tab_required && (
                <div>
                  <div className="mb-1.5 text-[14px] text-ui-fg-secondary">{t('settingsPages.serialization.baseOnly')}</div>
                  <code className={CODE}>
                    {basePreview}
                    {settings.suffix}
                  </code>
                </div>
              )}
            </div>
          </SettingsGroup>
        )}
      </SettingsSection>

      {settings.tab_enabled && (
        <SettingsSection title={t('settingsPages.serialization.allowedCharacters')}>
          <SettingsGroup className={dimmed}>
            <SettingRow label={t('settingsPages.serialization.allowNumbers')}>
              <Switch
                checked={settings.tab_allow_numbers}
                onChange={(checked) => updateSetting('tab_allow_numbers', checked)}
                disabled={locked}
                aria-label={t('settingsPages.serialization.allowNumbers')}
              />
            </SettingRow>
            <SettingRow label={t('settingsPages.serialization.allowLetters')}>
              <Switch
                checked={settings.tab_allow_letters}
                onChange={(checked) => updateSetting('tab_allow_letters', checked)}
                disabled={locked}
                aria-label={t('settingsPages.serialization.allowLetters')}
              />
            </SettingRow>
            <SettingRow label={t('settingsPages.serialization.allowSpecial')}>
              <Switch
                checked={settings.tab_allow_special}
                onChange={(checked) => updateSetting('tab_allow_special', checked)}
                disabled={locked}
                aria-label={t('settingsPages.serialization.allowSpecial')}
              />
            </SettingRow>
            {settings.tab_allow_special && (
              <SettingRow label={t('settingsPages.serialization.allowedSpecial')} htmlFor="serial-tab-special">
                <input
                  id="serial-tab-special"
                  type="text"
                  value={settings.tab_special_chars}
                  onChange={(e) => updateSetting('tab_special_chars', e.target.value)}
                  placeholder="-_"
                  maxLength={10}
                  disabled={locked}
                  className={`${INPUT} !w-32 font-mono`}
                />
              </SettingRow>
            )}
            {!settings.tab_allow_numbers &&
              !settings.tab_allow_letters &&
              !settings.tab_allow_special && (
                <div className="flex items-center gap-1.5 py-3.5 text-[14px] text-ui-warning">
                  <AlertTriangle size={14} />
                  {t('settingsPages.serialization.noCharacters')}
                </div>
              )}
          </SettingsGroup>
        </SettingsSection>
      )}

      <SettingsSection
        title={t('settingsPages.serialization.keepoutZones')}
        description={t('settingsPages.serialization.keepoutZonesHelp')}
        actions={
          isAdmin &&
          settings.enabled && (
            <Button size="sm" icon={<Plus size={14} />} onClick={() => setShowKeepoutForm(true)}>
              {t('settingsPages.serialization.addZone')}
            </Button>
          )
        }
      >
        <SettingsGroup className={dimmed}>
          {showKeepoutForm && (
            <div className="grid grid-cols-4 gap-3 py-4">
              <div>
                <label className="mb-1 block text-[13px] text-ui-fg-secondary">{t('settingsPages.serialization.start')}</label>
                <input
                  type="number"
                  value={newKeepout.start}
                  onChange={(e) => setNewKeepout((prev) => ({ ...prev, start: e.target.value }))}
                  placeholder="1000"
                  min="0"
                  className={`${INPUT} font-mono`}
                />
              </div>
              <div>
                <label className="mb-1 block text-[13px] text-ui-fg-secondary">{t('settingsPages.serialization.end')}</label>
                <input
                  type="number"
                  value={newKeepout.end}
                  onChange={(e) => setNewKeepout((prev) => ({ ...prev, end: e.target.value }))}
                  placeholder="1999"
                  min="0"
                  className={`${INPUT} font-mono`}
                />
              </div>
              <div className="col-span-2">
                <label className="mb-1 block text-[13px] text-ui-fg-secondary">{t('settingsPages.serialization.zoneDescription')}</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newKeepout.description}
                    onChange={(e) =>
                      setNewKeepout((prev) => ({ ...prev, description: e.target.value }))
                    }
                    placeholder={t('settingsPages.serialization.zonePlaceholder')}
                    className={`${INPUT} flex-1`}
                  />
                  <button
                    type="button"
                    onClick={addKeepoutZone}
                    className={`${BUTTON.base} ${BUTTON.primary}`}
                  >
                    {t('settingsPages.serialization.add')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowKeepoutForm(false)
                      setNewKeepout({ start: '', end: '', description: '' })
                    }}
                    className={`${BUTTON.base} ${BUTTON.ghost} !px-1.5`}
                    aria-label={t('settingsPages.metadata.cancel')}
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            </div>
          )}

          {settings.keepout_zones.length === 0 ? (
            <div className="py-4 text-[14px] text-ui-fg-secondary">
              {t('settingsPages.serialization.noKeepoutZones')}
            </div>
          ) : (
            settings.keepout_zones.map((zone, index) => (
              <div key={index} className="flex items-center justify-between gap-4 py-3">
                <div className="flex min-w-0 items-center gap-4">
                  <div className="text-[14px] text-ui-fg">
                    <span>{zone.start.toLocaleString()}</span>
                    <span className="mx-2 text-ui-fg-secondary">→</span>
                    <span>{zone.end_num.toLocaleString()}</span>
                  </div>
                  <span className="truncate text-[14px] text-ui-fg-secondary">
                    {zone.description}
                  </span>
                  <span className="text-[13px] text-ui-fg-secondary">
                    ({(zone.end_num - zone.start + 1).toLocaleString()} numbers)
                  </span>
                </div>
                {isAdmin && settings.enabled && (
                  <button
                    type="button"
                    onClick={() => removeKeepoutZone(index)}
                    className={`${BUTTON.base} ${BUTTON.ghost} !px-1.5 hover:!text-ui-danger`}
                    title={t('settingsPages.serialization.removeZone')}
                    aria-label={t('settingsPages.serialization.removeZone')}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            ))
          )}
        </SettingsGroup>
      </SettingsSection>

      <SettingsSection title={t('settingsPages.serialization.examplePatterns')}>
        <SettingsGroup>
          <div className="grid grid-cols-2 gap-3 py-4 text-[14px]">
            {EXAMPLE_PATTERNS.map(({ code, noteKey }) => (
              <div key={code} className="flex items-center gap-2">
                <code className={CODE}>{code}</code>
                <span className="text-ui-fg-secondary">{t(noteKey)}</span>
              </div>
            ))}
          </div>
        </SettingsGroup>
      </SettingsSection>

      {isAdmin && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className={`${BUTTON.base} ${BUTTON.primary} !h-8 !px-3.5 !text-[14px]`}
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {t('settingsPages.saveSettings')}
          </button>
        </div>
      )}
    </SettingsPage>
  )
}
