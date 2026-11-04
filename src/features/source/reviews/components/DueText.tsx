/**
 * A review's due date in words: "Due today" / "Due in 3 days" in warning text when close, later
 * dates in secondary text, and a tinted Badge only for overdue (the one state that needs it).
 */

import { Badge } from '@/components/core/ui'
import { t } from '@/lib/i18n'

import { dueChip, formatDateOnly, localDateString } from '../lib/queueChips'
import { intlLocale } from '../lib/reviewDates'

export function dueLabel(days: number, tone: 'overdue' | 'today' | 'soon' | 'later'): string {
  if (tone === 'overdue')
    return days === -1
      ? t('reviewQueue.due.overdueOne')
      : t('reviewQueue.due.overdue', { count: -days })
  if (tone === 'today') return t('reviewQueue.due.today')
  if (days === 1) return t('reviewQueue.due.tomorrow')
  return t('reviewQueue.due.inDays', { count: days })
}

export function DueText({ dueDate, overdue }: { dueDate: string | null; overdue: boolean }) {
  const chip = dueChip(dueDate, localDateString(), overdue)
  if (!chip || !dueDate) return null
  const label = dueLabel(chip.days, chip.tone)
  const title = formatDateOnly(dueDate, intlLocale())
  if (chip.tone === 'overdue') {
    return (
      <Badge tone="error" title={title}>
        {label}
      </Badge>
    )
  }
  return (
    <span
      title={title}
      className={chip.tone === 'later' ? 'text-ui-fg-secondary' : 'text-ui-warning'}
    >
      {label}
    </span>
  )
}
