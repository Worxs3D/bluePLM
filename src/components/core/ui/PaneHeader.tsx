import type { ReactNode } from 'react'

interface PaneHeaderProps {
  title: ReactNode
  /** Shown after the title in secondary grey ("3 files"). */
  count?: ReactNode
  /** IconButtons and an OverflowMenu, right-aligned. */
  actions?: ReactNode
  className?: string
}

/** The 44px title bar of a side pane: title, an optional count, actions, and a hairline below. */
export function PaneHeader({ title, count, actions, className = '' }: PaneHeaderProps) {
  return (
    <div
      className={`flex h-11 flex-shrink-0 items-center gap-2 border-b border-ui-border pl-4 pr-2 ${className}`}
    >
      <h2 className="min-w-0 truncate text-[14px] font-semibold leading-5 text-ui-fg">{title}</h2>
      {count !== undefined && count !== null && count !== '' && (
        <span className="flex-shrink-0 text-[13px] text-ui-fg-secondary">{count}</span>
      )}
      {actions && <div className="ml-auto flex flex-shrink-0 items-center gap-0.5">{actions}</div>}
    </div>
  )
}
