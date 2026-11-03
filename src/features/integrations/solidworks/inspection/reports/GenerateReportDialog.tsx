import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { FileSpreadsheet } from 'lucide-react'

import { Dialog } from '@/components/core/Dialog'
import { Button, Callout, SegmentedControl, Select, TextInput } from '@/components/core/ui'
import { t } from '@/lib/i18n'
import { builtInTemplateNames } from '@/lib/inspection/issueText'
import { changedCharacteristics } from '@/lib/inspection/reportTypes'
import { log } from '@/lib/logger'
import { hasDesktop } from '@/lib/platform'
import {
  FAI_REASONS,
  INSPECTION_REPORT_TYPES,
  type FaiScope,
  type InspectionReport,
  type InspectionReportType,
  type InspectionTemplate,
} from '@/types/inspectionReports'

import { CharacteristicPicker } from './CharacteristicPicker'
import {
  baselineOptions,
  canChooseCharacteristics,
  defaultBaselineId,
  dialogRequest,
  includedIds,
  initialDialogState,
  toggleCharacteristic,
  withType,
  withVersionChanged,
  type CharacteristicMode,
  type DialogRows,
  type GenerateDialogState,
} from './generateDialogModel'
import { rowsAtVersion, type GeneratePhase } from './reportActions'
import {
  choiceServes,
  defaultTemplateChoice,
  templateChoiceId,
  templateChoices,
  type ReportNaming,
  type TemplateChoice,
  type VersionInfo,
} from './reportModel'
import { defaultTypeRequest, faiReasonKey, isLotType, reportTypeKey, type ReportTypeRequest } from './reportTypeModel'

interface GenerateReportDialogProps {
  fileId: string
  reports: readonly InspectionReport[]
  templates: readonly InspectionTemplate[]
  versions: readonly VersionInfo[]
  naming: ReportNaming
  /** Open on this type instead of the one Generate would make. */
  initialType?: InspectionReportType | null
  busyPhase: GeneratePhase | null
  onGenerate: (template: TemplateChoice, version: VersionInfo, type: ReportTypeRequest) => void
  onClose: () => void
}

function Field({ label, error, children, className = '' }: { label: string; error?: string; children: ReactNode; className?: string }) {
  return (
    <label className={`flex min-w-0 flex-col gap-1 ${className}`}>
      <span className="text-[12px] text-ui-fg-secondary">{label}</span>
      {children}
      {error && <span className="text-[11px] text-ui-danger">{t(error)}</span>}
    </label>
  )
}

function versionLabel(v: VersionInfo): string {
  return v.revision
    ? t('source.inspection.rptVersionOptionRev', { version: v.version, revision: v.revision })
    : t('source.inspection.rptVersionOption', { version: v.version })
}

/**
 * "Generate with options...": the report type (first article, production, receiving,
 * re-inspection) with its fields, the checked-in version, a template that serves the type, and the
 * characteristics the report includes. Starts from what Generate would make without asking.
 */
