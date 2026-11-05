/**
 * Expandable section for context menu
 * Shows a "More actions" row that expands to reveal additional options
 */
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { ReactNode } from 'react'
import { t } from '@/lib/i18n'

interface ExpandableSectionProps {
  expanded: boolean
  onToggle: () => void
  children: ReactNode
  /** Number of hidden items to show in the label */
  hiddenCount?: number
  /** Draw a separator above the toggle (default). Off when the menu already ends in one. */
  separator?: boolean
}

export function ExpandableSection({
  expanded,
  onToggle,
  children,
  hiddenCount,
  separator = true,
}: ExpandableSectionProps) {
  return (
    <>
      {/* Expand/Collapse toggle */}
      {separator && <div className="context-menu-separator" />}
      <div
        className="context-menu-expand-toggle"
        onClick={(e) => {
          e.stopPropagation()
          onToggle()
        }}
      >
        {expanded ? (
          <>
            <ChevronUp size={14} />
            <span>{t('contextMenuCustomizer.menu.lessActions')}</span>
          </>
        ) : (
          <>
            <ChevronDown size={14} />
            <span>{t('contextMenuCustomizer.menu.moreActions', { count: hiddenCount ?? 0 })}</span>
          </>
        )}
      </div>

      {/* Expandable content */}
      {expanded && <div className="context-menu-expanded-section">{children}</div>}
    </>
  )
}
