/** Dates and labels as the Orders screens show them ("2 Nov", "2 Nov 2025"). */

import type { OrderOutputKind, OrderStatus } from '@/types/orders'
import type { StatusTone } from '@/components/core/ui'

/**
 * A short date: day and month, plus the year when it is not this year. Accepts an ISO timestamp
 * or a `YYYY-MM-DD` date (read as a calendar day, not midnight UTC). Null for no or bad input.
 */
export function shortDate(
  value: string | null | undefined,
  locale?: string,
  now: Date = new Date(),
): string | null {
  if (!value) return null
  const dayOnly = /^\d{4}-\d{2}-\d{2}$/.test(value)
  const date = dayOnly ? new Date(`${value}T12:00:00`) : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }
  if (date.getFullYear() !== now.getFullYear()) options.year = 'numeric'
  try {
    return date.toLocaleDateString(locale, options)
  } catch {
    // An app language that is not a BCP 47 tag (Sindarin) falls back to the system locale.
    return date.toLocaleDateString(undefined, options)
  }
}

/** The tone of each status in words (StatusText). */
export const STATUS_TONE: Record<OrderStatus, StatusTone> = {
  draft: 'neutral',
  sent: 'accent',
  received: 'success',
  closed: 'success',
  cancelled: 'warning',
}

/** The i18n key of a kind's short label (`orders.kind_pdf` = "PDF"). */
export function kindKey(kind: OrderOutputKind): string {
  return `orders.kind_${kind}`
}
