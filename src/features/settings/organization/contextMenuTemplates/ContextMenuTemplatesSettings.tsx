import { useEffect, useMemo, useRef, useState } from 'react'
import { Copy, Download, Plus, Upload } from 'lucide-react'

import { ConfirmDialog } from '@/components/core/Dialog'
import {
  Badge,
  Button,
  Callout,
  EmptyState,
  IconButton,
  ListRow,
  Page,
  Row,
  RowGroup,
  Section,
  StatusText,
  TextArea,
  TextInput,
} from '@/components/core/ui'
import { exportLayoutFile, importLayoutFile } from '@/features/settings/account/contextMenu/contextMenuFile'
import { MenuLayoutEditor } from '@/features/settings/account/contextMenu/MenuLayoutEditor'
import { MenuPreview } from '@/features/settings/account/contextMenu/MenuPreview'
import { orgTemplates } from '@/lib/contextMenu'
import { completeLayout } from '@/lib/contextMenu/complete'
import { sameLayout } from '@/lib/contextMenu/edit'
import { DEFAULT_LAYOUT } from '@/lib/contextMenu/entries'
import {
  APP_DEFAULT_TEMPLATE_ID,
  MAX_TEMPLATE_DESCRIPTION,
  MAX_TEMPLATE_NAME,
  MAX_TEMPLATES,
  type OrgMenuTemplate,
} from '@/lib/contextMenu/types'
import {
  ContextMenuConflictError,
  ContextMenuWriteError,
  deleteOrgMenuTemplate,
  forceOrgContextMenu,
  saveOrgMenuTemplate,
  setOrgDefaultMenuTemplate,
} from '@/lib/supabase/contextMenuTemplates'
import { useTranslation } from '@/lib/i18n'
import { formatDate } from '@/lib/utils/date'
import { usePDMStore } from '@/stores/pdmStore'

interface Draft {
  template: OrgMenuTemplate
  /** The stored template's `updated_at` when it was opened; null for one not saved yet. */
  loadedUpdatedAt: string | null
}

type Pending =
  | { kind: 'switch'; to: string | null; draft?: Draft }
  | { kind: 'delete' }
  | { kind: 'apply' }
  | null

function newTemplateId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Settings > Menu templates (admins): the organization's layouts of the right-click menu
 * (`organization.settings.context_menu`). Make, duplicate, rename and describe templates, pick the
 * default, edit a layout with the same editor and preview people use, save it explicitly (refused
 * when someone else saved it meanwhile), and "Apply to everyone now".
 */
