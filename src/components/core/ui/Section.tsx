import type { ReactNode } from 'react'

export type SectionDensity = 'default' | 'compact'

interface SectionProps {
  title?: ReactNode
  description?: ReactNode
  /** Buttons shown on the right of the heading ("Add", "Refresh", "See all"). */
  actions?: ReactNode
  children?: ReactNode
  /**
   * `default`: 16px heading, as in settings pages. `compact`: 14px heading and 13px description,
   * for narrow panes (the right panel).
   */
  density?: SectionDensity
  className?: string
}

/**
 * A titled part of a page or pane: heading, an optional sentence under it, and its content
 * (usually one RowGroup). No box and no fill; hierarchy comes from type size and grey level.
 */
export function Section({
  title,
  description,
  actions,
  children,
  density = 'default',
  className = '',
}: SectionProps) {
  const compact = density === 'compact'
  const heading = compact
    ? 'text-[14px] font-semibold leading-5 text-ui-fg'
    : 'text-[16px] font-semibold leading-6 text-ui-fg'
  const text = compact
    ? 'text-[13px] leading-[1.4] text-ui-fg-secondary'
    : 'text-[14px] leading-[1.4] text-ui-fg-secondary'
  return (
    <section className={className}>
      {(title || actions) && (
        <div className={`flex items-end justify-between gap-4 ${compact ? 'pb-0.5' : 'pb-1'}`}>
          <div className="min-w-0">
            {title && <h3 className={heading}>{title}</h3>}
            {description && <p className={`mt-1 ${text}`}>{description}</p>}
          </div>
          {actions && <div className="flex flex-shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      {!title && !actions && description && <p className={`pb-1 ${text}`}>{description}</p>}
      {children}
    </section>
  )
}

export type PageGap = 'default' | 'tight'

/** The body of a page or pane: its sections, 40px apart (`tight`: 24px, for panes). */
export function Page({
  children,
  gap = 'default',
  className = '',
}: {
  children: ReactNode
  gap?: PageGap
  className?: string
}) {
  return (
    <div className={`${gap === 'tight' ? 'space-y-6' : 'space-y-10'} ${className}`}>{children}</div>
  )
}
