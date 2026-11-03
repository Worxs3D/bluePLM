import { useMemo, useState } from 'react'
import { FileSpreadsheet } from 'lucide-react'

import { Dialog } from '@/components/core/Dialog'
import { Button, Callout, Select } from '@/components/core/ui'
import { t } from '@/lib/i18n'
import { builtInTemplateNames } from '@/lib/inspection/issueText'
import { hasDesktop } from '@/lib/platform'
import type { InspectionTemplate } from '@/types/inspectionReports'

import type { GeneratePhase } from './reportActions'
import {
  defaultTemplateChoice,
  templateChoiceId,
  templateChoices,
  type TemplateChoice,
  type VersionInfo,
} from './reportModel'

interface GenerateReportDialogProps {
  templates: readonly InspectionTemplate[]
  versions: readonly VersionInfo[]
  busyPhase: GeneratePhase | null
  onGenerate: (template: TemplateChoice, version: VersionInfo) => void
  onClose: () => void
}

/**
 * Pick a template (organization templates, then built-ins; the default preselected) and a
 * checked-in version (the latest preselected), then generate.
 */
export function GenerateReportDialog({ templates, versions, busyPhase, onGenerate, onClose }: GenerateReportDialogProps) {
  const choices = useMemo(() => templateChoices(templates, builtInTemplateNames()), [templates])
  const [templateId, setTemplateId] = useState(() => {
    const preferred = defaultTemplateChoice(choices)
    return preferred ? templateChoiceId(preferred) : ''
  })
  const [versionId, setVersionId] = useState(() => versions[0]?.id ?? '')
  const choice = choices.find((c) => templateChoiceId(c) === templateId) ?? null
  const version = versions.find((v) => v.id === versionId) ?? null
  const busy = busyPhase !== null
  const orgChoices = choices.filter((c) => c.kind === 'org')
  const builtIns = choices.filter((c) => c.kind === 'builtin')

  return (
    <Dialog open onClose={busy ? () => undefined : onClose} title={t('source.inspection.rptGenerateTitle')}>
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-plm-fg-muted">{t('source.inspection.rptGenerateIntro')}</p>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-plm-fg-muted">{t('source.inspection.rptTemplate')}</span>
          <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)} disabled={busy} className="w-full">
            {orgChoices.length > 0 && (
              <optgroup label={t('source.inspection.rptOrgTemplates')}>
                {orgChoices.map((c) =>
                  c.kind === 'org' ? (
                    <option key={templateChoiceId(c)} value={templateChoiceId(c)}>
                      {c.template.isDefault
                        ? t('source.inspection.rptTemplateDefaultOption', { name: c.template.name })
                        : c.template.name}
                    </option>
                  ) : null,
                )}
              </optgroup>
            )}
            <optgroup label={t('source.inspection.rptBuiltInTemplates')}>
              {builtIns.map((c) =>
                c.kind === 'builtin' ? (
                  <option key={templateChoiceId(c)} value={templateChoiceId(c)}>
                    {c.name}
                  </option>
                ) : null,
              )}
            </optgroup>
          </Select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-plm-fg-muted">{t('source.inspection.rptVersion')}</span>
          <Select
            value={versionId}
            onChange={(e) => setVersionId(e.target.value)}
            disabled={busy || versions.length === 0}
            className="w-full"
          >
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.revision
                  ? t('source.inspection.rptVersionOptionRev', { version: v.version, revision: v.revision })
                  : t('source.inspection.rptVersionOption', { version: v.version })}
              </option>
            ))}
          </Select>
        </label>

        {versions.length === 0 && (
          <Callout tone="warning">{t('source.inspection.rptNoVersions')}</Callout>
        )}
        {!hasDesktop() && <Callout tone="info">{t('source.inspection.rptWebDrawingNote')}</Callout>}

        <div className="mt-1 flex items-center justify-end gap-2">
          {busyPhase && (
            <span className="mr-auto text-xs text-plm-fg-muted">
              {t(`source.inspection.rptPhase_${busyPhase}`)}
            </span>
          )}
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            icon={<FileSpreadsheet size={14} />}
            loading={busy}
            disabled={!choice || !version}
            onClick={() => choice && version && onGenerate(choice, version)}
          >
            {t('source.inspection.rptGenerate')}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
