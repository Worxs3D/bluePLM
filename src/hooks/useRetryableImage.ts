import { useCallback, useEffect, useState } from 'react'

/**
 * Retries an image URL a bounded number of times before giving up.
 *
 * Thumbnails can fail for reasons that resolve on their own: the SolidWorks
 * service is still starting during the first seconds after launch, or an
 * extraction was cancelled because the user navigated away mid-load. The
 * `img` element gives no detail beyond "it failed", so the only way to tell a
 * temporary failure from a file that simply has no preview is to try again.
 *
 * Retries append a counter to the URL because the browser will not re-request
 * an identical `src`.
 */

const MAX_RETRY_ATTEMPTS = 2

/** Multiplied by the attempt number, so waits are 2s then 4s. */
const RETRY_BASE_DELAY_MS = 2000

export interface RetryableImage {
  /** URL to render, or null once the URL is absent or retries are exhausted. */
  src: string | null
  onError: () => void
}

export function useRetryableImage(url: string | null): RetryableImage {
  const [attempt, setAttempt] = useState(0)
  const [failedAttempt, setFailedAttempt] = useState<number | null>(null)

  useEffect(() => {
    setAttempt(0)
    setFailedAttempt(null)
  }, [url])

  useEffect(() => {
    if (failedAttempt === null || failedAttempt >= MAX_RETRY_ATTEMPTS) return

    const nextAttempt = failedAttempt + 1
    const timer = setTimeout(() => setAttempt(nextAttempt), RETRY_BASE_DELAY_MS * nextAttempt)
    return () => clearTimeout(timer)
  }, [failedAttempt])

  const onError = useCallback(() => setFailedAttempt(attempt), [attempt])

  return { src: retryableImageSrc(url, attempt, failedAttempt), onError }
}

/**
 * The `src` for an attempt, or null for the caller's fallback icon: no URL, retries exhausted, or
 * the current attempt failed and the next one is still waiting. Keeping a failed `src` on screen
 * during that wait showed the browser's broken-image glyph for up to six seconds.
 */
export function retryableImageSrc(
  url: string | null,
  attempt: number,
  failedAttempt: number | null,
): string | null {
  if (url === null) return null
  if (failedAttempt !== null && failedAttempt >= MAX_RETRY_ATTEMPTS) return null
  if (failedAttempt === attempt) return null
  return attempt === 0 ? url : `${url}&a=${attempt}`
}
