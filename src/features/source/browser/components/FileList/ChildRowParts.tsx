import type { ReactNode } from 'react'

/**
 * The shared look of the rows under an expanded file (referenced files, outputs, inspection
 * reports): one indent, one connector, a 14 px icon, the name at the parent's size and every other
 * column at 12 px. Columns a child row has no value for stay empty rather than repeating dashes.
 */
export const CHILD_INDENT_PX = 24 + 16

export function ChildNameCell({
  rowHeight,
  icon,
  label,
  title,
  muted = false,
  italic = false,
  before,
  after,
  indentPx = CHILD_INDENT_PX,
}: {
  rowHeight: number
  icon: ReactNode
  label: ReactNode
  title?: string
  muted?: boolean
  italic?: boolean
  /** Between the connector and the icon (an expand chevron). */
  before?: ReactNode
  /** After the name (a configuration or status chip). */
  after?: ReactNode
  indentPx?: number
}) {
  return (
    <div
      className="flex min-w-0 items-center gap-1.5"
      style={{ minHeight: rowHeight - 8, paddingLeft: `${indentPx}px` }}
    >
      <span className="w-2.5 shrink-0 text-[10px] text-plm-fg-dim/70">├</span>
      {before}
      <span className="flex w-3.5 shrink-0 justify-center">{icon}</span>
      <span
        className={`min-w-0 truncate text-sm ${muted ? 'text-plm-fg-muted' : 'text-plm-fg'} ${italic ? 'pr-0.5 italic' : ''}`}
        title={title}
      >
        {label}
      </span>
      {after}
    </div>
  )
}

/** A data column of a child row: 12 px, truncated with the full text as its tooltip. */
export function ChildText({
  children,
  title,
  muted = false,
}: {
  children: ReactNode
  title?: string
  muted?: boolean
}) {
  return (
    <span
      className={`block truncate text-xs ${muted ? 'text-plm-fg-muted' : 'text-plm-fg-dim'}`}
      title={title ?? (typeof children === 'string' ? children : undefined)}
    >
      {children}
    </span>
  )
}

/** A small chip after a child row's name (configuration, kind). */
export function ChildChip({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span
      className="shrink-0 rounded bg-plm-bg-light px-1 py-px text-[10px] text-plm-fg-muted"
      title={title}
    >
      {children}
    </span>
  )
}
