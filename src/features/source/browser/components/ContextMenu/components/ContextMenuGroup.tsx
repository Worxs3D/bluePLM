/**
 * Context menu group component with submenu
 * Groups related actions under a single menu item that expands on hover
 */
import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { ContextSubmenu } from './ContextSubmenu'
import { FlyoutProvider, useFlyout } from '../customizable/flyout'
import { SubmenuArrow } from './SubmenuArrow'

interface ContextMenuGroupProps {
  label: string
  icon: LucideIcon
  iconColorClass?: string
  children: ReactNode
  /** Whether this group has any visible items. If false, the group won't render */
  hasItems?: boolean
  /** Minimum width for the submenu */
  minWidth?: number
  /** Names this flyout among its siblings (one open at a time); defaults to the label. */
  flyoutKey?: string
}

export function ContextMenuGroup({
  label,
  icon: Icon,
  iconColorClass = '',
  children,
  hasItems = true,
  minWidth = 180,
  flyoutKey,
}: ContextMenuGroupProps) {
  const flyout = useFlyout(flyoutKey ?? `group:${label}`)

  // Don't render if no items
  if (!hasItems) {
    return null
  }

  return (
    <div
      className="context-menu-item relative"
      onMouseEnter={flyout.onMouseEnter}
      onMouseLeave={flyout.onMouseLeave}
      onClick={(e) => {
        e.stopPropagation()
        flyout.toggle()
      }}
    >
      <Icon size={14} className={iconColorClass} />
      {label}
      <SubmenuArrow />

      {flyout.isOpen && (
        <ContextSubmenu
          minWidth={minWidth}
          onMouseEnter={flyout.onMouseEnter}
          onMouseLeave={flyout.onMouseLeave}
        >
          <FlyoutProvider>{children}</FlyoutProvider>
        </ContextSubmenu>
      )}
    </div>
  )
}
