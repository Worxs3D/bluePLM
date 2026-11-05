import type { ReactNode } from 'react'

interface RowGroupProps {
  children: ReactNode
  /** Kept for settings callers; a destructive group reads the same, its buttons carry the danger. */
  tone?: 'default' | 'danger'
  className?: string
}

/** Rows (Row or ListRow) with a hairline between each: no box, no fill. */
export function RowGroup({ children, className = '' }: RowGroupProps) {
  return <div className={`divide-y divide-ui-divider ${className}`}>{children}</div>
}
