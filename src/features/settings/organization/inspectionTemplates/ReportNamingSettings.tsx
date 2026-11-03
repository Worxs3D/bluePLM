/**
 * Settings > Inspection templates > Report naming: the organization's report number pattern
 * (`organization.settings.inspection_reports`), where `{n}` counts, and whether reports carry the
 * organization logo. Administrators change it; everyone else sees it read-only. The preview fills
 * the pattern with sample values as it is typed.
 */
import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, ImageOff, RotateCcw } from 'lucide-react'

import { Button, Callout, SegmentedControl, Switch, TextInput } from '@/components/core/ui'
import {
  DEFAULT_REPORT_NUMBER_PATTERN,
  MAX_PATTERN_LENGTH,
  REPORT_NUMBER_TOKENS,
  formatReportNumber,
  patternHasSequence,
  reportDate,
  reportNamingFromSettings,
  unknownPatternTokens,
  type ReportSequenceScope,
} from '@/features/integrations/solidworks/inspection/reports/reportModel'
import { t } from '@/lib/i18n'
import { log } from '@/lib/logger'
import { supabase } from '@/lib/supabase'
import { usePDMStore } from '@/stores/pdmStore'
import type { InspectionReportOrgSettings, OrgSettings } from '@/types/pdm'

import { SettingRow, SettingsGroup, SettingsSection } from '../../components/ui'

/**
 * The worked example the preview fills in: the third report of a drawing at revision B, version 5,
 * then what the next report is called once the drawing moves to revision C (version 6), which is
 * where the two counting scopes differ.
 */
const SAMPLE = { partNumber: 'BR-103849-201', drawing: 'BR-103849-201' } as const
const SAMPLE_NOW = { rev: 'B', version: '5', n: 3 } as const
const SAMPLE_NEXT_REV = { rev: 'C', version: '6' } as const

/** A signed URL for the organization logo, as the menu bar shows it (null without one). */
function useOrgLogoUrl(path: string | null | undefined, fallback: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    if (!path) {
      setUrl(fallback || null)
      return
    }
    void supabase.storage
      .from('vault')
      .createSignedUrl(path, 60 * 60)
      .then(({ data }) => {
        if (!cancelled) setUrl(data?.signedUrl ?? fallback ?? null)
      })
      .catch(() => {
        if (!cancelled) setUrl(fallback || null)
      })
    return () => {
      cancelled = true
    }
  }, [path, fallback])
  return url
}