export function ContextMenuTemplatesSettings() {
  const { t } = useTranslation()
  const organization = usePDMStore((s) => s.organization)
  const getEffectiveRole = usePDMStore((s) => s.getEffectiveRole)
  const addToast = usePDMStore((s) => s.addToast)
  const isAdmin = getEffectiveRole() === 'admin'
  const orgId = organization?.id ?? null
  const { settings, templates } = orgTemplates(organization)

  // The default template opens first (else the first one); the app default when there is none.
  const initial = templates.find((tpl) => tpl.id === settings?.default_template_id) ?? templates[0] ?? null
  const [selected, setSelected] = useState<string | null>(() => initial?.id ?? APP_DEFAULT_TEMPLATE_ID)
  const [draft, setDraft] = useState<Draft | null>(() =>
    initial ? { template: initial, loadedUpdatedAt: initial.updated_at } : null,
  )
  /** The admin picked something; templates arriving later no longer change the selection. */
  const picked = useRef(false)
  const [conflict, setConflict] = useState(false)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<Pending>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  // Templates that arrive after the page opened (the organization loading late): open the default.
  useEffect(() => {
    if (picked.current || draft || !initial) return
    setSelected(initial.id)
    setDraft({ template: initial, loadedUpdatedAt: initial.updated_at })
  }, [initial, draft])

  const stored = draft ? templates.find((tpl) => tpl.id === draft.template.id) ?? null : null
  const draftLayout = useMemo(() => (draft ? completeLayout(draft.template.layout) : DEFAULT_LAYOUT), [draft])
  const baseLayout = useMemo(() => (stored ? completeLayout(stored.layout) : DEFAULT_LAYOUT), [stored])
  const dirty =
    !!draft &&
    (!stored ||
      stored.name !== draft.template.name ||
      (stored.description ?? '') !== (draft.template.description ?? '') ||
      !sameLayout(completeLayout(stored.layout), draftLayout))

  if (!isAdmin || !orgId) {
    return <EmptyState align="start" title={t('contextMenuCustomizer.templates.notAdmin')} />
  }

  const defaultId = settings?.default_template_id ?? null
  const failed = (error: unknown) =>
    addToast('error', t('contextMenuCustomizer.templates.failed', { error: error instanceof Error ? error.message : String(error) }))

  const open = (id: string | null, next?: Draft) => {
    picked.current = true
    setConflict(false)
    setSelected(id)
    if (next) {
      setDraft(next)
      return
    }
    const tpl = templates.find((x) => x.id === id)
    setDraft(tpl ? { template: tpl, loadedUpdatedAt: tpl.updated_at } : null)
  }

  /** Open another template, asking first when the one open has unsaved changes. */
  const requestOpen = (id: string | null, next?: Draft) => {
    if (dirty) setPending({ kind: 'switch', to: id, draft: next })
    else open(id, next)
  }

  const startNew = (from: OrgMenuTemplate | null) => {
    const id = newTemplateId()
    requestOpen(id, {
      loadedUpdatedAt: null,
      template: {
        id,
        name: from ? t('contextMenuCustomizer.templates.copyName', { name: from.name }) : t('contextMenuCustomizer.templates.untitled'),
        ...(from?.description ? { description: from.description } : {}),
        layout: from ? from.layout : DEFAULT_LAYOUT,
        updated_at: '',
      },
    })
  }

  const edit = (changes: Partial<OrgMenuTemplate>) =>
    setDraft((d) => (d ? { ...d, template: { ...d.template, ...changes } } : d))

  const save = async () => {
    if (!draft) return
    const name = draft.template.name.trim()
    if (!name) {
      addToast('error', t('contextMenuCustomizer.templates.nameRequired'))
      return
    }
    setBusy(true)
    try {
      const description = draft.template.description?.trim()
      const result = await saveOrgMenuTemplate(
        orgId,
        { ...draft.template, name, ...(description ? { description } : { description: undefined }), layout: draftLayout },
        draft.loadedUpdatedAt,
      )
      const saved = result.templates.find((tpl) => tpl.id === draft.template.id)
      if (saved) setDraft({ template: saved, loadedUpdatedAt: saved.updated_at })
      setConflict(false)
      addToast('success', t('contextMenuCustomizer.templates.saved'))
    } catch (error) {
      if (error instanceof ContextMenuConflictError) setConflict(true)
      else if (error instanceof ContextMenuWriteError && error.code === 'TOO_MANY_TEMPLATES') {
        addToast('error', t('contextMenuCustomizer.templates.tooMany', { count: MAX_TEMPLATES }))
      } else {
        addToast(
          'error',
          t('contextMenuCustomizer.templates.saveFailed', { error: error instanceof Error ? error.message : String(error) }),
        )
      }
    } finally {
      setBusy(false)
    }
  }

  const run = async (action: () => Promise<unknown>, success?: string) => {
    setBusy(true)
    try {
      await action()
      if (success) addToast('success', success)
    } catch (error) {
      failed(error)
    } finally {
      setBusy(false)
    }
  }

  const confirmPending = async () => {
    const which = pending
    setPending(null)
    if (!which) return
    if (which.kind === 'switch') open(which.to, which.draft)
    else if (which.kind === 'delete' && draft) {
      const id = draft.template.id
      if (!stored) {
        open(templates[0]?.id ?? APP_DEFAULT_TEMPLATE_ID)
        return
      }
      await run(async () => {
        const result = await deleteOrgMenuTemplate(orgId, id)
        const first = result.templates[0]
        setConflict(false)
        setSelected(first?.id ?? APP_DEFAULT_TEMPLATE_ID)
        setDraft(first ? { template: first, loadedUpdatedAt: first.updated_at } : null)
      }, t('contextMenuCustomizer.templates.deleted'))
    } else if (which.kind === 'apply') {
      await run(() => forceOrgContextMenu(orgId), t('contextMenuCustomizer.templates.applied'))
    }
  }

  const draftName = draft?.template.name.trim() || t('contextMenuCustomizer.templates.untitled')
  const isNewDraft = !!draft && !stored
  const appDefaultSelected = selected === APP_DEFAULT_TEMPLATE_ID

  const templateRows = (
    <RowGroup className="mt-2">
      <ListRow
        title={t('contextMenuCustomizer.templates.appDefaultRow')}
        secondary={t('contextMenuCustomizer.templates.appDefaultRowHint')}
        trailing={defaultId === null ? <Badge tone="accent">{t('contextMenuCustomizer.templates.default')}</Badge> : undefined}
        selected={appDefaultSelected}
        onActivate={() => requestOpen(APP_DEFAULT_TEMPLATE_ID)}
        actions={
          <IconButton
            size="sm"
            label={t('contextMenuCustomizer.templates.duplicate', { name: t('contextMenuCustomizer.templates.appDefaultRow') })}
            icon={<Copy size={14} />}
            disabled={templates.length >= MAX_TEMPLATES}
            onClick={() => startNew(null)}
          />
        }
      />
      {templates.map((tpl) => (
        <ListRow
          key={tpl.id}
          title={tpl.name}
          secondary={tpl.description || t('contextMenuCustomizer.templates.updated', { date: formatDate(tpl.updated_at) })}
          trailing={tpl.id === defaultId ? <Badge tone="accent">{t('contextMenuCustomizer.templates.default')}</Badge> : undefined}
          selected={selected === tpl.id}
          onActivate={() => requestOpen(tpl.id)}
          actions={
            <IconButton
              size="sm"
              label={t('contextMenuCustomizer.templates.duplicate', { name: tpl.name })}
              icon={<Copy size={14} />}
              disabled={templates.length >= MAX_TEMPLATES}
              onClick={() => startNew(tpl)}
            />
          }
        />
      ))}
      {isNewDraft && draft && (
        <ListRow
          title={draftName}
          secondary={t('contextMenuCustomizer.templates.notSaved')}
          selected
          onActivate={() => undefined}
        />
      )}
    </RowGroup>
  )

  const editSection = draft && (
    <>
      <Section
        title={t('contextMenuCustomizer.templates.editTitle', { name: draftName })}
        actions={
          <>
            <Button size="sm" icon={<Upload size={14} />} onClick={() => fileInput.current?.click()}>
              {t('contextMenuCustomizer.page.import')}
            </Button>
            <Button size="sm" icon={<Download size={14} />} onClick={() => exportLayoutFile(draftLayout, t, addToast)}>
              {t('contextMenuCustomizer.page.export')}
            </Button>
          </>
        }
      >
        {conflict && (
          <Callout
            tone="warning"
            className="mt-3"
            action={
              <Button size="sm" onClick={() => open(draft.template.id)}>
                {t('contextMenuCustomizer.templates.reload')}
              </Button>
            }
          >
            {t('contextMenuCustomizer.templates.conflict')}
          </Callout>
        )}
        <RowGroup>
          <Row label={t('contextMenuCustomizer.templates.name')} htmlFor="cm-template-name" stacked>
            <TextInput
              id="cm-template-name"
              value={draft.template.name}
              maxLength={MAX_TEMPLATE_NAME}
              onChange={(e) => edit({ name: e.target.value })}
            />
          </Row>
          <Row label={t('contextMenuCustomizer.templates.descriptionLabel')} htmlFor="cm-template-description" stacked>
            <TextArea
              id="cm-template-description"
              rows={2}
              value={draft.template.description ?? ''}
              maxLength={MAX_TEMPLATE_DESCRIPTION}
              placeholder={t('contextMenuCustomizer.templates.descriptionPlaceholder')}
              onChange={(e) => edit({ description: e.target.value })}
            />
          </Row>
        </RowGroup>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button variant="primary" loading={busy} disabled={!dirty || busy} onClick={save}>
            {t('contextMenuCustomizer.templates.save')}
          </Button>
          {dirty && !isNewDraft && (
            <Button onClick={() => open(draft.template.id)}>{t('contextMenuCustomizer.templates.discard')}</Button>
          )}
          {stored && stored.id !== defaultId && (
            <Button
              disabled={busy}
              onClick={() =>
                run(
                  () => setOrgDefaultMenuTemplate(orgId, stored.id),
                  t('contextMenuCustomizer.templates.defaultSet', { name: stored.name }),
                )
              }
            >
              {t('contextMenuCustomizer.templates.setDefault')}
            </Button>
          )}
          <Button variant="danger-subtle" disabled={busy} onClick={() => setPending({ kind: 'delete' })}>
            {t('contextMenuCustomizer.templates.delete')}
          </Button>
          {dirty && (
            <StatusText tone="warning" className="ml-1">
              {t('contextMenuCustomizer.templates.unsaved')}
            </StatusText>
          )}
        </div>
      </Section>
      <MenuLayoutEditor
        layout={draftLayout}
        onChange={(layout) => edit({ layout })}
        base={baseLayout}
        baseName={stored?.name ?? t('contextMenuCustomizer.page.appDefault')}
        isAdmin
        historyKey={draft.template.id}
      />
    </>
  )

  const appDefaultSection = appDefaultSelected && (
    <Section
      title={t('contextMenuCustomizer.templates.appDefaultRow')}
      description={t('contextMenuCustomizer.templates.appDefaultRowHint')}
    >
      <div className="mt-3 flex flex-wrap gap-2">
        <Button icon={<Plus size={14} />} disabled={templates.length >= MAX_TEMPLATES} onClick={() => startNew(null)}>
          {t('contextMenuCustomizer.templates.newFromApp')}
        </Button>
        {defaultId !== null && (
          <Button
            disabled={busy}
            onClick={() => run(() => setOrgDefaultMenuTemplate(orgId, null), t('contextMenuCustomizer.templates.defaultSet', { name: t('contextMenuCustomizer.templates.appDefaultRow') }))}
          >
            {t('contextMenuCustomizer.templates.setDefault')}
          </Button>
        )}
      </div>
    </Section>
  )

  return (
    <div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_280px]">
      <Page>
        <Section
          title={t('contextMenuCustomizer.templates.title')}
          description={t('contextMenuCustomizer.templates.description')}
          actions={
            <Button
              size="sm"
              icon={<Plus size={14} />}
              disabled={templates.length >= MAX_TEMPLATES}
              onClick={() => startNew(null)}
            >
              {t('contextMenuCustomizer.templates.newTemplate')}
            </Button>
          }
        >
          {templateRows}
          <p className="mt-3 text-[13px] text-ui-fg-tertiary">{t('contextMenuCustomizer.templates.permissionNote')}</p>
        </Section>

        {editSection}
        {appDefaultSection}

        <Section
          title={t('contextMenuCustomizer.templates.applyTitle')}
          description={t('contextMenuCustomizer.templates.applyDescription')}
        >
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button variant="danger-subtle" disabled={busy} onClick={() => setPending({ kind: 'apply' })}>
              {t('contextMenuCustomizer.templates.applyButton')}
            </Button>
            {settings?.forced_at && (
              <span className="text-[13px] text-ui-fg-secondary">
                {t('contextMenuCustomizer.templates.lastApplied', { date: formatDate(settings.forced_at) })}
              </span>
            )}
          </div>
        </Section>
      </Page>

      <aside className="xl:sticky xl:top-0 xl:self-start">
        <MenuPreview layout={draftLayout} isAdmin={false} />
      </aside>

      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (!file) return
          const layout = await importLayoutFile(file, t, addToast)
          if (layout) edit({ layout: completeLayout(layout) })
        }}
      />
      {pending && (
        <ConfirmDialog
          open
          onClose={() => setPending(null)}
          title={
            pending.kind === 'switch'
              ? t('contextMenuCustomizer.templates.discardTitle', { name: draftName })
              : pending.kind === 'delete'
                ? t('contextMenuCustomizer.templates.deleteTitle', { name: draftName })
                : t('contextMenuCustomizer.templates.applyConfirmTitle')
          }
          message={
            pending.kind === 'switch'
              ? t('contextMenuCustomizer.templates.discardBody')
              : pending.kind === 'delete'
                ? t('contextMenuCustomizer.templates.deleteBody')
                : t('contextMenuCustomizer.templates.applyConfirmBody')
          }
          confirmText={
            pending.kind === 'switch'
              ? t('contextMenuCustomizer.templates.discardYes')
              : pending.kind === 'delete'
                ? t('contextMenuCustomizer.templates.deleteYes')
                : t('contextMenuCustomizer.templates.applyYes')
          }
          cancelText={t('contextMenuCustomizer.page.cancel')}
          variant="danger"
          onConfirm={confirmPending}
        />
      )}
    </div>
  )
}
