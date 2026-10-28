/**
 * A workflow gate waiting on me, in the Awaiting me bucket. Gates keep their own contract: the
 * decision goes through `complete_gate_review` (`submitReviewDecision`), which also moves the file
 * once the last blocking gate clears. Kick back and reject need a comment, as package decisions do.
 */

import { useState } from 'react'
import { ArrowRight, CheckCircle2, Loader2, ShieldCheck, Undo2, XCircle } from 'lucide-react'

import { t } from '@/lib/i18n'
import { submitReviewDecision } from '@/lib/workflows'
import { usePDMStore } from '@/stores/pdmStore'
import type { ReviewQueueRow } from '@/types/reviews'

type GateDecision = 'approved' | 'rejected' | 'kicked_back'

interface GateQueueRowProps {
  row: ReviewQueueRow
  selected: boolean
  onToggleSelected: (id: string) => void
}

export function GateQueueRow({ row, selected, onToggleSelected }: GateQueueRowProps) {
  const addToast = usePDMStore((s) => s.addToast)
  const refreshQueue = usePDMStore((s) => s.requestReviewQueueRefresh)
  const [pending, setPending] = useState<GateDecision | null>(null)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const gate = row.gate
  if (!gate) return null

  const decide = async (decision: GateDecision) => {
    if (decision !== 'approved' && !comment.trim()) {
      setPending(decision)
      return
    }
    setBusy(true)
    try {
      const { data, error } = await submitReviewDecision(
        gate.pendingReviewId,
        decision,
        comment.trim() || undefined,
      )
      if (error || !data?.success) {
        addToast('error', error?.message ?? data?.error_message ?? t('reviewQueue.gate.failed'))
        return
      }
      addToast(
        'success',
        data.new_state_name
          ? t('reviewQueue.gate.advanced', { state: data.new_state_name })
          : t('reviewQueue.gate.recorded'),
      )
      setPending(null)
      setComment('')
      refreshQueue()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-md border border-plm-border bg-plm-bg-light p-2">
      <div className="flex items-center gap-1.5">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelected(row.id)}
          className="w-3 h-3"
          aria-label={t('reviewQueue.select')}
        />
        <ShieldCheck size={12} className="text-plm-warning flex-shrink-0" />
        <span className="text-xs font-medium text-plm-fg truncate" title={gate.filePath}>
          {gate.fileName}
        </span>
        <span className="ml-auto text-[10px] text-plm-fg-muted">{t('reviewQueue.gate.label')}</span>
      </div>
      <div className="mt-1 flex items-center gap-1 text-[10px] text-plm-fg-muted">
        <span>{gate.fromStateName}</span>
        <ArrowRight size={10} />
        <span>{gate.toStateName}</span>
        <span className="mx-1">·</span>
        <span className="truncate">{gate.gateName}</span>
      </div>
      {row.requestedBy && (
        <p className="mt-0.5 text-[10px] text-plm-fg-muted truncate">
          {t('reviewQueue.requestedBy', {
            name: row.requestedBy.fullName || row.requestedBy.email,
          })}
        </p>
      )}

      {pending && (
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder={t('reviewQueue.gate.commentRequired')}
          rows={2}
          autoFocus
          className="mt-2 w-full px-2 py-1 text-xs bg-plm-bg border border-plm-border rounded focus:outline-none focus:border-plm-accent"
        />
      )}

      <div className="mt-2 flex items-center gap-1">
        <button
          type="button"
          onClick={() => void decide('approved')}
          disabled={busy}
          className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded bg-plm-success/15 text-plm-success hover:bg-plm-success/25 disabled:opacity-50"
        >
          {busy ? <Loader2 size={10} className="animate-spin" /> : <CheckCircle2 size={10} />}
          {t('reviewQueue.gate.approve')}
        </button>
        <button
          type="button"
          onClick={() => void decide('kicked_back')}
          disabled={busy || (pending === 'kicked_back' && !comment.trim())}
          className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded bg-plm-warning/15 text-plm-warning hover:bg-plm-warning/25 disabled:opacity-50"
        >
          <Undo2 size={10} />
          {t('reviewQueue.gate.kickBack')}
        </button>
        <button
          type="button"
          onClick={() => void decide('rejected')}
          disabled={busy || (pending === 'rejected' && !comment.trim())}
          className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded bg-plm-error/15 text-plm-error hover:bg-plm-error/25 disabled:opacity-50"
        >
          <XCircle size={10} />
          {t('reviewQueue.gate.reject')}
        </button>
      </div>
    </div>
  )
}
