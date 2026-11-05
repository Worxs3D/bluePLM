/**
 * Resubmit: every file that was not approved goes back to the reviewers at a newer version, with a
 * note on what changed (shown to reviewers in the round's Activity); approved files carry forward.
 *
 * No dead ends (review UX audit F6): each file shows what reviewers asked for (outcome and open
 * comments); a file with no newer version offers Show in vault and Check out, and the submit says
 * which file is missing; and the picked drawing versions' PDFs are checked, with "Generate PDFs"
 * for the missing ones, so round 2 never opens on "PDF pending".
 */

import { useEffect, useMemo, useState } from 'react'

import { Dialog } from '@/components/core/Dialog'
import { Button, Callout, Select, StatusText, TextArea } from '@/components/core/ui'
import { loadPdfStatus } from '@/features/source/reviewPackage'
import { displayFileName } from '@/hooks/useFileDisplayName'
import { executeCommand } from '@/lib/commands'
import { t } from '@/lib/i18n'
import { log } from '@/lib/logger'
import { hasDesktop } from '@/lib/platform'
import { getFileVersions } from '@/lib/supabase'
import { resubmitReview } from '@/lib/supabase/reviews'
import { usePDMStore } from '@/stores/pdmStore'
import type { ReviewItemDetail } from '@/types/reviews'

import { describeReviewError } from '../lib/reviewErrors'
import { commentCountFor, type ItemCommentCount } from '../lib/reviewProgress'
import {
  itemsNeedingNewVersion,
  keepResubmitSelection,
  newerVersionOptions,
  planResubmit,
  type VersionOption,
} from '../lib/resubmit'
import { canCheckOutHere, checkOutFile, showFileInVault } from './itemActions'
import { tCount } from '../lib/plural'

