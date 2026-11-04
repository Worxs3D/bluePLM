import type { ReactNode } from 'react'

interface EmptyStateProps {
  title: ReactNode
  description?: ReactNode
  /** Buttons, left to right; the first is usually the primary. */
  actions?: ReactNode
  align?: 'start' | 'center'
  className?: string
}

/** An empty, error or signed-out state: a line of text, a sentence and buttons. No illustration. */
export function EmptyState({
  title,
  description,
  actions,
  align = 'start',
  className = '',
}: EmptyStateProps) {
  const center = align === 'center'
  return (
    <div className={`${center ? 'text-center' : ''} ${className}`}>
      <div className="text-[14px] font-medium leading-5 text-ui-fg">{title}</div>
      {description && (
        <div className="mt-1 text-[14px] leading-[1.4] text-ui-fg-secondary">{description}</div>
      )}
      {actions && (
        <div className={`mt-3 flex flex-wrap gap-2 ${center ? 'justify-center' : ''}`}>
          {actions}
        </div>
      )}
    </div>
  )
}
