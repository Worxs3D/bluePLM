import { useId, useMemo, useState, type ReactNode } from 'react'

import { Select } from '@/components/core/ui'
import { SubmenuArrow } from '@/features/source/browser/components/ContextMenu/components/SubmenuArrow'
import { CustomizableMenu } from '@/features/source/browser/components/ContextMenu/customizable/CustomizableMenu'
import type { EntryElements } from '@/features/source/browser/components/ContextMenu/customizable/types'
import { CONTEXT_MENU_ENTRIES, type ContextMenuEntryId } from '@/lib/contextMenu/entries'
import { resolveLayout } from '@/lib/contextMenu/resolve'
import type { MenuLayout } from '@/lib/contextMenu/types'
import { useTranslation } from '@/lib/i18n'
import { hasDesktop } from '@/lib/platform'

import { entryLabel } from './entryText'
import { PREVIEW_KINDS, PREVIEW_STATES, previewAvailable, type PreviewKind, type PreviewState } from './previewAvailability'

/** Stand-in rows: each entry's icon and name, as the menu draws a row. */
function useStandInEntries(): EntryElements {
  const { t, language } = useTranslation()
  return useMemo(() => {
    const out: EntryElements = {}
    for (const def of CONTEXT_MENU_ENTRIES) {
      const Icon = def.icon
      const danger = 'danger' in def && def.danger
      const submenu = 'submenu' in def && def.submenu
      const row: ReactNode = (
        <div className={`context-menu-item ${danger ? 'danger' : ''}`} title={entryLabel(t, def.id)}>
          <Icon size={14} />
          <span className="min-w-0 flex-1 truncate">{entryLabel(t, def.id)}</span>
          {submenu && <SubmenuArrow />}
        </div>
      )
      out[def.id] = row
    }
    return out
    // `t` is a new function each render; the rows only change with the language.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language])
}

interface MenuPreviewProps {
  layout: MenuLayout
  isAdmin: boolean
}

/**
 * The real right-click menu (`CustomizableMenu`) drawing `layout` for a picked kind of selection,
 * with stand-in rows. Groups open as in the menu; nothing runs.
 */
export function MenuPreview({ layout, isAdmin }: MenuPreviewProps) {
  const { t } = useTranslation()
  const id = useId()
  const [kind, setKind] = useState<PreviewKind>('part')
  const [state, setState] = useState<PreviewState>('checkedIn')
  const entries = useStandInEntries()
  const desktop = hasDesktop()
  const isAvailable = (entryId: ContextMenuEntryId) => previewAvailable(entryId, kind, state, { isAdmin, desktop })
  const empty = resolveLayout(layout, isAvailable).length === 0

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="text-[14px] font-semibold leading-5 text-ui-fg">{t('contextMenuCustomizer.preview.title')}</h3>
        <p className="mt-1 text-[13px] leading-[1.4] text-ui-fg-secondary">
          {t('contextMenuCustomizer.preview.description')}
        </p>
      </div>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-2 text-[13px] text-ui-fg-secondary">
        <label htmlFor={`${id}-kind`}>{t('contextMenuCustomizer.preview.selection')}</label>
        <Select id={`${id}-kind`} size="sm" value={kind} onChange={(e) => setKind(e.target.value as PreviewKind)}>
          {PREVIEW_KINDS.map((value) => (
            <option key={value} value={value}>
              {t(`contextMenuCustomizer.previewKind.${value}`)}
            </option>
          ))}
        </Select>
        <label htmlFor={`${id}-state`}>{t('contextMenuCustomizer.preview.state')}</label>
        <Select id={`${id}-state`} size="sm" value={state} onChange={(e) => setState(e.target.value as PreviewState)}>
          {PREVIEW_STATES.map((value) => (
            <option key={value} value={value}>
              {t(`contextMenuCustomizer.previewState.${value}`)}
            </option>
          ))}
        </Select>
      </div>
      <div
        className="context-menu !relative !z-0 max-h-[70vh] w-full max-w-[280px] overflow-y-auto !animate-none"
        role="presentation"
        data-menu-preview=""
      >
        {empty ? (
          <div className="px-3 py-2 text-[12px] text-ui-fg-secondary">{t('contextMenuCustomizer.preview.empty')}</div>
        ) : (
          <CustomizableMenu entries={entries} layout={layout} isAvailable={isAvailable} hideCustomize />
        )}
      </div>
    </div>
  )
}
