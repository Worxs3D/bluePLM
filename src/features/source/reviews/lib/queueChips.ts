/**
 * Due-date and priority chips for the review queue, and the date-only helpers behind them.
 *
 * A review's due date is a calendar date (`YYYY-MM-DD`, Postgres `date`). It is never turned into
 * an instant: parsing it with `new Date('2026-10-30')` reads it as UTC midnight, which west of UTC
 * is the evening before, so the chip said "Oct 29" and went overdue a day early (audit H9). Here a
 * date is compared as a date against the viewer's local calendar day.
 */

import type { ReviewPriority, ReviewQueueRow } from '@/types/reviews'

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/
const MS_PER_DAY = 86_400_000
/** A due date this many days away or fewer is "due soon". */
export const DUE_SOON_DAYS = 2

/** Today's calendar date in the viewer's time zone, `YYYY-MM-DD`. */
export function localDateString(now: Date = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** A `YYYY-MM-DD` date as local midnight, for display; null when it is not one. */
export function parseDateOnly(value: string | null | undefined): Date | null {
  const match = value ? DATE_ONLY.exec(value) : null
  if (!match) return null
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

/** Whole days from `today` to `due` (negative when past). Null when either is not a date. */
export function daysBetween(today: string, due: string): number | null {
  const a = DATE_ONLY.exec(today)
  const b = DATE_ONLY.exec(due)
  if (!a || !b) return null
  const ta = Date.UTC(Number(a[1]), Number(a[2]) - 1, Number(a[3]))
  const tb = Date.UTC(Number(b[1]), Number(b[2]) - 1, Number(b[3]))
  return Math.round((tb - ta) / MS_PER_DAY)
}

/** Format a `YYYY-MM-DD` date for display without shifting it a day. */
export function formatDateOnly(value: string | null | undefined, locale?: string): string {
  const date = parseDateOnly(value)
  if (!date) return ''
  return date.toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' })
}

export type DueTone = 'overdue' | 'today' | 'soon' | 'later'

export interface DueChip {
  tone: DueTone
  /** Days until due (negative when overdue). */
  days: number
}

/**
 * The due chip for an open review. `serverOverdue` is the server's own `due_date < current_date`;
 * either side saying overdue wins, so a clock or zone difference cannot hide an overdue review.
 */
export function dueChip(
  dueDate: string | null,
  today: string,
  serverOverdue = false,
): DueChip | null {
  if (!dueDate) return null
  const days = daysBetween(today, dueDate)
  if (days === null) return null
  if (days < 0 || serverOverdue) return { tone: 'overdue', days: Math.min(days, -1) }
  if (days === 0) return { tone: 'today', days }
  if (days <= DUE_SOON_DAYS) return { tone: 'soon', days }
  return { tone: 'later', days }
}

/** Priorities worth a chip: `normal` is the default and shows nothing. */
export function priorityChip(priority: ReviewPriority): ReviewPriority | null {
  return priority === 'normal' ? null : priority
}

const OPEN_STATUSES: ReadonlySet<string> = new Set(['open', 'changes_requested'])

export interface QueueRowChips {
  due: DueChip | null
  priority: ReviewPriority | null
  /** "3 of 12 decided". Null for gate rows. */
  progress: { decided: number; total: number } | null
}

/** Everything the queue row shows as chips. Closed reviews show no due chip. */
export function queueRowChips(row: ReviewQueueRow, today: string): QueueRowChips {
  const open = OPEN_STATUSES.has(row.status)
  return {
    due: open ? dueChip(row.dueDate, today, row.overdue) : null,
    priority: open ? priorityChip(row.priority) : null,
    progress: row.kind === 'package' ? { decided: row.itemsDecided, total: row.itemCount } : null,
  }
}
