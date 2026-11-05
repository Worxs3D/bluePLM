import { Fragment, type ReactNode } from 'react'

/**
 * A row's secondary line: short parts ("v4", "Rev B", "Changes requested", "2 comments") joined
 * by a tertiary " · ". The dot is glued to the end of the part before it (a no-break space), so a
 * line that wraps never starts with a dot; a part longer than the line still wraps between words.
 */
export function MetaLine({ parts, className = '' }: { parts: ReactNode[]; className?: string }) {
  const shown = parts.filter((p) => p !== null && p !== undefined && p !== false && p !== '')
  return (
    <span className={className}>
      {shown.map((part, index) => (
        <Fragment key={index}>
          {part}
          {index < shown.length - 1 && (
            <>
              <span className="text-ui-fg-tertiary">{' ·'}</span>{' '}
            </>
          )}
        </Fragment>
      ))}
    </span>
  )
}
