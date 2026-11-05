import type { DragEvent, KeyboardEvent, ReactNode } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, EyeOff, GripVertical, Pencil, Pin, X } from 'lucide-react'

import { Badge, IconButton, ListRow, OverflowMenu, type OverflowMenuItem } from '@/components/core/ui'
import { getContextMenuEntry, groupIcon } from '@/lib/contextMenu/entries'
import { useTranslation } from '@/lib/i18n'
import { hasDesktop } from '@/lib/platform'

import { entryHint, entryLabel, groupName } from '../entryText'
import { listedCount, type EditorRow } from './visibleRows'

export type DropPosition = 'before' | 'after' | 'inside'

/** Left padding per depth (Tailwind needs whole class names). */
const INDENT = ['pl-3', 'pl-9', 'pl-[60px]', 'pl-[84px]'] as const
const LINE_INDENT = ['left-3', 'left-9', 'left-[60px]', 'left-[84px]'] as const

export interface LayoutRowProps {
  row: EditorRow
  domId: string
  isAdmin: boolean
  selected: boolean
  open: boolean
  drop: DropPosition | null
  dragging: boolean
  canMoveUp: boolean
  canMoveDown: boolean
  moreItems: OverflowMenuItem[]
  onSelect: () => void
  onToggle: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onPin: () => void
  onHide: () => void
  onEditGroup: () => void
  onRemoveSeparator: () => void
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void
  onDragStart: (event: DragEvent<HTMLDivElement>) => void
  onDragEnd: () => void
  onDragOver: (event: DragEvent<HTMLDivElement>) => void
  onDrop: (event: DragEvent<HTMLDivElement>) => void
}

