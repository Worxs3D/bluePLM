import { useCallback, useEffect, useState } from 'react'
import { Archive, ArchiveRestore, Download, FileUp, Loader2, Pencil, RefreshCw, Star, Upload } from 'lucide-react'

import { ConfirmDialog } from '@/components/core/Dialog'
import { Badge, Button, Switch, type BadgeTone } from '@/components/core/ui'
import { t } from '@/lib/i18n'
import { analyzeTemplate, builtInTemplates } from '@/lib/inspection/excel'
import { BUILT_IN_DESCRIPTION_KEYS, BUILT_IN_NAME_KEYS } from '@/lib/inspection/issueText'
import { pickWorkbookFile, readFileBytes, saveWorkbook } from '@/lib/inspection/reportFiles'
import { log } from '@/lib/logger'
import {
  archiveInspectionTemplate,
  createInspectionTemplate,
  downloadInspectionContent,
  listInspectionTemplates,
  setDefaultInspectionTemplate,
  updateInspectionTemplate,
  uploadInspectionContent,
} from '@/lib/supabase'
import { usePDMStore } from '@/stores/pdmStore'
import type { InspectionTemplate } from '@/types/inspectionReports'
import type { Json } from '@/types/supabase'

import { SettingsGroup, SettingsPage, SettingsSection } from '../../components/ui'
import { TemplateEditor, type EditorMode, type EditorValues } from './TemplateEditor'
import { TemplateTokenReference } from './TemplateTokenReference'
import { analysisStatus, nameFromFileName, parseLayout, type AnalysisStatus } from './templateModel'

const STATUS_TONE: Record<AnalysisStatus, BadgeTone> = {
  ready: 'success',
  warnings: 'warning',
  errors: 'error',
  unknown: 'neutral',
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function layoutJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json
}

/**
 * Settings > Inspection templates: the organization's Excel report templates. Administrators
 * upload, analyse, rename, replace, set the default, archive and download; members see the list.
 * Without any template, report generation still offers the built-in starters.
 */
