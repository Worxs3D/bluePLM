/** Clock arithmetic for the audit's progress line. Pure, so it can be tested without a timer. */

const MS_PER_SECOND = 1000
const SECONDS_PER_MINUTE = 60
const MINUTES_PER_HOUR = 60

/** Files to count and seconds to wait before a rate is worth quoting; earlier ones swing wildly. */
const MIN_SAMPLE_FILES = 20
const MIN_SAMPLE_MS = 3000

export interface ProgressSample {
  at: number
  completed: number
}

/**
 * Time left at the rate measured since `first`, or null while there is too little to go on.
 *
 * Measured from a sample taken after files started counting rather than from the run's start,
 * because the run spends its first seconds fetching rows and asking SOLIDWORKS what is open.
 */
export function estimateRemainingMs(
  first: ProgressSample | null,
  latest: ProgressSample,
  total: number,
): number | null {
  if (!first) return null
  const files = latest.completed - first.completed
  const ms = latest.at - first.at
  if (files < MIN_SAMPLE_FILES || ms < MIN_SAMPLE_MS) return null
  const left = Math.max(0, total - latest.completed)
  return Math.round((left * ms) / files)
}

/** `0:42`, `3:05`, `1:02:09`. */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / MS_PER_SECOND))
  const seconds = totalSeconds % SECONDS_PER_MINUTE
  const totalMinutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE)
  const minutes = totalMinutes % MINUTES_PER_HOUR
  const hours = Math.floor(totalMinutes / MINUTES_PER_HOUR)
  const ss = String(seconds).padStart(2, '0')
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${ss}`
  return `${minutes}:${ss}`
}
