/**
 * "Resubmit with newer versions": pick a newer version for every item that was not approved, add
 * a note, and open the next round. Approved items carry forward and are not reviewed again.
 */

import { useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'

import { Dialog } from '@/components/core/Dialog'
import { t } from '@/lib/i18n'
import { log } from '@/lib/logger'
import { getFileVersions } from '@/lib/supabase'
import { resubmitReview } from '@/lib/supabase/reviews'
import { usePDMStore } from '@/stores/pdmStore'
import type { ReviewItemDetail } from '@/types/reviews'

import { describeReviewError } from '../lib/reviewErrors'
import {
  defaultResubmitSelection,
  itemsNeedingNewVersion,
  newerVersionOptions,
  planResubmit,
  type VersionOption,
} from '../lib/resubmit'

interface ResubmitDialogProps {
  open: boolean
  reviewId: string
  items: ReviewItemDetail[]
  onClose: () => void
  onDone: () => void
}

function toOption(raw: unknown): VersionOption | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string' || typeof r.version !== 'number') return null
  return {
    fileVersionId: r.id,
    version: r.version,
    revision: typeof r.revision === 'string' ? r.revision : null,
    createdAt: typeof r.created_at === 'string' ? r.created_at : null,
  }
}

export function ResubmitDialog({ open, reviewId, items, onClose, onDone }: ResubmitDialogProps) {
  const addToast = usePDMStore((s) => s.addToast)
  const needing = useMemo(() => itemsNeedingNewVersion(items), [items])
  const [versionsByFile, setVersionsByFile] = useState<Record<string, VersionOption[]>>({})
  const [selection, setSelection] = useState<Record<string, string | null>>({})
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    void (async () => {
      const entries = await Promise.all(
        Array.from(new Set(needing.map((i) => i.fileId))).map(async (fileId) => {
          const { versions, error } = await getFileVersions(fileId)
          if (error) log.warn('[Reviews]', 'Loading versions for resubmit failed', { error, fileId })
          const options = ((versions ?? []) as unknown[])
            .map(toOption)
            .filter((v): v is VersionOption => v !== null)
          return [fileId, options] as const
        }),
      )
      if (cancelled) return
      const byFile = Object.fromEntries(entries)
      setVersionsByFile(byFile)
      setSelection(defaultResubmitSelection(needing, byFile))
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [open, needing])

  const plan = planResubmit(items, selection)

  const submit = async () => {
    if (!plan.ready) return
    setBusy(true)
    try {
      const result = await resubmitReview(reviewId, plan.payload, note.trim() || null)
      addToast('success', t('reviewDetail.resubmit.done', { round: result.round }))
      setNote('')
      onDone()
    } catch (error) {
      addToast('error', describeReviewError(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={t('reviewDetail.resubmit.title')} className="max-w-lg">
      <div className="space-y-3">
        <p className="text-xs text-plm-fg-muted">{t('reviewDetail.resubmit.intro')}</p>
        {loading ? (
          <div className="flex justify-center py-4">
            <Loader2 size={16} className="animate-spin text-plm-fg-muted" />
          </div>
        ) : (
          <ul className="space-y-2 max-h-72 overflow-y-auto">
            {needing.map((item) => {
              const options = newerVersionOptions(item, versionsByFile[item.fileId] ?? [])
              return (
                <li key={item.id} className="text-xs">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-plm-fg">{item.file.fileName}</span>
                    <span className="text-plm-fg-muted">
                      {t('reviewDetail.resubmit.reviewed', { version: item.version.version })}
                    </span>
                  </div>
                  {options.length === 0 ? (
                    <p className="text-[11px] text-plm-warning">{t('reviewDetail.resubmit.noNewer')}</p>
                  ) : (
                    <select
                      value={selection[item.id] ?? ''}
                      onChange={(e) => setSelection((s) => ({ ...s, [item.id]: e.target.value || null }))}
                      className="mt-1 w-full px-2 py-1 text-xs bg-plm-bg-light border border-plm-border rounded"
                    >
                      {options.map((o) => (
                        <option key={o.fileVersionId} value={o.fileVersionId}>
                          {o.revision
                            ? t('reviewDetail.resubmit.optionRev', { version: o.version, revision: o.revision })
                            : t('reviewDetail.resubmit.option', { version: o.version })}
                        </option>
                      ))}
                    </select>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder={t('reviewDetail.resubmit.note')}
          className="w-full px-2 py-1 text-xs bg-plm-bg-light border border-plm-border rounded focus:outline-none focus:border-plm-accent"
        />
        {plan.missing.length > 0 && !loading && (
          <p className="text-[11px] text-plm-warning">
            {t('reviewDetail.resubmit.missing', { count: plan.missing.length })}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded text-plm-fg-muted hover:bg-plm-highlight"
          >
            {t('reviewQueue.cancel')}
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!plan.ready || busy || loading}
            className="flex items-center gap-1 px-3 py-1.5 text-xs rounded bg-plm-accent text-white hover:bg-plm-accent/90 disabled:opacity-50"
          >
            {busy && <Loader2 size={12} className="animate-spin" />}
            {t('reviewDetail.resubmit.submit')}
          </button>
        </div>
      </div>
    </Dialog>
  )
}