export function ReportNamingSettings() {
  const organization = usePDMStore((s) => s.organization)
  const setOrganization = usePDMStore((s) => s.setOrganization)
  const addToast = usePDMStore((s) => s.addToast)
  const getEffectiveRole = usePDMStore((s) => s.getEffectiveRole)
  const isAdmin = getEffectiveRole() === 'admin'

  const naming = reportNamingFromSettings(organization?.settings?.inspection_reports)
  const [draft, setDraft] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const pattern = draft ?? naming.numberPattern
  const dirty = draft !== null && draft.trim() !== naming.numberPattern
  const disabled = !isAdmin || saving

  const openSettings = usePDMStore((s) => s.openSettings)
  const logoUrl = useOrgLogoUrl(organization?.logo_storage_path, organization?.logo_url)
  const [logoFailed, setLogoFailed] = useState(false)
  const date = reportDate(new Date())
  const preview = useMemo(
    () =>
      `${formatReportNumber(pattern, { ...SAMPLE, date, rev: SAMPLE_NOW.rev, version: SAMPLE_NOW.version, n: String(SAMPLE_NOW.n) })}.xlsx`,
    [pattern, date],
  )
  // The next report after a revision change: the count goes on (per drawing) or restarts (per revision).
  const nextPreview = useMemo(
    () =>
      `${formatReportNumber(pattern, {
        ...SAMPLE,
        date,
        ...SAMPLE_NEXT_REV,
        n: String(naming.sequenceScope === 'revision' ? 1 : SAMPLE_NOW.n + 1),
      })}.xlsx`,
    [pattern, date, naming.sequenceScope],
  )
  const unknown = useMemo(() => unknownPatternTokens(pattern), [pattern])

  const save = async (patch: InspectionReportOrgSettings) => {
    if (!organization) return
    setSaving(true)
    try {
      // Read the current settings first so a concurrent change to another key is not overwritten.
      const { data: current } = await supabase
        .from('organization')
        .select('settings')
        .eq('id', organization.id)
        .single()
      const base = (current?.settings ?? organization.settings ?? {}) as OrgSettings
      const settings: OrgSettings = { ...base, inspection_reports: { ...base.inspection_reports, ...patch } }
      const { data, error } = await supabase
        .from('organization')
        .update({ settings: settings as never })
        .eq('id', organization.id)
        .select('settings')
        .single()
      if (error) throw error
      if (!data) throw new Error(t('source.inspection.rnNoPermission'))
      setOrganization({ ...organization, settings })
      setDraft(null)
      addToast('success', t('source.inspection.rnSaved'))
    } catch (error) {
      log.error('[InspectionTemplates]', 'Saving the report naming failed', { error })
      addToast('error', t('source.inspection.rnSaveFailed', { error: error instanceof Error ? error.message : String(error) }))
    } finally {
      setSaving(false)
    }
  }

  const insertToken = (token: string) => setDraft(`${pattern}{${token}}`.slice(0, MAX_PATTERN_LENGTH))

  const scopeOptions: { value: ReportSequenceScope; label: string }[] = [
    { value: 'drawing', label: t('source.inspection.rnScope_drawing') },
    { value: 'revision', label: t('source.inspection.rnScope_revision') },
  ]

  return (
    <SettingsSection
      title={t('source.inspection.rnTitle')}
      description={
        isAdmin ? t('source.inspection.rnIntro') : `${t('source.inspection.rnIntro')} ${t('source.inspection.tplAdminOnly')}`
      }
    >
      <SettingsGroup>
        <SettingRow label={t('source.inspection.rnPattern')} description={t('source.inspection.rnPatternHint')} stacked>
          <div className="flex w-full flex-col gap-2">
            <div className="flex items-center gap-2">
              <TextInput
                value={pattern}
                onChange={(e) => setDraft(e.target.value.slice(0, MAX_PATTERN_LENGTH))}
                disabled={disabled}
                spellCheck={false}
                aria-label={t('source.inspection.rnPattern')}
                className="flex-1 font-mono"
              />
              <Button
                variant="ghost"
                size="sm"
                icon={<RotateCcw size={14} />}
                onClick={() => setDraft(DEFAULT_REPORT_NUMBER_PATTERN)}
                disabled={disabled || pattern === DEFAULT_REPORT_NUMBER_PATTERN}
                title={t('source.inspection.rnResetDefault')}
                aria-label={t('source.inspection.rnResetDefault')}
              />
              <Button
                variant="primary"
                size="sm"
                onClick={() => void save({ number_pattern: pattern.trim() || DEFAULT_REPORT_NUMBER_PATTERN })}
                disabled={disabled || !dirty}
                loading={saving && dirty}
                title={dirty ? undefined : t('source.inspection.rnNoChanges')}
              >
                {t('common.save')}
              </Button>
            </div>
            {isAdmin && (
              <div className="flex flex-wrap gap-1">
                {REPORT_NUMBER_TOKENS.map((token) => (
                  <button
                    key={token}
                    type="button"
                    className="rounded-md border border-ui-field-border bg-ui-field px-1.5 py-0.5 font-mono text-[12px] text-ui-fg-secondary transition-colors hover:border-ui-accent/50 hover:bg-ui-accent/10 hover:text-ui-fg disabled:opacity-50"
                    onClick={() => insertToken(token)}
                    disabled={disabled}
                    title={t(`source.inspection.rnTok_${token}`)}
                  >
                    {`{${token}}`}
                  </button>
                ))}
              </div>
            )}
            <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 rounded-lg border border-ui-border bg-ui-field/50 px-3 py-2.5 text-[12px]">
              <span className="text-ui-fg-secondary">
                {t('source.inspection.rnExampleNow', { rev: SAMPLE_NOW.rev, version: SAMPLE_NOW.version, n: SAMPLE_NOW.n })}
              </span>
              <span className="truncate font-mono text-[13px] text-ui-fg" title={preview}>
                {preview}
              </span>
              <span className="flex items-center gap-1 text-ui-fg-secondary">
                <ArrowRight size={12} />
                {t('source.inspection.rnExampleNext', { rev: SAMPLE_NEXT_REV.rev })}
              </span>
              <span className="truncate font-mono text-[13px] text-ui-fg" title={nextPreview}>
                {nextPreview}
              </span>
            </div>
            {!patternHasSequence(pattern) && <Callout tone="warning">{t('source.inspection.rnNoSequence')}</Callout>}
            {unknown.length > 0 && (
              <Callout tone="warning">{t('source.inspection.rnUnknownTokens', { tokens: unknown.join(', ') })}</Callout>
            )}
          </div>
        </SettingRow>
        <SettingRow label={t('source.inspection.rnScope')} description={t('source.inspection.rnScopeHint')}>
          <SegmentedControl
            value={naming.sequenceScope}
            options={scopeOptions.map((o) => ({ ...o, disabled }))}
            onChange={(value) => void save({ sequence_scope: value })}
            size="sm"
            aria-label={t('source.inspection.rnScope')}
          />
        </SettingRow>
        <SettingRow
          label={t('source.inspection.rnLogo')}
          description={
            organization?.logo_storage_path ? t('source.inspection.rnLogoHint') : t('source.inspection.rnLogoNone')
          }
        >
          <div className="flex items-center gap-3">
            {/* The logo on white, as a printed report shows it. */}
            {logoUrl && !logoFailed ? (
              <div
                className={`flex h-10 w-28 items-center justify-center rounded-md border border-ui-border bg-white p-1.5 ${naming.includeLogo ? '' : 'opacity-40'}`}
                title={t('source.inspection.rnLogoPreview')}
              >
                <img
                  src={logoUrl}
                  alt={t('source.inspection.rnLogoPreview')}
                  className="max-h-full max-w-full object-contain"
                  onError={() => setLogoFailed(true)}
                />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => openSettings('company-profile')}
                className="flex h-10 items-center gap-1.5 rounded-md border border-dashed border-ui-field-border px-2.5 text-[12px] text-ui-fg-secondary hover:border-ui-accent/50 hover:text-ui-fg"
              >
                <ImageOff size={13} />
                {t('source.inspection.rnLogoAdd')}
              </button>
            )}
            <Switch
              checked={naming.includeLogo}
              onChange={(value) => void save({ include_logo: value })}
              disabled={disabled}
              aria-label={t('source.inspection.rnLogo')}
            />
          </div>
        </SettingRow>
      </SettingsGroup>
    </SettingsSection>
  )
}
