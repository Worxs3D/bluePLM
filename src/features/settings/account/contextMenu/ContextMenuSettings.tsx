import { useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Download, Pin, Plus, RotateCcw, Upload, X } from 'lucide-react'

import { ConfirmDialog } from '@/components/core/Dialog'
import { Button, Callout, IconButton, ListRow, Page, Row, RowGroup, Section, Select } from '@/components/core/ui'
import { effectiveLayout, orgKey, orgTemplates } from '@/lib/contextMenu'
import { DEFAULT_LAYOUT, getContextMenuEntry, type ContextMenuEntryId } from '@/lib/contextMenu/entries'
import { completeLayout } from '@/lib/contextMenu/complete'
import { APP_DEFAULT_TEMPLATE_ID, type UserContextMenuPrefs } from '@/lib/contextMenu/types'
import { useEffectiveContextMenu } from '@/lib/contextMenu/useContextMenuLayout'
import { useTranslation } from '@/lib/i18n'
import { hasDesktop } from '@/lib/platform'
import { formatDate } from '@/lib/utils/date'
import { usePDMStore } from '@/stores/pdmStore'

import { exportLayoutFile, importLayoutFile } from './contextMenuFile'
import { EntryPickerDialog } from './EntryPickerDialog'
import { entryHint, entryLabel, isListedFor } from './entryText'
import { MenuLayoutEditor } from './MenuLayoutEditor'
import { MenuPreview } from './MenuPreview'
import { editablePrefs, keptPrefs, prefsToStore } from './prefsModel'

type Confirm = 'followAgain' | 'startOver' | 'reset' | null

/**
 * Settings > Right-click menu: the person's own file and folder menu. They follow a template of
 * their organization (or the app default), pin actions to the top and hide others on top of it,
 * or take a copy and arrange everything themselves. Saved as they go, locally per organization
 * (`contextMenuPrefs`), like keyboard shortcuts; a live preview draws the real menu.
 */
