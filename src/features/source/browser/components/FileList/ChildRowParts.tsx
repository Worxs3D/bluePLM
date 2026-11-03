import type { ReactNode } from 'react'
import { History, Loader2, RefreshCw } from 'lucide-react'

import { resolveFileMetadata } from '@/lib/metadata/overlay'
import type { LocalFile } from '@/stores/pdmStore'

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
  status,
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
  /** The status slot at the left edge of the row, under the parent's chevron (`ChildStaleButton`). */
  status?: ReactNode
  indentPx?: number
}) {
  return (
    <div
      className="relative flex min-w-0 items-center gap-1.5"
      style={{ minHeight: rowHeight - 8, paddingLeft: `${indentPx}px` }}
    >
      {status && <span className="absolute left-0 top-1/2 flex -translate-y-1/2">{status}</span>}
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

/**
 * The status slot of an out-of-date child row: a stale mark that turns into a regenerate button
 * on hover, and a spinner while the regeneration runs (`busy`). Without `onRegenerate` (no
 * permission) it is the mark alone, with its explanation.
 */
export function ChildStaleButton({
  title,
  onRegenerate,
  busy = false,
  busyTitle,
}: {
  title: string
  onRegenerate?: () => void
  busy?: boolean
  busyTitle?: string
}) {
  if (busy) {
    return (
      <span className="flex h-4 w-4 items-center justify-center text-plm-fg-muted" title={busyTitle ?? title}>
        <Loader2 size={12} className="animate-spin" />
      </span>
    )
  }
  if (!onRegenerate) {
    return (
      <span className="flex h-4 w-4 items-center justify-center text-amber-400" title={title}>
        <History size={12} />
      </span>
    )
  }
  return (
    <button
      type="button"
      className="group/stale flex h-4 w-4 items-center justify-center rounded text-amber-400 hover:bg-plm-bg-light hover:text-plm-fg"
      title={title}
      onClick={(e) => {
        e.stopPropagation()
        onRegenerate()
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <History size={12} className="group-hover/stale:hidden" />
      <RefreshCw size={12} className="hidden group-hover/stale:block" />
    </button>
  )
}

/**
 * The parent file's item number, revision or description for a child row that belongs to it (an
 * output or report of the file), as the parent row shows them; null for any other column.
 */
export function ParentMetadataText({ file, columnId }: { file: LocalFile; columnId: string }) {
  const metadata = resolveFileMetadata(file)
  const value =
    columnId === 'itemNumber'
      ? metadata.partNumber.value
      : columnId === 'revision'
        ? metadata.revision.value
        : columnId === 'description'
          ? metadata.description.value
          : null
  return value ? <ChildText>{value}</ChildText> : null
}
