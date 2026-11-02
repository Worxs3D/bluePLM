import { useEffect, useRef, useState } from 'react'

import { t } from '@/lib/i18n'
import type { VaultAuditProgress as Progress } from '@/types/vaultAudit'

import { estimateRemainingMs, formatDuration, type ProgressSample } from './vaultAuditTiming'

interface VaultAuditProgressProps {
  progress: Progress
  /** When the run started, from the store, so the clock survives leaving and returning to the tab. */
  startedAt: number | null
}

const PERCENT = 100
const TICK_MS = 1000

/**
 * A bar, a count and a clock while the scan runs.
 *
 * The total is unknown until the rows have been fetched and filtered, which is the first few
 * seconds. An indeterminate bar covers that window rather than a bar sitting at zero, because a
 * bar at zero is indistinguishable from a stall.
 *
 * A full vault takes minutes, so the elapsed time and an estimate of what is left are shown once
 * there is a rate to estimate from. The rate is measured from the first file counted, not from the
 * start of the run: the opening seconds are spent fetching rows, not reading files.
 */
export function VaultAuditProgress({ progress, startedAt }: VaultAuditProgressProps) {
  const known = progress.total > 0
  const percent = known ? Math.round((progress.completed / progress.total) * PERCENT) : 0

  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MS)
    return () => window.clearInterval(timer)
  }, [])

  // The first sample with files counted, per run.
  const firstSample = useRef<{ run: number | null; sample: ProgressSample } | null>(null)
  const hasFiles = known && progress.completed > 0
  useEffect(() => {
    if (!hasFiles) return
    if (firstSample.current?.run === startedAt) return
    firstSample.current = {
      run: startedAt,
      sample: { at: Date.now(), completed: progress.completed },
    }
  }, [hasFiles, startedAt, progress.completed])

  const elapsedMs = startedAt ? Math.max(0, now - startedAt) : null
  const first = firstSample.current?.run === startedAt ? firstSample.current.sample : null
  const remainingMs = known
    ? estimateRemainingMs(first, { at: now, completed: progress.completed }, progress.total)
    : null

  return (
    <div className="space-y-1.5">
      <div className="h-1 w-full rounded-full bg-ui-field overflow-hidden">
        {known ? (
          <div
            className="h-full bg-ui-fg-secondary transition-[width] duration-200"
            style={{ width: `${percent}%` }}
          />
        ) : (
          <div className="h-full w-1/3 bg-ui-fg-secondary animate-pulse" />
        )}
      </div>

      <div className="flex items-center justify-between gap-4 text-[13px] text-ui-fg-secondary">
        <span>
          {known
            ? t('vaultAudit.progressFiles', {
                completed: progress.completed,
                total: progress.total,
              })
            : progress.message || t('vaultAudit.preparing')}
        </span>
        <span className="flex-shrink-0 tabular-nums">
          {elapsedMs !== null &&
            t('vaultAudit.progressElapsed', { time: formatDuration(elapsedMs) })}
          {remainingMs !== null &&
            ` · ${t('vaultAudit.progressRemaining', { time: formatDuration(remainingMs) })}`}
          {known && ` · ${percent}%`}
        </span>
      </div>
    </div>
  )
}