export function ContextMenuSettings() {
  const { t } = useTranslation()
  const organization = usePDMStore((s) => s.organization)
  const allPrefs = usePDMStore((s) => s.contextMenuPrefs)
  const setContextMenuPrefs = usePDMStore((s) => s.setContextMenuPrefs)
  const addToast = usePDMStore((s) => s.addToast)
  const getEffectiveRole = usePDMStore((s) => s.getEffectiveRole)
  const isAdmin = getEffectiveRole() === 'admin'
  const effective = useEffectiveContextMenu()

  const key = orgKey(organization?.id)
  const prefs = allPrefs[key]
  const setAside = effective.setAsideByForce
  // While set aside by an admin's force, edits start without the old layout (see editablePrefs).
  const current = editablePrefs(prefs, setAside)
  const { settings, templates } = orgTemplates(organization)

  const [picker, setPicker] = useState<'pin' | 'hide' | null>(null)
  const [confirm, setConfirm] = useState<Confirm>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  // The template followed, without the person's own changes: what pins apply over, what a full
  // layout starts from, and what its resets go back to.
  const followed = useMemo(
    () => effectiveLayout(organization, prefs ? { ...prefs, custom: null, pinned: [], hidden: [] } : undefined),
    [organization, prefs],
  )
  const followedName = followed.template?.name ?? t('contextMenuCustomizer.page.appDefault')
  const customBase = effective.source === 'custom' ? effective.template : followed.template
  const customBaseName = customBase?.name ?? t('contextMenuCustomizer.page.appDefault')
  const customBaseLayout = useMemo(
    () => completeLayout(customBase ? customBase.layout : DEFAULT_LAYOUT),
    [customBase],
  )

  // What the person's own layout was copied from: the app default, or a template since deleted.
  const fromId = current.customizedFrom?.templateId
  const fromAppDefault = fromId === APP_DEFAULT_TEMPLATE_ID
  const sourceDeleted = !!fromId && !fromAppDefault && !templates.some((tpl) => tpl.id === fromId)

  const orgDefault = templates.find((tpl) => tpl.id === settings?.default_template_id) ?? null
  const isCustom = current.custom !== null && !setAside

  const write = (next: UserContextMenuPrefs) => setContextMenuPrefs(key, prefsToStore(next))

  // ── Following ─────────────────────────────────────────────────────────
  const followValue = current.templateId ?? ''
  const followDescription = followed.template
    ? [followed.template.description, t('contextMenuCustomizer.page.updated', { date: formatDate(followed.template.updated_at) })]
        .filter(Boolean)
        .join(' · ')
    : t('contextMenuCustomizer.page.appDefaultDescription')

  const pinned = current.pinned.filter((id) => isListedFor(getContextMenuEntry(id), isAdmin))
  const hidden = current.hidden.filter((id) => isListedFor(getContextMenuEntry(id), isAdmin))

  const movePin = (index: number, direction: -1 | 1) => {
    const next = [...current.pinned]
    const target = index + direction
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    write({ ...current, pinned: next })
  }

  const startCustom = () => {
    write({
      ...current,
      custom: effective.layout,
      pinned: [],
      hidden: [],
      customizedFrom: { templateId: followed.template?.id ?? APP_DEFAULT_TEMPLATE_ID, baseHash: followed.baseHash },
    })
  }

  const runConfirm = () => {
    const which = confirm
    setConfirm(null)
    if (which === 'followAgain') {
      write({ ...current, custom: null, customizedFrom: undefined })
    } else if (which === 'startOver') {
      write({
        ...current,
        custom: customBaseLayout,
        customizedFrom: { templateId: customBase?.id ?? APP_DEFAULT_TEMPLATE_ID, baseHash: effective.baseHash },
      })
    } else if (which === 'reset') {
      setContextMenuPrefs(key, null)
      addToast('info', t('contextMenuCustomizer.page.resetDone', { name: followedName }))
    }
  }

  const fileActions = (
    <>
      <Button size="sm" icon={<Upload size={14} />} onClick={() => fileInput.current?.click()}>
        {t('contextMenuCustomizer.page.import')}
      </Button>
      <Button size="sm" icon={<Download size={14} />} onClick={() => exportLayoutFile(effective.layout, t, addToast)}>
        {t('contextMenuCustomizer.page.export')}
      </Button>
      <Button size="sm" icon={<RotateCcw size={14} />} disabled={!prefs} onClick={() => setConfirm('reset')}>
        {t('contextMenuCustomizer.page.reset')}
      </Button>
    </>
  )

  const savedWhere = (
    <p className="mt-3 text-[13px] text-ui-fg-tertiary">
      {t(hasDesktop() ? 'contextMenuCustomizer.page.savedHere' : 'contextMenuCustomizer.page.savedWeb')}
    </p>
  )

  const forcedCallout = setAside && settings?.forced_at && (
    <Callout
      tone="warning"
      title={t('contextMenuCustomizer.page.forcedTitle')}
      action={
        <Button size="sm" onClick={() => prefs && setContextMenuPrefs(key, keptPrefs(prefs, settings.forced_at as string))}>
          {t('contextMenuCustomizer.page.keepMine')}
        </Button>
      }
    >
      {t('contextMenuCustomizer.page.forcedBody', { date: formatDate(settings.forced_at), name: followedName })}
    </Callout>
  )

  const followSection = (
    <Section
      title={t('contextMenuCustomizer.page.followTitle')}
      description={t('contextMenuCustomizer.page.followDescription')}
      actions={fileActions}
    >
      <RowGroup>
        <Row label={t('contextMenuCustomizer.page.followLabel')} description={followDescription} htmlFor="cm-follow">
          <Select
            id="cm-follow"
            value={followValue}
            onChange={(e) => write({ ...current, templateId: e.target.value || null })}
            className="w-[240px] max-w-full"
          >
            <option value="">
              {t('contextMenuCustomizer.page.orgDefault', {
                name: orgDefault?.name ?? t('contextMenuCustomizer.page.appDefault'),
              })}
            </option>
            {templates.map((tpl) => (
              <option key={tpl.id} value={tpl.id}>
                {tpl.name}
              </option>
            ))}
            <option value={APP_DEFAULT_TEMPLATE_ID}>{t('contextMenuCustomizer.page.appDefault')}</option>
          </Select>
        </Row>
      </RowGroup>
      {savedWhere}
    </Section>
  )

  const quickSections = (
    <>
      <Section
        title={t('contextMenuCustomizer.page.pinnedTitle')}
        description={t('contextMenuCustomizer.page.pinnedDescription')}
        actions={
          <Button size="sm" icon={<Pin size={14} />} onClick={() => setPicker('pin')}>
            {t('contextMenuCustomizer.page.pinAdd')}
          </Button>
        }
      >
        {pinned.length === 0 ? (
          <p className="mt-3 text-[14px] text-ui-fg-secondary">{t('contextMenuCustomizer.page.pinnedEmpty')}</p>
        ) : (
          <RowGroup className="mt-2">
            {pinned.map((id) => {
              const index = current.pinned.indexOf(id)
              const Icon = getContextMenuEntry(id).icon
              return (
                <ListRow
                  key={id}
                  leading={<Icon size={16} />}
                  title={entryLabel(t, id)}
                  secondary={entryHint(t, id)}
                  actionsVisible
                  actions={
                    <>
                      <IconButton
                        size="sm"
                        label={t('contextMenuCustomizer.page.moveUp')}
                        icon={<ArrowUp size={14} />}
                        disabled={index === 0}
                        onClick={() => movePin(index, -1)}
                      />
                      <IconButton
                        size="sm"
                        label={t('contextMenuCustomizer.page.moveDown')}
                        icon={<ArrowDown size={14} />}
                        disabled={index === current.pinned.length - 1}
                        onClick={() => movePin(index, 1)}
                      />
                      <IconButton
                        size="sm"
                        label={t('contextMenuCustomizer.page.unpin')}
                        icon={<X size={14} />}
                        onClick={() => write({ ...current, pinned: current.pinned.filter((p) => p !== id) })}
                      />
                    </>
                  }
                />
              )
            })}
          </RowGroup>
        )}
      </Section>

      <Section
        title={t('contextMenuCustomizer.page.hiddenTitle')}
        description={t('contextMenuCustomizer.page.hiddenDescription')}
        actions={
          <Button size="sm" icon={<Plus size={14} />} onClick={() => setPicker('hide')}>
            {t('contextMenuCustomizer.page.hideAdd')}
          </Button>
        }
      >
        {hidden.length === 0 ? (
          <p className="mt-3 text-[14px] text-ui-fg-secondary">{t('contextMenuCustomizer.page.hiddenEmpty')}</p>
        ) : (
          <RowGroup className="mt-2">
            {hidden.map((id) => {
              const Icon = getContextMenuEntry(id).icon
              return (
                <ListRow
                  key={id}
                  leading={<Icon size={16} />}
                  title={entryLabel(t, id)}
                  secondary={entryHint(t, id)}
                  actionsVisible
                  actions={
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => write({ ...current, hidden: current.hidden.filter((h) => h !== id) })}
                    >
                      {t('contextMenuCustomizer.page.show')}
                    </Button>
                  }
                />
              )
            })}
          </RowGroup>
        )}
      </Section>

      <Section
        title={t('contextMenuCustomizer.page.customizeTitle')}
        description={t('contextMenuCustomizer.page.customizeDescription', { name: followedName })}
      >
        <div className="mt-3">
          <Button onClick={startCustom}>{t('contextMenuCustomizer.page.customizeButton')}</Button>
        </div>
      </Section>
    </>
  )

  const customSections = (
    <>
      {effective.templateChangedSinceCustomized && (
        <Callout
          tone="info"
          action={
            <Button size="sm" onClick={() => setConfirm('startOver')}>
              {t('contextMenuCustomizer.page.templateChangedAction')}
            </Button>
          }
        >
          {fromAppDefault
            ? t('contextMenuCustomizer.page.appDefaultChanged')
            : t('contextMenuCustomizer.page.templateChanged', { name: customBaseName })}
        </Callout>
      )}
      {sourceDeleted && <Callout tone="info">{t('contextMenuCustomizer.page.templateDeleted', { name: followedName })}</Callout>}
      <Section
        title={t('contextMenuCustomizer.page.customTitle')}
        description={
          !current.customizedFrom
            ? t('contextMenuCustomizer.page.customDescriptionImported')
            : sourceDeleted
              ? t('contextMenuCustomizer.page.customDescriptionDeleted')
              : t('contextMenuCustomizer.page.customDescription', { name: customBaseName })
        }
        actions={fileActions}
      >
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => setConfirm('followAgain')}>
            {t('contextMenuCustomizer.page.followAgain', { name: followedName })}
          </Button>
        </div>
        {savedWhere}
      </Section>
      <MenuLayoutEditor
        layout={effective.layout}
        onChange={(next) => write({ ...current, custom: next })}
        base={customBaseLayout}
        baseName={customBaseName}
        isAdmin={isAdmin}
        historyKey={key}
      />
    </>
  )

  const confirmText: Record<Exclude<Confirm, null>, { title: string; body: string; yes: string }> = {
    followAgain: {
      title: t('contextMenuCustomizer.page.followAgainTitle', { name: followedName }),
      body: t('contextMenuCustomizer.page.followAgainBody', { name: followedName }),
      yes: t('contextMenuCustomizer.page.followAgainYes'),
    },
    startOver: {
      title: t('contextMenuCustomizer.page.startOverTitle', { name: customBaseName }),
      body: t('contextMenuCustomizer.page.startOverBody', { name: customBaseName }),
      yes: t('contextMenuCustomizer.page.startOverYes'),
    },
    reset: {
      title: t('contextMenuCustomizer.page.resetTitle'),
      body: t('contextMenuCustomizer.page.resetBody', { name: followedName }),
      yes: t('contextMenuCustomizer.page.resetYes'),
    },
  }

  return (
    <div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_280px]">
      <Page>
        {!hasDesktop() && <Callout tone="info">{t('contextMenuCustomizer.page.savedWeb')}</Callout>}
        {forcedCallout}
        {isCustom ? customSections : (
          <>
            {followSection}
            {!setAside && quickSections}
          </>
        )}
      </Page>
      <aside className="xl:sticky xl:top-0 xl:self-start">
        <MenuPreview layout={effective.layout} isAdmin={isAdmin} />
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
          if (layout) write({ ...current, custom: completeLayout(layout), pinned: [], hidden: [], customizedFrom: undefined })
        }}
      />
      <EntryPickerDialog
        open={picker !== null}
        mode={picker ?? 'pin'}
        layout={effective.layout}
        pinned={current.pinned}
        hidden={current.hidden}
        isAdmin={isAdmin}
        onClose={() => setPicker(null)}
        onPick={(id: ContextMenuEntryId) => {
          if (picker === 'pin') {
            write({ ...current, pinned: [...current.pinned, id], hidden: current.hidden.filter((h) => h !== id) })
          } else {
            write({ ...current, hidden: [...current.hidden, id], pinned: current.pinned.filter((p) => p !== id) })
          }
        }}
      />
      {confirm && (
        <ConfirmDialog
          open
          onClose={() => setConfirm(null)}
          title={confirmText[confirm].title}
          message={confirmText[confirm].body}
          confirmText={confirmText[confirm].yes}
          cancelText={t('contextMenuCustomizer.page.cancel')}
          variant={confirm === 'startOver' ? 'warning' : 'danger'}
          onConfirm={runConfirm}
        />
      )}
    </div>
  )
}