/** One row of the layout editor: an entry, a group or a separator, with its controls. */
export function LayoutRow(props: LayoutRowProps) {
  const { t } = useTranslation()
  const { row, depth } = { row: props.row, depth: Math.min(props.row.depth, INDENT.length - 1) }

  const indicator =
    props.drop === 'before' || props.drop === 'after' ? (
      <span
        aria-hidden
        className={`pointer-events-none absolute right-2 z-10 h-0.5 rounded-full bg-ui-accent ${LINE_INDENT[depth]} ${
          props.drop === 'before' ? '-top-px' : '-bottom-px'
        }`}
      />
    ) : null

  const wrap = (content: ReactNode, draggable: boolean) => (
    <div
      className={`relative ${props.drop === 'inside' ? 'bg-ui-accent/10 ring-2 ring-inset ring-ui-accent/60' : ''} ${
        props.dragging ? 'opacity-40' : ''
      }`}
      draggable={draggable}
      onDragStart={props.onDragStart}
      onDragEnd={props.onDragEnd}
      onDragOver={props.onDragOver}
      onDrop={props.onDrop}
      data-editor-row={row.key}
    >
      {indicator}
      {content}
    </div>
  )

  if (row.kind === 'empty') {
    return wrap(
      <div className={`py-2 pr-3 text-[13px] italic text-ui-fg-tertiary ${INDENT[depth]}`}>
        {t('contextMenuCustomizer.editor.groupEmpty')}
      </div>,
      false,
    )
  }

  const moveButtons = (
    <>
      <IconButton
        size="sm"
        label={t('contextMenuCustomizer.editor.moveUp')}
        icon={<ArrowUp size={14} />}
        disabled={!props.canMoveUp}
        onClick={props.onMoveUp}
      />
      <IconButton
        size="sm"
        label={t('contextMenuCustomizer.editor.moveDown')}
        icon={<ArrowDown size={14} />}
        disabled={!props.canMoveDown}
        onClick={props.onMoveDown}
      />
    </>
  )

  const grip = (
    <span className="flex items-center gap-2">
      <GripVertical size={14} className="-ml-1 cursor-grab text-ui-fg-tertiary" />
    </span>
  )

  const node = row.node
  if (node.kind === 'separator') {
    return wrap(
      <ListRow
        id={props.domId}
        className={INDENT[depth]}
        selected={props.selected}
        onActivate={props.onSelect}
        onKeyDown={props.onKeyDown}
        leading={grip}
        title={
          <span className="flex items-center gap-3 text-[13px] text-ui-fg-tertiary">
            <span className="h-px flex-1 bg-ui-border" />
            {t('contextMenuCustomizer.editor.separator')}
            <span className="h-px flex-1 bg-ui-border" />
          </span>
        }
        actionsVisible={props.selected}
        actions={
          <>
            {moveButtons}
            <IconButton
              size="sm"
              label={t('contextMenuCustomizer.editor.removeSeparator')}
              icon={<X size={14} />}
              onClick={props.onRemoveSeparator}
            />
          </>
        }
      />,
      true,
    )
  }

  if (node.kind === 'group') {
    const Icon = groupIcon(node)
    const Chevron = props.open ? ChevronDown : ChevronRight
    const count = listedCount(node, props.isAdmin)
    return wrap(
      <ListRow
        id={props.domId}
        className={INDENT[depth]}
        selected={props.selected}
        onActivate={() => {
          props.onSelect()
          props.onToggle()
        }}
        onKeyDown={props.onKeyDown}
        hint={t(props.open ? 'contextMenuCustomizer.editor.collapse' : 'contextMenuCustomizer.editor.expand')}
        leading={
          <span className="flex items-center gap-1">
            <GripVertical size={14} className="-ml-1 cursor-grab text-ui-fg-tertiary" />
            <Chevron size={14} className="text-ui-fg-tertiary" />
            <Icon size={16} />
          </span>
        }
        title={<span className="font-medium">{groupName(t, node)}</span>}
        secondary={`${t(`contextMenuCustomizer.display.${node.display}`)} · ${t('contextMenuCustomizer.editor.groupCount', { count })}`}
        actionsVisible={props.selected}
        actions={
          <>
            {moveButtons}
            <IconButton
              size="sm"
              label={t('contextMenuCustomizer.editor.editGroup')}
              icon={<Pencil size={14} />}
              onClick={props.onEditGroup}
            />
            <OverflowMenu
              size="sm"
              label={t('contextMenuCustomizer.editor.more', { name: groupName(t, node) })}
              items={props.moreItems}
            />
          </>
        }
      />,
      true,
    )
  }

  const def = getContextMenuEntry(node.id)
  const Icon = def.icon
  const marks: ReactNode[] = []
  if (def.adminOnly) marks.push(<Badge key="admin">{t('contextMenuCustomizer.editor.admin')}</Badge>)
  if (def.desktopOnly && !hasDesktop()) {
    marks.push(<Badge key="desktop">{t('contextMenuCustomizer.editor.desktopOnly')}</Badge>)
  }
  return wrap(
    <ListRow
      id={props.domId}
      className={INDENT[depth]}
      selected={props.selected}
      onActivate={props.onSelect}
      onKeyDown={props.onKeyDown}
      leading={
        <span className="flex items-center gap-2">
          <GripVertical size={14} className="-ml-1 cursor-grab text-ui-fg-tertiary" />
          <Icon size={16} className={def.danger ? 'text-ui-danger' : ''} />
        </span>
      }
      title={entryLabel(t, node.id)}
      secondary={entryHint(t, node.id)}
      trailing={marks.length > 0 ? <span className="flex gap-1">{marks}</span> : undefined}
      actionsVisible={props.selected}
      actions={
        <>
          {moveButtons}
          <IconButton size="sm" label={t('contextMenuCustomizer.editor.pin')} icon={<Pin size={14} />} onClick={props.onPin} />
          <IconButton size="sm" label={t('contextMenuCustomizer.editor.hide')} icon={<EyeOff size={14} />} onClick={props.onHide} />
          <OverflowMenu
            size="sm"
            label={t('contextMenuCustomizer.editor.more', { name: entryLabel(t, node.id) })}
            items={props.moreItems}
          />
        </>
      }
    />,
    true,
  )
}
