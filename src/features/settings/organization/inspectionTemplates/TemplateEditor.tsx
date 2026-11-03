import { useState } from 'react'
import { Save, X } from 'lucide-react'

import { Button, Switch, TextArea, TextInput } from '@/components/core/ui'
import { t } from '@/lib/i18n'
import type { TemplateLayout } from '@/lib/inspection/excel'

import { TemplateAnalysisPanel } from './TemplateAnalysisPanel'

/** A workbook picked and analysed, waiting to be saved as a new template or a replacement. */
export interface PickedWorkbook {
  fileName: string
  bytes: Uint8Array
  layout: TemplateLayout
}

export type EditorMode =
  | { kind: 'create'; picked: PickedWorkbook }
  | { kind: 'replace'; templateId: string; templateName: string; revision: number; picked: PickedWorkbook }
  | { kind: 'edit'; templateId: string; name: string; description: string | null }

export interface EditorValues {
  name: string
  description: string
  makeDefault: boolean
}

interface TemplateEditorProps {
  mode: EditorMode
  initialName: string
  saving: boolean
  onSave: (values: EditorValues) => void
  onCancel: () => void
}

/**
 * Save a new template, replace a template's workbook (revision + 1), or rename one. A workbook
 * whose analysis found errors cannot be saved; warnings are shown and allowed.
 */
export function TemplateEditor({ mode, initialName, saving, onSave, onCancel }: TemplateEditorProps) {
  const [name, setName] = useState(initialName)
  const [description, setDescription] = useState(mode.kind === 'edit' ? (mode.description ?? '') : '')
  const [makeDefault, setMakeDefault] = useState(false)
  const picked = mode.kind === 'edit' ? null : mode.picked
  const hasErrors = !!picked && picked.layout.errors.length > 0
  const nameNeeded = mode.kind !== 'replace'

  const title =
    mode.kind === 'create'
      ? t('source.inspection.tplNewTitle', { file: mode.picked.fileName })
      : mode.kind === 'replace'
        ? t('source.inspection.tplReplaceTitle', {
            name: mode.templateName,
            revision: mode.revision + 1,
            file: mode.picked.fileName,
          })
        : t('source.inspection.tplEditTitle')

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-ui-divider p-3">
      <div className="text-[14px] font-medium text-ui-fg">{title}</div>
      {picked && <TemplateAnalysisPanel layout={picked.layout} />}
      {nameNeeded && (
        <>
          <label className="flex flex-col gap-1">
            <span className="text-[13px] text-ui-fg-secondary">{t('source.inspection.tplName')}</span>
            <TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[13px] text-ui-fg-secondary">{t('source.inspection.tplDescription')}</span>
            <TextArea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={500} />
          </label>
        </>
      )}
      {mode.kind === 'create' && (
        <label className="flex items-center gap-2 text-[13px] text-ui-fg">
          <Switch checked={makeDefault} onChange={setMakeDefault} aria-label={t('source.inspection.tplMakeDefault')} />
          {t('source.inspection.tplMakeDefault')}
        </label>
      )}
      <div className="flex items-center justify-end gap-2">
        {hasErrors && <span className="mr-auto text-[13px] text-ui-danger">{t('source.inspection.tplFixErrors')}</span>}
        <Button variant="ghost" icon={<X size={14} />} onClick={onCancel} disabled={saving}>
          {t('common.cancel')}
        </Button>
        <Button
          variant="primary"
          icon={<Save size={14} />}
          loading={saving}
          disabled={hasErrors || (nameNeeded && !name.trim())}
          onClick={() => onSave({ name: name.trim(), description: description.trim(), makeDefault })}
        >
          {t('common.save')}
        </Button>
      </div>
    </div>
  )
}
