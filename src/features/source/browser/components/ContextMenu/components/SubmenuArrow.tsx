import { ChevronRight } from 'lucide-react'

/**
 * The arrow at the end of a menu row that opens a flyout. One look for every such row (groups,
 * export formats, the assembly and keep-local-only submenus) in both right-click menus.
 * `data-submenu-arrow` lets tests read the row as "Label▶".
 */
export function SubmenuArrow() {
  return <ChevronRight size={12} aria-hidden data-submenu-arrow="" className="ml-auto flex-shrink-0 text-plm-fg-muted" />
}