interface ResubmitDialogProps {
  open: boolean
  reviewId: string
  title: string
  items: ReviewItemDetail[]
  counts: ReadonlyMap<string, ItemCommentCount>
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

export function ResubmitDialog({
  open,
  reviewId,
  title,
  items,
  counts,
  onClose,
  onDone,
}: ResubmitDialogProps) {
  const addToast = usePDMStore((s) => s.addToast)
  const needing = useMemo(() => itemsNeedingNewVersion(items), [items])
  const needingKey = needing.map((i) => `${i.id}:${i.fileId}:${i.version.version}`).join(',')
  const carried = items.length - needing.length
  const [versionsByFile, setVersionsByFile] = useState<Record<string, VersionOption[]>>({})
  const [selection, setSelection] = useState<Record<string, string | null>>({})
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [missingPdf, setMissingPdf] = useState<string[] | null>(null)
  const [generating, setGenerating] = useState(false)
  const [reloadTick, setReloadTick] = useState(0)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    void (async () => {
      const entries = await Promise.all(
        Array.from(new Set(needing.map((i) => i.fileId))).map(async (fileId) => {
          const { versions, error } = await getFileVersions(fileId)
          if (error)
            log.warn('[Reviews]', 'Loading versions for resubmit failed', { error, fileId })
          const options = ((versions ?? []) as unknown[])
            .map(toOption)
            .filter((v): v is VersionOption => v !== null)
          return [fileId, options] as const
        }),
      )
      if (cancelled) return
      const byFile = Object.fromEntries(entries)
      setVersionsByFile(byFile)
      // Seeded once per opening: a reload (the detail reloads often) keeps the author's picks.
      setSelection((previous) => keepResubmitSelection(previous, needing, byFile))
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
    // Keyed on which items need a version, not on the array a detail reload replaces.
  }, [open, needingKey, reloadTick]) // eslint-disable-line react-hooks/exhaustive-deps

  // A closed dialog forgets its picks: the next opening starts from the defaults.
  useEffect(() => {
    if (!open) setSelection({})
  }, [open])

  const plan = planResubmit(items, selection)

  // The picked versions' PDFs: reviewers must not open round 2 on "PDF pending".
  const pickedKey = plan.payload.map((p) => p.fileVersionId).join(',')
  useEffect(() => {
    if (!open || loading) return
    let cancelled = false
    setMissingPdf(null)
    void Promise.all(
      plan.payload.map(async (p) => {
        const item = items.find((i) => i.id === p.itemId)
        const status = await loadPdfStatus({
          fileVersionId: p.fileVersionId,
          extension: item?.file.extension ?? null,
        })
        return status === 'missing' ? p.fileVersionId : null
      }),
    ).then((ids) => {
      if (!cancelled) setMissingPdf(ids.filter((id): id is string => !!id))
    })
    return () => {
      cancelled = true
    }
  }, [open, loading, pickedKey, reloadTick]) // eslint-disable-line react-hooks/exhaustive-deps

  const generate = async () => {
    if (!missingPdf?.length) return
    setGenerating(true)
    try {
      await executeCommand('generate-review-pdfs', { fileVersionIds: missingPdf })
    } finally {
      setGenerating(false)
      setReloadTick((n) => n + 1)
    }
  }

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

  const missingNames = plan.missing.map((id) => displayFileName(items.find((i) => i.id === id)?.file.fileName ?? id))
  // One file without a newer version says so on its own row; several get a summary too.
  const blocker =
    loading || missingNames.length < 2
      ? null
      : t('reviewDetail.resubmit.blockedMany', { count: missingNames.length })

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('reviewDetail.resubmit.title', { title })}
      description={t('reviewDetail.resubmit.intro')}
      className="!max-w-[640px]"
      footer={
        <>
          <Button onClick={onClose}>{t('reviewQueue.cancel')}</Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!plan.ready || loading}
            onClick={() => void submit()}
          >
            {plan.payload.length > 1
              ? t('reviewDetail.resubmit.submitCount', { count: plan.payload.length })
              : t('reviewDetail.resubmit.submit')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {loading ? (
          <p className="text-[14px] text-ui-fg-secondary">{t('reviewQueue.loading')}</p>
        ) : (
          <div className="max-h-80 divide-y divide-ui-divider overflow-y-auto">
            {needing.map((item) => {
              const options = newerVersionOptions(item, versionsByFile[item.fileId] ?? [])
              const count = commentCountFor(counts, item.id)
              return (
                <div key={item.id} className="py-3">
                  <div className="flex min-w-0 items-baseline gap-3">
                    <span
                      className="min-w-0 flex-1 truncate text-[14px] text-ui-fg"
                      title={item.file.filePath}
                    >
                      {displayFileName(item.file.fileName)}
                    </span>
                    {options.length > 0 && (
                      <Select
                        value={selection[item.id] ?? ''}
                        aria-label={displayFileName(item.file.fileName)}
                        onChange={(e) =>
                          setSelection((s) => ({ ...s, [item.id]: e.target.value || null }))
                        }
                      >
                        {options.map((o) => (
                          <option key={o.fileVersionId} value={o.fileVersionId}>
                            {o.revision
                              ? t('reviewDetail.resubmit.optionRev', {
                                  version: o.version,
                                  revision: o.revision,
                                })
                              : t('reviewDetail.resubmit.option', { version: o.version })}
                          </option>
                        ))}
                      </Select>
                    )}
                  </div>
                  <div className="mt-0.5 text-[13px] text-ui-fg-secondary">
                    {t('reviewDetail.resubmit.reviewed', { version: item.version.version })} ·{' '}
                    <span
                      className={item.outcome === 'rejected' ? 'text-ui-danger' : 'text-ui-warning'}
                    >
                      {t(`reviewDetail.itemOutcome.${item.outcome}`)}
                    </span>{' '}
                    ·{' '}
                    {count.open > 0
                      ? count.open === 1
                        ? t('reviewDetail.items.commentOne')
                        : t('reviewDetail.items.comments', { count: count.open })
                      : t('reviewDetail.resubmit.noComments')}
                  </div>
                  {options.length === 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <StatusText tone="warning" className="mr-auto">
                        {t('reviewDetail.resubmit.noNewer')}
                      </StatusText>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          onClose()
                          showFileInVault(item.fileId)
                        }}
                      >
                        {t('reviewDetail.items.showInVault')}
                      </Button>
                      {canCheckOutHere(item.fileId) && (
                        <Button size="sm" onClick={() => void checkOutFile(item.fileId)}>
                          {t('reviewDetail.items.checkOut')}
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {blocker && <Callout tone="warning">{blocker}</Callout>}

        {carried > 0 && (
          <p className="text-[13px] text-ui-fg-secondary">
            {tCount('reviewDetail.resubmit.carried', carried)}
          </p>
        )}

        {!loading && missingPdf === null && plan.payload.length > 0 && (
          <p className="text-[13px] text-ui-fg-secondary">
            {t('reviewDetail.resubmit.checkingPdfs')}
          </p>
        )}
        {missingPdf && missingPdf.length > 0 && (
          <Callout
            tone="warning"
            action={
              // PDFs are made with SOLIDWORKS, which only the desktop app can drive.
              hasDesktop() ? (
                <Button size="sm" loading={generating} onClick={() => void generate()}>
                  {t('reviewDetail.resubmit.generatePdfs')}
                </Button>
              ) : undefined
            }
          >
            {tCount('reviewDetail.resubmit.missingPdfs', missingPdf.length)}
          </Callout>
        )}

        <label className="block">
          <span className="text-[14px] text-ui-fg">{t('reviewDetail.resubmit.note')}</span>
          <TextArea
            rows={3}
            value={note}
            className="mt-1.5"
            placeholder={t('reviewDetail.resubmit.notePlaceholder')}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                void submit()
              }
            }}
          />
          <span className="mt-1 block text-[12px] text-ui-fg-tertiary">
            {t('reviewDetail.resubmit.sendHint')}
          </span>
        </label>
      </div>
    </Dialog>
  )
}
