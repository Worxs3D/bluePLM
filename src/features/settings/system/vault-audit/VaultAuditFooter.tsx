/**
 * The bottom bar of the findings card: what is selected on the left, the write on the right.
 *
 * Every category's action bar renders through this, so the button is always in the same place and
 * the sentences around it follow one order: the explanation behind a "How this works" toggle (worth
 * reading once, in the way every time after), then anything about the current selection that has
 * to be read before the click (warnings, a receipt), then the bar itself.
 */

import { useState, type ReactNode } from 'react'
import { ChevronDown, Info, type LucideIcon } from 'lucide-react'

import { t } from '@/lib/i18n'

interface VaultAuditFooterProps {
  /** The explanation, folded. */
  note?: { icon?: LucideIcon; content: ReactNode }
  /** Warnings, errors and receipts: always shown, above the bar. */
  messages?: ReactNode
  /** Left side: the selection, or the prompt when nothing is selected. */
  summary: ReactNode
  /** Right side: the buttons. */
  actions?: ReactNode
}

export function VaultAuditFooter({ note, messages, summary, actions }: VaultAuditFooterProps) {
  const [open, setOpen] = useState(false)
  const NoteIcon = note?.icon ?? Info

  return (
    <div className="space-y-2.5">
      {note && open && (
        <div className="flex items-start gap-2 rounded-lg bg-ui-field px-3 py-2.5 text-[13px] leading-5 text-ui-fg-secondary">
          <NoteIcon size={14} className="mt-0.5 flex-shrink-0 text-ui-fg-tertiary" />
          <div className="space-y-2">{note.content}</div>
        </div>
      )}
      {messages}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
          {summary}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {note && (
            <button
              type="button"
              onClick={() => setOpen((current) => !current)}
              aria-expanded={open}
              className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[13px] text-ui-fg-secondary hover:bg-ui-hover hover:text-ui-fg"
            >
              <Info size={13} />
              {t('vaultAudit.actions.howItWorks')}
              <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
          )}
          {actions}
        </div>
      </div>
    </div>
  )
}

/** A sentence about the selection that has to be read before the click. */
export function FooterMessage({
  icon: Icon,
  tone = 'secondary',
  children,
}: {
  icon?: LucideIcon
  tone?: 'secondary' | 'warning' | 'danger'
  children: ReactNode
}) {
  const color =
    tone === 'warning' ? 'text-ui-warning' : tone === 'danger' ? 'text-ui-danger' : 'text-ui-fg-secondary'
  return (
    <p className={`flex items-start gap-1.5 text-[13px] leading-5 ${color}`}>
      {Icon && <Icon size={13} className="mt-1 flex-shrink-0" />}
      <span>{children}</span>
    </p>
  )
}
