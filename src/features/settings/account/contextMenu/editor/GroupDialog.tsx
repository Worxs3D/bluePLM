import { useEffect, useState } from 'react'

import { Dialog } from '@/components/core/Dialog'
import { Button, IconButton, Select, TextInput } from '@/components/core/ui'
import { GROUP_ICONS, groupIcon, type ContextMenuGroupId, type GroupIconName } from '@/lib/contextMenu/entries'
import { MAX_GROUP_LABEL, type GroupDisplay } from '@/lib/contextMenu/types'
import { useTranslation } from '@/lib/i18n'

export interface GroupDraft {
  label: string
  icon: string | null
  display: GroupDisplay
}

interface GroupDialogProps {
  open: boolean
  /** Set when editing a group; null = a new one. */
  editing: { builtin?: ContextMenuGroupId; draft: GroupDraft; topLevel: boolean } | null
  onSubmit: (draft: GroupDraft) => void
  onClose: () => void
}

const TOP_DISPLAYS: readonly GroupDisplay[] = ['submenu', 'inline', 'collapsed', 'auto']
const NESTED_DISPLAYS: readonly GroupDisplay[] = ['submenu', 'inline']

/** Name, icon and display of a group: for "Add group" and "Edit group…". */
export function GroupDialog({ open, editing, onSubmit, onClose }: GroupDialogProps) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState<GroupDraft>({ label: '', icon: 'folder', display: 'submenu' })

  useEffect(() => {
    if (open) setDraft(editing?.draft ?? { label: '', icon: 'folder', display: 'submenu' })
  }, [open, editing])

  const builtin = editing?.builtin
  const displays = editing && !editing.topLevel ? NESTED_DISPLAYS : TOP_DISPLAYS
  const canSubmit = !!builtin || draft.label.trim().length > 0
  const shownIcon = draft.icon ?? (builtin ? null : 'folder')
  const BuiltinIcon = builtin ? groupIcon({ builtin }) : null

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t(editing ? 'contextMenuCustomizer.groupDialog.titleEdit' : 'contextMenuCustomizer.groupDialog.titleNew')}
      footer={
        <>
          <Button onClick={onClose}>{t('contextMenuCustomizer.groupDialog.cancel')}</Button>
          <Button variant="primary" disabled={!canSubmit} onClick={() => onSubmit(draft)}>
            {t(editing ? 'contextMenuCustomizer.groupDialog.save' : 'contextMenuCustomizer.groupDialog.create')}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (canSubmit) onSubmit(draft)
        }}
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-[14px] text-ui-fg">{t('contextMenuCustomizer.groupDialog.name')}</span>
          <TextInput
            autoFocus
            value={draft.label}
            maxLength={MAX_GROUP_LABEL}
            placeholder={
              builtin ? t(`contextMenuCustomizer.group.${builtin}`) : t('contextMenuCustomizer.groupDialog.namePlaceholder')
            }
            onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
          />
          {builtin && (
            <span className="text-[13px] text-ui-fg-secondary">
              {t('contextMenuCustomizer.groupDialog.nameBuiltin', { name: t(`contextMenuCustomizer.group.${builtin}`) })}
            </span>
          )}
        </label>
        <div className="flex flex-col gap-1.5">
          <span className="text-[14px] text-ui-fg">{t('contextMenuCustomizer.groupDialog.icon')}</span>
          <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={t('contextMenuCustomizer.groupDialog.icon')}>
            {BuiltinIcon && (
              <IconButton
                label={t(`contextMenuCustomizer.group.${builtin}`)}
                icon={<BuiltinIcon size={16} />}
                pressed={shownIcon === null}
                onClick={() => setDraft((d) => ({ ...d, icon: null }))}
              />
            )}
            {(Object.keys(GROUP_ICONS) as GroupIconName[]).map((name) => {
              const Icon = GROUP_ICONS[name]
              return (
                <IconButton
                  key={name}
                  label={t(`contextMenuCustomizer.groupIcon.${name}`)}
                  icon={<Icon size={16} />}
                  pressed={shownIcon === name}
                  onClick={() => setDraft((d) => ({ ...d, icon: name }))}
                />
              )
            })}
          </div>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-[14px] text-ui-fg">{t('contextMenuCustomizer.groupDialog.display')}</span>
          <Select
            value={draft.display}
            onChange={(e) => setDraft((d) => ({ ...d, display: e.target.value as GroupDisplay }))}
          >
            {displays.map((display) => (
              <option key={display} value={display}>
                {t(`contextMenuCustomizer.display.${display}`)}
              </option>
            ))}
          </Select>
          <span className="text-[13px] text-ui-fg-secondary">{t(`contextMenuCustomizer.displayHint.${draft.display}`)}</span>
        </label>
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Dialog>
  )
}
