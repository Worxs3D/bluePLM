import { useEffect, useId, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import {
  ArrowDownToLine,
  CornerLeftUp,
  FolderInput,
  FolderPlus,
  Minus,
  RotateCcw,
  Search,
  SeparatorHorizontal,
  Undo2,
  Ungroup,
} from 'lucide-react'

import { ConfirmDialog } from '@/components/core/Dialog'
import { Button, ListRow, RowGroup, Section, TextInput, type OverflowMenuItem } from '@/components/core/ui'
import {
  addGroup,
  addSeparator,
  canMoveInto,
  childrenAt,
  dissolveGroup,
  findGroupPath,
  flattenLayout,
  hideEntry,
  moveNode,
  moveSibling,
  newGroupId,
  nodeAt,
  pinEntry,
  removeNode,
  resetEntry,
  resetGroup,
  sameLayout,
  samePath,
  showEntry,
  updateGroup,
  type InsertAt,
  type NodePath,
} from '@/lib/contextMenu/edit'
import { DEFAULT_LAYOUT, getContextMenuEntry, type ContextMenuEntryId } from '@/lib/contextMenu/entries'
import type { LayoutGroupNode, MenuLayout } from '@/lib/contextMenu/types'
import { useTranslation } from '@/lib/i18n'

import { entryHint, entryLabel, entrySearchText, groupName, isListedFor, matchesQuery } from './entryText'
import { GroupDialog, type GroupDraft } from './editor/GroupDialog'
import { LayoutRow, type DropPosition } from './editor/LayoutRow'
import { isListedNode, visibleRows, type EditorRow } from './editor/visibleRows'

/** What is being dragged: a node of the layout, or an entry from the Hidden list. */
type Dragged = { kind: 'node'; path: NodePath; key: string } | { kind: 'hidden'; id: ContextMenuEntryId }

interface DropTarget {
  key: string
  position: DropPosition
  at: InsertAt
}

const MAX_UNDO = 50

export interface MenuLayoutEditorProps {
  layout: MenuLayout
  onChange: (next: MenuLayout) => void
  /** What "Reset all", "Reset group" and "Put back" go back to (the template the layout came from). */
  base: MenuLayout
  /** The name of `base` ("Drafting", "the app default"), for the reset confirmation. */
  baseName: string
  /** Admins see admin-only entries; others never see them listed (they are kept in the layout). */
  isAdmin: boolean
  /** A new value clears the undo history (another template opened). */
  historyKey?: string
}

/**
 * The full right-click menu editor: every entry, group and separator as a tree, with drag and drop
 * (before, after or inside a group, and into or out of Hidden) and the same moves without a mouse
 * (buttons on each row and keys on the focused row), groups, separators, undo and resets. Every
 * change is a pure edit from `@/lib/contextMenu/edit`; the caller decides when it is saved.
 */
export function MenuLayoutEditor({ layout, onChange, base, baseName, isAdmin, historyKey }: MenuLayoutEditorProps) {
  const { t } = useTranslation()
  const idPrefix = useId()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set())
  const [selected, setSelected] = useState<string | null>(null)
  const [history, setHistory] = useState<MenuLayout[]>([])
  const [dragged, setDragged] = useState<Dragged | null>(null)
  const [drop, setDrop] = useState<DropTarget | null>(null)
  const [hiddenDrop, setHiddenDrop] = useState(false)
  const [groupDialog, setGroupDialog] = useState<{ path: NodePath | null } | null>(null)
  const [confirmResetAll, setConfirmResetAll] = useState(false)
  const focusAfter = useRef<string | null>(null)

  useEffect(() => {
    setHistory([])
  }, [historyKey])

  // Defaults for putting entries and groups back: the base where it has them, else the app's.
  const placeDefaults = base

  const domId = (key: string) => `${idPrefix}-row-${key.replace(/[^A-Za-z0-9_-]/g, '_')}`

  useEffect(() => {
    const key = focusAfter.current
    if (!key) return
    focusAfter.current = null
    document.getElementById(domId(key))?.focus()
  })

  /**
   * Store an edit (with undo). `selectKey` keeps that row selected; `focus` also moves the keyboard
   * focus to it, for edits made with keys on the row (a mouse edit leaves the focus where it is).
   */
  const apply = (next: MenuLayout, selectKey?: string, focus = false) => {
    if (sameLayout(next, layout)) return
    setHistory((h) => [...h.slice(-(MAX_UNDO - 1)), layout])
    if (selectKey) {
      if (focus) focusAfter.current = selectKey
      setSelected(selectKey)
    }
    onChange(next)
  }

  const undo = () => {
    const previous = history[history.length - 1]
    if (!previous) return
    setHistory((h) => h.slice(0, -1))
    onChange(previous)
  }

  const matches = useMemo(() => {
    if (!query.trim()) return null
    const set = new Set<ContextMenuEntryId>()
    for (const row of flattenLayout(layout)) {
      if (row.node.kind === 'entry' && matchesQuery(entrySearchText(t, row.node.id), query)) set.add(row.node.id)
    }
    return set
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, query])

  const rows = useMemo(() => visibleRows(layout, { isAdmin, open, matches }), [layout, isAdmin, open, matches])

  const hiddenIds = layout.hidden.filter((id) => isListedFor(getContextMenuEntry(id), isAdmin))
  const hiddenMatches = matches
    ? hiddenIds.filter((id) => matchesQuery(entrySearchText(t, id), query))
    : hiddenIds

  const skipUnlisted = (node: Parameters<typeof isListedNode>[0]) => !isListedNode(node, isAdmin)

  /** Whether a node has a sibling it can swap with, or a group to step out of, that way. */
  const canStep = (path: NodePath, direction: -1 | 1) => {
    if (path.length > 1) return true
    const list = childrenAt(layout, path.slice(0, -1)) ?? []
    let i = path[path.length - 1] + direction
    while (i >= 0 && i < list.length && skipUnlisted(list[i])) i += direction
    return i >= 0 && i < list.length
  }

  const groups = useMemo(
    () =>
      flattenLayout(layout).flatMap((row) =>
        row.node.kind === 'group' ? [{ path: row.path, group: row.node as LayoutGroupNode }] : [],
      ),
    [layout],
  )

  const toggle = (id: string, force?: boolean) =>
    setOpen((current) => {
      const next = new Set(current)
      const shouldOpen = force ?? !next.has(id)
      if (shouldOpen) next.add(id)
      else next.delete(id)
      return next
    })

  // ── Commands on one row ───────────────────────────────────────────────
  const moveInto = (row: Extract<EditorRow, { kind: 'node' }>, groupPath: NodePath, groupId: string) => {
    const size = childrenAt(layout, groupPath)?.length ?? 0
    toggle(groupId, true)
    apply(moveNode(layout, row.path, { parent: groupPath, index: size }), row.key)
  }

  const moreItems = (row: Extract<EditorRow, { kind: 'node' }>): OverflowMenuItem[] => {
    const items: OverflowMenuItem[] = []
    const parent = row.path.slice(0, -1)
    for (const { path, group } of groups) {
      if (samePath(path, parent) || samePath(path, row.path)) continue
      if (!canMoveInto(layout, row.path, path)) continue
      items.push({
        id: `into-${group.id}`,
        label: t('contextMenuCustomizer.editor.moveInto', { name: groupName(t, group) }),
        icon: <FolderInput size={14} />,
        onSelect: () => moveInto(row, path, group.id),
      })
    }
    if (row.path.length > 1) {
      items.push({
        id: 'out',
        label: t('contextMenuCustomizer.editor.moveToTopLevel'),
        icon: <CornerLeftUp size={14} />,
        onSelect: () => {
          const groupPath = row.path.slice(0, -1)
          apply(
            moveNode(layout, row.path, { parent: groupPath.slice(0, -1), index: groupPath[groupPath.length - 1] + 1 }),
            row.key,
          )
        },
      })
    }
    const node = row.node
    if (node.kind === 'entry') {
      items.push({
        id: 'reset',
        label: t('contextMenuCustomizer.editor.putBack'),
        icon: <RotateCcw size={14} />,
        onSelect: () => apply(resetEntry(layout, node.id, placeDefaults), row.key),
      })
    }
    if (node.kind === 'group') {
      if (node.builtin) {
        items.push({
          id: 'resetGroup',
          label: t('contextMenuCustomizer.editor.resetGroup'),
          icon: <RotateCcw size={14} />,
          onSelect: () =>
            apply(resetGroup(layout, node.id, findGroupPath(base, node.id) ? base : DEFAULT_LAYOUT), row.key),
        })
      }
      items.push({
        id: 'dissolve',
        label: t('contextMenuCustomizer.editor.dissolve'),
        icon: <Ungroup size={14} />,
        onSelect: () => apply(dissolveGroup(layout, row.path)),
      })
    }
    return items
  }

  const step = (row: Extract<EditorRow, { kind: 'node' }>, direction: -1 | 1, focus = false) => {
    // A separator's key is its path, so only entries and groups keep the focus as they move.
    apply(moveSibling(layout, row.path, direction, skipUnlisted), row.node.kind === 'separator' ? undefined : row.key, focus)
  }

  const onRowKeyDown = (row: EditorRow, index: number) => (event: KeyboardEvent<HTMLElement>) => {
    if (row.kind !== 'node') return
    const node = row.node
    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault()
      step(row, event.key === 'ArrowUp' ? -1 : 1, true)
      return
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      const direction = event.key === 'ArrowUp' ? -1 : 1
      for (let i = index + direction; i >= 0 && i < rows.length; i += direction) {
        const target = rows[i]
        if (target.kind === 'node') {
          setSelected(target.key)
          document.getElementById(domId(target.key))?.focus()
          break
        }
      }
      return
    }
    if (node.kind === 'group' && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
      event.preventDefault()
      toggle(node.id, event.key === 'ArrowRight')
      return
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return
    const key = event.key.toLowerCase()
    if (node.kind === 'entry' && key === 'p') {
      event.preventDefault()
      apply(pinEntry(layout, node.id), row.key, true)
    } else if (node.kind === 'entry' && (key === 'h' || event.key === 'Delete')) {
      event.preventDefault()
      apply(hideEntry(layout, node.id))
    } else if (node.kind === 'separator' && event.key === 'Delete') {
      event.preventDefault()
      apply(removeNode(layout, row.path))
    }
  }

  // ── Drag and drop ─────────────────────────────────────────────────────
  const dropAllowed = (parent: NodePath) =>
    !dragged || dragged.kind === 'hidden' || canMoveInto(layout, dragged.path, parent)

  const onRowDragOver = (row: EditorRow) => (event: DragEvent<HTMLDivElement>) => {
    if (!dragged) return
    const rect = event.currentTarget.getBoundingClientRect()
    const y = (event.clientY - rect.top) / Math.max(1, rect.height)
    let target: DropTarget | null = null
    if (row.kind === 'empty') {
      target = { key: row.key, position: 'inside', at: { parent: row.groupPath, index: 0 } }
    } else {
      if (dragged.kind === 'node' && (samePath(row.path, dragged.path) || isInside(row.path, dragged.path))) {
        setDrop(null)
        return
      }
      const parent = row.path.slice(0, -1)
      const index = row.path[row.path.length - 1]
      if (row.node.kind === 'group' && y > 0.3) {
        const isOpen = !!matches || open.has(row.node.id)
        target = {
          key: row.key,
          position: 'inside',
          at: { parent: row.path, index: isOpen ? 0 : row.node.children.length },
        }
      } else if (y < 0.5) {
        target = { key: row.key, position: 'before', at: { parent, index } }
      } else {
        target = { key: row.key, position: 'after', at: { parent, index: index + 1 } }
      }
    }
    if (!dropAllowed(target.at.parent)) {
      setDrop(null)
      return
    }
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    if (!drop || drop.key !== target.key || drop.position !== target.position) setDrop(target)
  }

  const finishDrag = () => {
    setDragged(null)
    setDrop(null)
    setHiddenDrop(false)
  }

  const onDropOnTree = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    const target = drop
    const source = dragged
    finishDrag()
    if (!target || !source) return
    if (target.position === 'inside') {
      const group = nodeAt(layout, target.at.parent)
      if (group?.kind === 'group') toggle(group.id, true)
    }
    if (source.kind === 'hidden') {
      apply(showEntry(layout, source.id, target.at), `e:${source.id}`)
      return
    }
    apply(moveNode(layout, source.path, target.at), source.key.startsWith('s:') ? undefined : source.key)
  }

  const onDropOnHidden = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    const source = dragged
    finishDrag()
    if (!source || source.kind !== 'node') return
    const node = nodeAt(layout, source.path)
    if (node?.kind === 'entry') apply(hideEntry(layout, node.id))
    else if (node?.kind === 'separator') apply(removeNode(layout, source.path))
  }

  const startDrag = (value: Dragged, key: string) => (event: DragEvent<HTMLDivElement>) => {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', key)
    setDragged(value)
  }

  // ── Toolbar ───────────────────────────────────────────────────────────
  /** After the selected row (in its container), else at the top of the menu. */
  const insertionPoint = (): InsertAt => {
    const row = rows.find((r) => r.kind === 'node' && r.key === selected)
    if (row && row.kind === 'node') {
      if (row.node.kind === 'group' && open.has(row.node.id)) return { parent: row.path, index: 0 }
      return { parent: row.path.slice(0, -1), index: row.path[row.path.length - 1] + 1 }
    }
    return { parent: [], index: 0 }
  }

  const submitGroup = (draft: GroupDraft) => {
    const editingPath = groupDialog?.path ?? null
    setGroupDialog(null)
    if (editingPath) {
      apply(updateGroup(layout, editingPath, { label: draft.label, icon: draft.icon, display: draft.display }))
      return
    }
    const id = newGroupId(layout)
    const at = insertionPoint()
    const fitsHere = at.parent.length < 3
    toggle(id, true)
    apply(
      addGroup(layout, {
        id,
        label: draft.label.trim(),
        icon: draft.icon ?? undefined,
        display: at.parent.length > 0 && (draft.display === 'collapsed' || draft.display === 'auto') ? 'inline' : draft.display,
        at: fitsHere ? at : { parent: [], index: 0 },
      }),
      `g:${id}`,
    )
  }

  const editingGroup = (() => {
    if (!groupDialog?.path) return null
    const node = nodeAt(layout, groupDialog.path)
    if (node?.kind !== 'group') return null
    return {
      builtin: node.builtin,
      topLevel: groupDialog.path.length === 1,
      draft: { label: node.label ?? '', icon: node.icon ?? null, display: node.display },
    }
  })()

  return (
    <>
      <Section
        title={t('contextMenuCustomizer.editor.title')}
        description={t('contextMenuCustomizer.editor.description')}
        actions={
          <>
            <Button size="sm" variant="ghost" icon={<Undo2 size={14} />} disabled={history.length === 0} onClick={undo}>
              {t('contextMenuCustomizer.editor.undo')}
            </Button>
            <Button size="sm" icon={<RotateCcw size={14} />} onClick={() => setConfirmResetAll(true)}>
              {t('contextMenuCustomizer.editor.resetAll')}
            </Button>
          </>
        }
      >
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search
              size={14}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ui-fg-secondary"
              aria-hidden
            />
            <TextInput
              size="sm"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('contextMenuCustomizer.editor.search')}
              aria-label={t('contextMenuCustomizer.editor.search')}
              className="pl-8"
            />
          </div>
          <Button size="sm" icon={<FolderPlus size={14} />} onClick={() => setGroupDialog({ path: null })}>
            {t('contextMenuCustomizer.editor.addGroup')}
          </Button>
          <Button
            size="sm"
            icon={<SeparatorHorizontal size={14} />}
            onClick={() => {
              const at = insertionPoint()
              apply(addSeparator(layout, at))
            }}
          >
            {t('contextMenuCustomizer.editor.addSeparator')}
          </Button>
        </div>

        <div className="mt-3" onDragLeave={(e) => e.currentTarget === e.target && setDrop(null)}>
          {rows.length === 0 ? (
            <p className="py-3 text-[14px] text-ui-fg-secondary">
              {t('contextMenuCustomizer.editor.noMatches', { query: query.trim() })}
            </p>
          ) : (
            <RowGroup>
              {rows.map((row, index) => (
                <LayoutRow
                  key={row.key}
                  row={row}
                  domId={domId(row.key)}
                  isAdmin={isAdmin}
                  selected={row.kind === 'node' && selected === row.key}
                  open={row.kind === 'node' && row.node.kind === 'group' && (!!matches || open.has(row.node.id))}
                  drop={drop?.key === row.key ? drop.position : null}
                  dragging={dragged?.kind === 'node' && row.kind === 'node' && isInside(row.path, dragged.path, true)}
                  canMoveUp={row.kind === 'node' && canStep(row.path, -1)}
                  canMoveDown={row.kind === 'node' && canStep(row.path, 1)}
                  moreItems={row.kind === 'node' ? moreItems(row) : []}
                  onSelect={() => row.kind === 'node' && setSelected(row.key)}
                  onToggle={() => row.kind === 'node' && row.node.kind === 'group' && toggle(row.node.id)}
                  onMoveUp={() => row.kind === 'node' && step(row, -1)}
                  onMoveDown={() => row.kind === 'node' && step(row, 1)}
                  onPin={() => row.kind === 'node' && row.node.kind === 'entry' && apply(pinEntry(layout, row.node.id), row.key)}
                  onHide={() => row.kind === 'node' && row.node.kind === 'entry' && apply(hideEntry(layout, row.node.id))}
                  onEditGroup={() => row.kind === 'node' && setGroupDialog({ path: row.path })}
                  onRemoveSeparator={() => row.kind === 'node' && apply(removeNode(layout, row.path))}
                  onKeyDown={onRowKeyDown(row, index)}
                  onDragStart={
                    row.kind === 'node' ? startDrag({ kind: 'node', path: row.path, key: row.key }, row.key) : () => {}
                  }
                  onDragEnd={finishDrag}
                  onDragOver={onRowDragOver(row)}
                  onDrop={onDropOnTree}
                />
              ))}
            </RowGroup>
          )}
          {/* The end of the menu: drop here to put something last. */}
          {dragged && !matches && (
            <div
              className={`flex h-8 items-center px-3 text-[13px] text-ui-fg-tertiary ${
                drop?.key === 'end' ? 'border-t-2 border-ui-accent' : 'border-t border-ui-divider'
              }`}
              onDragOver={(event) => {
                if (dragged.kind === 'node' && !canMoveInto(layout, dragged.path, [])) return
                event.preventDefault()
                if (drop?.key !== 'end') setDrop({ key: 'end', position: 'after', at: { parent: [], index: layout.nodes.length } })
              }}
              onDrop={onDropOnTree}
            >
              <ArrowDownToLine size={14} className="mr-2" aria-hidden />
            </div>
          )}
        </div>
      </Section>

      <Section
        title={t('contextMenuCustomizer.editor.hiddenTitle')}
        description={t('contextMenuCustomizer.editor.hiddenDescription')}
      >
        <div
          className={`mt-3 rounded-lg border border-dashed transition-colors duration-100 ${
            hiddenDrop ? 'border-ui-accent bg-ui-accent/10' : 'border-ui-border'
          }`}
          onDragOver={(event) => {
            if (dragged?.kind !== 'node') return
            const node = nodeAt(layout, dragged.path)
            if (node?.kind === 'group') return
            event.preventDefault()
            setHiddenDrop(true)
          }}
          onDragLeave={(e) => e.currentTarget === e.target && setHiddenDrop(false)}
          onDrop={onDropOnHidden}
        >
          {hiddenMatches.length === 0 ? (
            <p className="flex items-center gap-2 px-3 py-3 text-[13px] text-ui-fg-secondary">
              <Minus size={14} aria-hidden />
              {t(hiddenDrop ? 'contextMenuCustomizer.editor.dropToHide' : 'contextMenuCustomizer.editor.hiddenEmpty')}
            </p>
          ) : (
            <RowGroup>
              {hiddenMatches.map((id) => {
                const def = getContextMenuEntry(id)
                const Icon = def.icon
                return (
                  <div
                    key={id}
                    draggable
                    onDragStart={startDrag({ kind: 'hidden', id }, `h:${id}`)}
                    onDragEnd={finishDrag}
                  >
                    <ListRow
                      leading={<Icon size={16} />}
                      title={entryLabel(t, id)}
                      secondary={entryHint(t, id)}
                      actionsVisible
                      actions={
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => apply(showEntry(layout, id, undefined, placeDefaults), `e:${id}`)}
                        >
                          {t('contextMenuCustomizer.editor.show')}
                        </Button>
                      }
                    />
                  </div>
                )
              })}
            </RowGroup>
          )}
        </div>
      </Section>

      <GroupDialog
        open={groupDialog !== null}
        editing={editingGroup}
        onSubmit={submitGroup}
        onClose={() => setGroupDialog(null)}
      />
      <ConfirmDialog
        open={confirmResetAll}
        onClose={() => setConfirmResetAll(false)}
        title={t('contextMenuCustomizer.editor.resetAllTitle')}
        message={t('contextMenuCustomizer.editor.resetAllBody', { name: baseName })}
        confirmText={t('contextMenuCustomizer.editor.resetAllYes')}
        cancelText={t('contextMenuCustomizer.page.cancel')}
        variant="danger"
        onConfirm={() => {
          setConfirmResetAll(false)
          apply(base)
        }}
      />
    </>
  )
}

/** `path` lies inside `ancestor` (or is it, with `self`). */
function isInside(path: NodePath, ancestor: NodePath, self = false): boolean {
  if (path.length < ancestor.length || (!self && path.length === ancestor.length)) return false
  return ancestor.every((value, i) => value === path[i])
}
