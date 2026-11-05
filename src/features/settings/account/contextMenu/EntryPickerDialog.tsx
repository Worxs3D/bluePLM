import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'

import { Dialog } from '@/components/core/Dialog'
import { Badge, ListRow, RowGroup, TextInput } from '@/components/core/ui'
import type { ContextMenuEntryId } from '@/lib/contextMenu/entries'
import type { MenuLayout } from '@/lib/contextMenu/types'
import { useTranslation } from '@/lib/i18n'
import { hasDesktop } from '@/lib/platform'

import { entryHint, entryLabel, entryLocation, entrySearchText, listedEntries, matchesQuery } from './entryText'

interface EntryPickerDialogProps {
  open: boolean
  mode: 'pin' | 'hide'
  /** The layout the entries are in now, to say where each one is. */
  layout: MenuLayout
  pinned: readonly ContextMenuEntryId[]
  hidden: readonly ContextMenuEntryId[]
  isAdmin: boolean
  onPick: (id: ContextMenuEntryId) => void
  onClose: () => void
}

/** A searchable list of every menu action, to pin one to the top or hide one. */
export function EntryPickerDialog({ open, mode, layout, pinned, hidden, isAdmin, onPick, onClose }: EntryPickerDialogProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const desktop = hasDesktop()

  const rows = useMemo(
    () => listedEntries(isAdmin).filter((def) => matchesQuery(entrySearchText(t, def.id as ContextMenuEntryId), query)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isAdmin, query],
  )

  const close = () => {
    setQuery('')
    onClose()
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title={t(mode === 'pin' ? 'contextMenuCustomizer.picker.titlePin' : 'contextMenuCustomizer.picker.titleHide')}
      className="max-w-lg"
    >
      <div className="relative">
        <Search
          size={14}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ui-fg-secondary"
          aria-hidden
        />
        <TextInput
          autoFocus
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('contextMenuCustomizer.picker.search')}
          aria-label={t('contextMenuCustomizer.picker.search')}
          className="pl-8"
        />
      </div>
      <div className="-mx-2 mt-3 max-h-[55vh] overflow-y-auto">
        {rows.length === 0 ? (
          <p className="px-2 py-3 text-[14px] text-ui-fg-secondary">
            {t('contextMenuCustomizer.picker.noMatches', { query: query.trim() })}
          </p>
        ) : (
          <RowGroup>
            {rows.map((def) => {
              const id = def.id as ContextMenuEntryId
              const Icon = def.icon
              const isPinned = pinned.includes(id)
              const isHidden = hidden.includes(id) || layout.hidden.includes(id)
              const done = mode === 'pin' ? isPinned : isHidden
              const where = entryLocation(t, layout, id)
              return (
                <ListRow
                  key={id}
                  leading={<Icon size={16} />}
                  title={entryLabel(t, id)}
                  secondary={entryHint(t, id)}
                  trailing={
                    done ? (
                      <Badge>{t(mode === 'pin' ? 'contextMenuCustomizer.picker.pinned' : 'contextMenuCustomizer.picker.hidden')}</Badge>
                    ) : !desktop && def.desktopOnly ? (
                      <Badge>{t('contextMenuCustomizer.editor.desktopOnly')}</Badge>
                    ) : where ? (
                      <span className="max-w-[160px] truncate" title={where}>
                        {where}
                      </span>
                    ) : null
                  }
                  disabled={done}
                  onActivate={() => {
                    onPick(id)
                    close()
                  }}
                  shape="rounded"
                />
              )
            })}
          </RowGroup>
        )}
      </div>
    </Dialog>
  )
}