export function GenerateReportDialog({
  fileId,
  reports,
  templates,
  versions,
  naming,
  initialType = null,
  busyPhase,
  onGenerate,
  onClose,
}: GenerateReportDialogProps) {
  const choices = useMemo(() => templateChoices(templates, builtInTemplateNames()), [templates])
  const [versionId, setVersionId] = useState(() => versions[0]?.id ?? '')
  const version = versions.find((v) => v.id === versionId) ?? versions[0] ?? null
  const [state, setState] = useState<GenerateDialogState | null>(null)
  const [templateId, setTemplateId] = useState<string | null>(null)
  const [data, setData] = useState<DialogRows | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [attempted, setAttempted] = useState(false)

  // Start from the default request once the version is known (opened before the lists loaded:
  // the defaults apply once they arrive).
  useEffect(() => {
    if (!version || state) return
    const start = initialDialogState(defaultTypeRequest([...reports], versions, version, naming), naming)
    setState(
      initialType && initialType !== start.type
        ? withType(start, initialType, defaultBaselineId(reports, versions, version))
        : start,
    )
  }, [version, state, reports, versions, naming, initialType])

  const type = state?.type ?? 'fai'
  const baselineChoices = useMemo(
    () => (version ? baselineOptions(reports, versions, version) : []),
    [reports, versions, version],
  )
  const baselineId =
    state?.baselineId && baselineChoices.some((b) => b.version.id === state.baselineId)
      ? state.baselineId
      : version
        ? defaultBaselineId(reports, versions, version)
        : null
  const partial = type === 'fai' && state?.faiScope === 'partial'

  // The version's characteristics, and for a partial FAI the baseline's, to show what is included.
  useEffect(() => {
    if (!version) return
    let cancelled = false
    setData(null)
    setLoadError(null)
    void (async () => {
      try {
        const target = await rowsAtVersion(fileId, version.id)
        const before = partial && baselineId ? await rowsAtVersion(fileId, baselineId) : null
        if (cancelled) return
        setData({
          rows: target.rows,
          changedIds: partial ? changedCharacteristics(before?.rows ?? [], target.rows) : [],
        })
      } catch (err) {
        log.warn('[InspectionReports]', 'Characteristics for the options dialog failed', {
          error: err instanceof Error ? err.message : String(err),
        })
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [fileId, version, partial, baselineId])

  const serving = choices.filter((c) => choiceServes(c, type))
  const others = choices.filter((c) => !choiceServes(c, type))
  const preferred = defaultTemplateChoice(choices, type)
  const choice = choices.find((c) => templateChoiceId(c) === templateId) ?? preferred
  const busy = busyPhase !== null
  const effective = useMemo(() => (state ? { ...state, baselineId } : null), [state, baselineId])
  const { request, errors } = effective
    ? dialogRequest(effective, versions, data)
    : { request: null, errors: {} as Record<string, string> }
  const ticked = useMemo(() => new Set(effective && data ? includedIds(effective, data) : []), [effective, data])

  const update = (patch: Partial<GenerateDialogState>) => setState((s) => (s ? { ...s, ...patch } : s))

  const typeOptions = INSPECTION_REPORT_TYPES.map((value) => ({
    value,
    label: t(`source.inspection.rptTypeShort_${value}`),
    title: t(`source.inspection.rptTypeHint_${value}`),
    disabled: busy,
  }))
  const charModes: { value: CharacteristicMode; label: string }[] = [
    { value: 'classified', label: t('source.inspection.rptCharMode_classified') },
    { value: 'all', label: t('source.inspection.rptCharMode_all') },
    { value: 'chosen', label: t('source.inspection.rptCharMode_chosen') },
  ]

  const templateOption = (c: TemplateChoice) => (
    <option key={templateChoiceId(c)} value={templateChoiceId(c)}>
      {c.kind === 'org' && c.template.isDefault
        ? t('source.inspection.rptTemplateDefaultOption', { name: c.template.name })
        : c.kind === 'org'
          ? c.template.name
          : c.name}
    </option>
  )

  return (
    <Dialog open onClose={busy ? () => undefined : onClose} title={t('source.inspection.rptGenerateTitle')} className="!max-w-2xl">
      <div className="max-h-[72vh] overflow-y-auto overflow-x-hidden pr-1 text-sm">
      <div className="flex flex-col gap-4">
        {state && (
          <>
            <div className="flex flex-col gap-1.5">
              <span className="text-[12px] text-ui-fg-secondary">{t('source.inspection.rptTypeLabel')}</span>
              <SegmentedControl<InspectionReportType>
                value={type}
                options={typeOptions}
                onChange={(value) =>
                  setState((s) => (s ? withType(s, value, version ? defaultBaselineId(reports, versions, version) : null) : s))
                }
                aria-label={t('source.inspection.rptTypeLabel')}
              />
              <span className="text-[12px] text-ui-fg-tertiary">{t(`source.inspection.rptTypeHint_${type}`)}</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label={t('source.inspection.rptVersion')}>
                <Select
                  value={version?.id ?? ''}
                  onChange={(e) => {
                    setVersionId(e.target.value)
                    setState((s) => (s ? withVersionChanged(s) : s))
                  }}
                  disabled={busy || versions.length === 0}
                  className="w-full"
                >
                  {versions.map((v) => (
                    <option key={v.id} value={v.id}>
                      {versionLabel(v)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('source.inspection.rptTemplate')}>
                <Select
                  value={choice ? templateChoiceId(choice) : ''}
                  onChange={(e) => setTemplateId(e.target.value)}
                  disabled={busy}
                  className="w-full"
                >
                  <optgroup label={t('source.inspection.rptTemplateForType', { type: t(reportTypeKey(type)) })}>
                    {serving.map(templateOption)}
                  </optgroup>
                  {others.length > 0 && <optgroup label={t('source.inspection.rptTemplateOther')}>{others.map(templateOption)}</optgroup>}
                </Select>
              </Field>
            </div>

            {type === 'fai' && (
              <div className="grid grid-cols-2 gap-3">
                <Field label={t('source.inspection.rptFaiScopeLabel')}>
                  <SegmentedControl<FaiScope>
                    value={state.faiScope}
                    options={(['full', 'partial'] as const).map((value) => ({
                      value,
                      label: t(`source.inspection.rptFaiScope_${value}`),
                      disabled: busy,
                    }))}
                    onChange={(value) => update({ faiScope: value, chosen: null })}
                    size="sm"
                    aria-label={t('source.inspection.rptFaiScopeLabel')}
                  />
                </Field>
                <Field label={t('source.inspection.rptFaiReasonLabel')}>
                  <Select
                    value={state.faiReason}
                    onChange={(e) => update({ faiReason: e.target.value as GenerateDialogState['faiReason'] })}
                    disabled={busy}
                    className="w-full"
                  >
                    {FAI_REASONS.map((reason) => (
                      <option key={reason} value={reason}>
                        {t(faiReasonKey(reason))}
                      </option>
                    ))}
                  </Select>
                </Field>
                {partial && (
                  <Field label={t('source.inspection.rptFaiBaselineLabel')} className="col-span-2">
                    {baselineChoices.length > 0 ? (
                      <Select
                        value={baselineId ?? ''}
                        onChange={(e) => update({ baselineId: e.target.value, chosen: null })}
                        disabled={busy}
                        className="w-full"
                      >
                        {baselineChoices.map((b) => (
                          <option key={b.version.id} value={b.version.id}>
                            {t(b.accepted ? 'source.inspection.rptFaiBaselineAccepted' : 'source.inspection.rptFaiBaselinePending', {
                              label: versionLabel(b.version),
                            })}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <Callout tone="warning">{t('source.inspection.rptFaiNoBaseline')}</Callout>
                    )}
                  </Field>
                )}
              </div>
            )}

            {isLotType(type) && (
              <div className="grid grid-cols-2 gap-3">
                {type === 'receiving' && (
                  <>
                    <Field label={t('source.inspection.rptSupplier')}>
                      <TextInput value={state.supplierName} onChange={(e) => update({ supplierName: e.target.value })} disabled={busy} maxLength={200} />
                    </Field>
                    <Field label={t('source.inspection.rptPoNumber')}>
                      <TextInput value={state.poNumber} onChange={(e) => update({ poNumber: e.target.value })} disabled={busy} maxLength={100} />
                    </Field>
                  </>
                )}
                <Field label={t('source.inspection.rptLotNumber')}>
                  <TextInput value={state.lotNumber} onChange={(e) => update({ lotNumber: e.target.value })} disabled={busy} maxLength={100} />
                </Field>
                <Field label={t('source.inspection.rptLotSize')} error={errors.lotSize}>
                  <TextInput
                    value={state.lotSize}
                    onChange={(e) => update({ lotSize: e.target.value })}
                    disabled={busy}
                    inputMode="numeric"
                  />
                </Field>
                <Field label={t('source.inspection.rptSamplingLabel')}>
                  <SegmentedControl<'fixed' | '100'>
                    value={state.samplingPlan}
                    options={(['fixed', '100'] as const).map((value) => ({
                      value,
                      label: t(`source.inspection.rptSamplingPlan_${value}`),
                      disabled: busy,
                    }))}
                    onChange={(value) => update({ samplingPlan: value })}
                    size="sm"
                    aria-label={t('source.inspection.rptSamplingLabel')}
                  />
                </Field>
                <Field label={t('source.inspection.rptSampleCount')} error={errors.sampleCount}>
                  <TextInput
                    value={state.samplingPlan === '100' ? state.lotSize : state.sampleCount}
                    onChange={(e) => update({ sampleCount: e.target.value })}
                    disabled={busy || state.samplingPlan === '100'}
                    inputMode="numeric"
                  />
                </Field>
                <p className="col-span-2 text-[11px] leading-4 text-ui-fg-tertiary">{t('source.inspection.rptSamplingNote')}</p>
              </div>
            )}

            {type === 'reinspection' && (
              <Field label={t('source.inspection.rptNcrReference')} error={attempted ? errors.ncrReference : undefined}>
                <TextInput value={state.ncrReference} onChange={(e) => update({ ncrReference: e.target.value })} disabled={busy} maxLength={100} />
              </Field>
            )}

            <CharacteristicPicker
              rows={data?.rows ?? null}
              loadError={loadError}
              ticked={ticked}
              changedIds={partial ? (data?.changedIds ?? []) : null}
              editable={canChooseCharacteristics(state) && !busy}
              mode={isLotType(type) ? state.characteristicMode : null}
              modes={charModes}
              onMode={(mode) => update({ characteristicMode: mode, chosen: null })}
              onToggle={(id) => data && setState((s) => (s ? toggleCharacteristic({ ...s, baselineId }, data, id) : s))}
              onSetAll={(all) => data && update({ chosen: new Set(all ? data.rows.map((r) => r.id) : []) })}
              error={attempted ? errors.characteristics : undefined}
            />
          </>
        )}

        {versions.length === 0 && <Callout tone="warning">{t('source.inspection.rptNoVersions')}</Callout>}
        {!hasDesktop() && <Callout tone="info">{t('source.inspection.rptWebDrawingNote')}</Callout>}
      </div>
      </div>

      <div className="mt-4 flex items-center justify-end gap-2 border-t border-plm-border pt-3">
        {busyPhase && <span className="mr-auto text-xs text-plm-fg-muted">{t(`source.inspection.rptPhase_${busyPhase}`)}</span>}
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          {t('common.cancel')}
        </Button>
        <Button
          variant="primary"
          icon={<FileSpreadsheet size={14} />}
          loading={busy}
          disabled={!choice || !version || !data}
          onClick={() => {
            // Required fields say what is missing once the user tries; malformed numbers say so at once.
            setAttempted(true)
            if (choice && version && request) onGenerate(choice, version, request)
          }}
        >
          {t('source.inspection.rptGenerateTyped', { type: t(`source.inspection.rptTypeChip_${type}`) })}
        </Button>
      </div>
    </Dialog>
  )
}
