import { useEffect, useRef, useState, type ReactNode } from 'react'
import { MoreHorizontal } from 'lucide-react'

import { useHostWindow } from '@/hooks/useHostWindow'

import { IconButton, type IconButtonSize } from './IconButton'
import { MenuItem, MenuPanel } from './Menu'

export interface OverflowMenuItem {
  id: string
  label: string
  icon?: ReactNode
  onSelect: () => void
  disabled?: boolean
  danger?: boolean
  /** A toggle: a check on the right while on. */
  checked?: boolean
  title?: string
}

interface OverflowMenuProps {
  /** Accessible name and tooltip of the "…" button ("More actions"). */
  label: string
  items: OverflowMenuItem[]
  /** Which edge of the button the menu lines up with (default right). */
  align?: 'left' | 'right'
  size?: IconButtonSize
  disabled?: boolean
  /** The button's icon (default "…"); for a menu of options rather than more actions. */
  icon?: ReactNode
}

/** A "…" IconButton (or `icon`) that opens a small menu. Escape and a click outside close it. */
export function OverflowMenu({
  label,
  items,
  align = 'right',
  size = 'md',
  disabled,
  icon,
}: OverflowMenuProps) {
  const host = useHostWindow()
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    // By type, not `instanceof`: in a pop-out window the events are that window's classes.
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event.type === 'keydown' && (event as KeyboardEvent).key !== 'Escape') return
      if (event.type === 'mousedown' && wrapRef.current?.contains(event.target as Node)) return
      setOpen(false)
    }
    const doc = host.document
    doc.addEventListener('mousedown', close)
    doc.addEventListener('keydown', close)
    return () => {
      doc.removeEventListener('mousedown', close)
      doc.removeEventListener('keydown', close)
    }
  }, [open, host])

  if (items.length === 0) return null

  return (
    <div ref={wrapRef} className="relative">
      <IconButton
        label={label}
        icon={icon ?? <MoreHorizontal size={16} />}
        size={size}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        pressed={open || undefined}
        onClick={() => setOpen((o) => !o)}
      />
      {open && (
        <MenuPanel className={`top-full mt-1 ${align === 'right' ? 'right-0' : 'left-0'}`}>
          {items.map((item) => (
            <MenuItem
              key={item.id}
              label={item.label}
              icon={item.icon}
              disabled={item.disabled}
              danger={item.danger}
              checked={item.checked}
              title={item.title}
              onSelect={() => {
                setOpen(false)
                item.onSelect()
              }}
            />
          ))}
        </MenuPanel>
      )}
    </div>
  )
}