export function InspectionTemplatesSettings() {
  const organization = usePDMStore((s) => s.organization)
  const getEffectiveRole = usePDMStore((s) => s.getEffectiveRole)
  const addToast = usePDMStore((s) => s.addToast)
  const isAdmin = getEffectiveRole() === 'admin'
  const orgId = organization?.id

  const [templates, setTemplates] = useState<InspectionTemplate[]>([])
  const [showArchived, setShowArchived] = useState(false)
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [editor, setEditor] = useState<EditorMode | null>(null)
  const [saving, setSaving] = useState(false)
  const [archiving, setArchiving] = useState<InspectionTemplate | null>(null)

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    try {
      setTemplates(await listInspectionTemplates(orgId, { includeArchived: showArchived }))
    } catch (err) {
      log.warn('[InspectionTemplates]', 'Load failed', { error: errorText(err) })
      addToast('error', t('source.inspection.tplLoadFailed', { error: errorText(err) }))
    } finally {
      setLoading(false)
    }
  }, [orgId, showArchived, addToast])

  useEffect(() => {
    void load()
  }, [load])

  const act = useCallback(
    async (id: string, action: () => Promise<void>) => {
      setBusyId(id)
      try {
        await action()
      } catch (err) {
        log.error('[InspectionTemplates]', 'Template action failed', { id, error: errorText(err) })
        addToast('error', t('source.inspection.tplActionFailed', { error: errorText(err) }))
      } finally {
        setBusyId(null)
      }
    },
    [addToast],
  )

  /** Pick an .xlsx and analyse it; null when nothing was picked. */
  const pickAndAnalyze = async () => {
    const file = await pickWorkbookFile()
    if (!file) return null
    const bytes = await readFileBytes(file)
    return { fileName: file.name, bytes, layout: await analyzeTemplate(bytes) }
  }

  const startUpload = () =>
    void act('__upload__', async () => {
      const picked = await pickAndAnalyze()
      if (picked) setEditor({ kind: 'create', picked })
    })

  const startReplace = (template: InspectionTemplate) =>
    void act(template.id, async () => {
      const picked = await pickAndAnalyze()
      if (picked) {
        setEditor({
          kind: 'replace',
          templateId: template.id,
          templateName: template.name,
          revision: template.revision,
          picked,
        })
      }
    })

  const saveEditor = async (values: EditorValues) => {
    if (!orgId || !editor) return
    setSaving(true)
    try {
      if (editor.kind === 'create') {
        const uploaded = await uploadInspectionContent(orgId, editor.picked.bytes)
        await createInspectionTemplate({
          orgId,
          name: values.name,
          description: values.description || null,
          storageHash: uploaded.hash,
          fileSize: uploaded.size,
          originalFilename: editor.picked.fileName,
          isDefault: values.makeDefault,
          layout: layoutJson(editor.picked.layout),
        })
        addToast('success', t('source.inspection.tplSaved', { name: values.name }))
      } else if (editor.kind === 'replace') {
        const uploaded = await uploadInspectionContent(orgId, editor.picked.bytes)
        await updateInspectionTemplate(editor.templateId, {
          storageHash: uploaded.hash,
          fileSize: uploaded.size,
          originalFilename: editor.picked.fileName,
          revision: editor.revision + 1,
          layout: layoutJson(editor.picked.layout),
        })
        addToast('success', t('source.inspection.tplReplaced', { name: editor.templateName, revision: editor.revision + 1 }))
      } else {
        await updateInspectionTemplate(editor.templateId, { name: values.name, description: values.description || null })
      }
      setEditor(null)
      await load()
    } catch (err) {
      log.error('[InspectionTemplates]', 'Save failed', { error: errorText(err) })
      addToast('error', t('source.inspection.tplActionFailed', { error: errorText(err) }))
    } finally {
      setSaving(false)
    }
  }

  const download = (template: InspectionTemplate) =>
    void act(template.id, async () => {
      if (!orgId) return
      const bytes = await downloadInspectionContent(orgId, template.storageHash)
      await saveWorkbook(template.originalFilename || `${template.name}.xlsx`, bytes)
    })

  const downloadStarter = (key: string) =>
    void act(`builtin:${key}`, async () => {
      const builtIn = (await builtInTemplates()).find((b) => b.key === key)
      if (!builtIn) return
      const name = BUILT_IN_NAME_KEYS[key] ? t(BUILT_IN_NAME_KEYS[key]) : builtIn.name
      await saveWorkbook(`${name}.xlsx`, builtIn.bytes)
    })

  const confirmArchive = () => {
    const template = archiving
    if (!template) return
    void act(template.id, async () => {
      await archiveInspectionTemplate(template.id)
      await load()
    })
  }

  return (
    <SettingsPage>
      <SettingsSection
        title={t('source.inspection.tplTitle')}
        description={
          isAdmin ? t('source.inspection.tplIntro') : `${t('source.inspection.tplIntro')} ${t('source.inspection.tplAdminOnly')}`
        }
        actions={
          <>
            <Button
              variant="ghost"
              size="sm"
              icon={<RefreshCw size={14} />}
              onClick={() => void load()}
              disabled={loading}
              title={t('common.refresh')}
              aria-label={t('common.refresh')}
            />
            {isAdmin && (
              <Button
                variant="primary"
                icon={<Upload size={14} />}
                onClick={startUpload}
                loading={busyId === '__upload__'}
                disabled={!!editor}
              >
                {t('source.inspection.tplUpload')}
              </Button>
            )}
          </>
        }
      >
        {editor && (
          <div className="py-3">
            <TemplateEditor
              key={editor.kind === 'create' ? 'create' : editor.templateId}
              mode={editor}
              initialName={
                editor.kind === 'create'
                  ? nameFromFileName(editor.picked.fileName)
                  : editor.kind === 'edit'
                    ? editor.name
                    : editor.templateName
              }
              saving={saving}
              onSave={(values) => void saveEditor(values)}
              onCancel={() => setEditor(null)}
            />
          </div>
        )}
        <SettingsGroup>
          {loading && templates.length === 0 ? (
            <div className="flex h-16 items-center text-ui-fg-secondary">
              <Loader2 size={18} className="animate-spin" />
            </div>
          ) : templates.length === 0 ? (
            <p className="py-3.5 text-[14px] text-ui-fg-secondary">{t('source.inspection.tplNone')}</p>
          ) : (
            templates.map((template) => {
              const layout = parseLayout(template.layout)
              const status = analysisStatus(layout)
              const busy = busyId === template.id
              return (
                <div key={template.id} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-[14px] text-ui-fg">{template.name}</span>
                      <span className="text-[12px] text-ui-fg-secondary">
                        {t('source.inspection.tplRevision', { revision: template.revision })}
                      </span>
                      {template.isDefault && <Badge tone="accent">{t('source.inspection.tplDefault')}</Badge>}
                      {template.archivedAt && <Badge>{t('source.inspection.tplArchived')}</Badge>}
                      <Badge tone={STATUS_TONE[status]}>
                        {status === 'warnings'
                          ? t('source.inspection.tplStatus_warnings', { count: layout?.warnings.length ?? 0 })
                          : t(`source.inspection.tplStatus_${status}`)}
                      </Badge>
                    </div>
                    {(template.description || template.originalFilename) && (
                      <div className="truncate text-[12px] text-ui-fg-secondary">
                        {[template.description, template.originalFilename].filter(Boolean).join(' · ')}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-0.5">
                    {busy && <Loader2 size={14} className="mr-1 animate-spin text-ui-fg-secondary" />}
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<Download size={14} />}
                      onClick={() => download(template)}
                      disabled={busy}
                      title={t('source.inspection.tplDownload')}
                      aria-label={t('source.inspection.tplDownload')}
                    />
                    {isAdmin && !template.archivedAt && (
                      <>
                        {!template.isDefault && (
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={<Star size={14} />}
                            onClick={() =>
                              void act(template.id, async () => {
                                await setDefaultInspectionTemplate(template.id)
                                await load()
                              })
                            }
                            disabled={busy}
                            title={t('source.inspection.tplSetDefault')}
                            aria-label={t('source.inspection.tplSetDefault')}
                          />
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={<Pencil size={14} />}
                          onClick={() =>
                            setEditor({
                              kind: 'edit',
                              templateId: template.id,
                              name: template.name,
                              description: template.description,
                            })
                          }
                          disabled={busy || !!editor}
                          title={t('source.inspection.tplRename')}
                          aria-label={t('source.inspection.tplRename')}
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={<FileUp size={14} />}
                          onClick={() => startReplace(template)}
                          disabled={busy || !!editor}
                          title={t('source.inspection.tplReplace')}
                          aria-label={t('source.inspection.tplReplace')}
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={<Archive size={14} />}
                          onClick={() => setArchiving(template)}
                          disabled={busy}
                          title={t('source.inspection.tplArchive')}
                          aria-label={t('source.inspection.tplArchive')}
                        />
                      </>
                    )}
                    {isAdmin && template.archivedAt && (
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<ArchiveRestore size={14} />}
                        onClick={() =>
                          void act(template.id, async () => {
                            await updateInspectionTemplate(template.id, { archivedAt: null })
                            await load()
                          })
                        }
                        disabled={busy}
                        title={t('source.inspection.tplRestore')}
                        aria-label={t('source.inspection.tplRestore')}
                      />
                    )}
                  </div>
                </div>
              )
            })
          )}
          <label className="flex items-center gap-2 py-2.5 text-[13px] text-ui-fg-secondary">
            <Switch checked={showArchived} onChange={setShowArchived} aria-label={t('source.inspection.tplShowArchived')} />
            {t('source.inspection.tplShowArchived')}
          </label>
        </SettingsGroup>
      </SettingsSection>

      <SettingsSection title={t('source.inspection.tplStartersTitle')} description={t('source.inspection.tplStartersIntro')}>
        <SettingsGroup>
          {Object.keys(BUILT_IN_NAME_KEYS).map((key) => (
            <div key={key} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="text-[14px] text-ui-fg">{t(BUILT_IN_NAME_KEYS[key])}</div>
                <div className="text-[12px] text-ui-fg-secondary">{t(BUILT_IN_DESCRIPTION_KEYS[key])}</div>
              </div>
              <Button
                variant="secondary"
                size="sm"
                icon={<Download size={14} />}
                loading={busyId === `builtin:${key}`}
                onClick={() => downloadStarter(key)}
              >
                {t('source.inspection.tplDownloadStarter')}
              </Button>
            </div>
          ))}
        </SettingsGroup>
      </SettingsSection>

      <SettingsSection title={t('source.inspection.tplTokensTitle')}>
        <TemplateTokenReference />
      </SettingsSection>

      <ConfirmDialog
        open={!!archiving}
        onClose={() => setArchiving(null)}
        title={t('source.inspection.tplArchiveTitle')}
        message={t('source.inspection.tplArchiveMessage', { name: archiving?.name ?? '' })}
        confirmText={t('source.inspection.tplArchive')}
        cancelText={t('common.cancel')}
        variant="warning"
        onConfirm={confirmArchive}
      />
    </SettingsPage>
  )
}
