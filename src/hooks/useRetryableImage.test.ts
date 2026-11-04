import { describe, expect, it } from 'vitest'

import { retryableImageSrc } from './useRetryableImage'

describe('retryableImageSrc', () => {
  const url = 'blueplm-thumb://t/?p=a'

  it('loads the URL, then a retry URL once the next attempt starts', () => {
    expect(retryableImageSrc(url, 0, null)).toBe(url)
    expect(retryableImageSrc(url, 1, 0)).toBe(`${url}&a=1`)
  })

  it('shows the fallback while a failed attempt waits for its retry, and once retries run out', () => {
    expect(retryableImageSrc(url, 0, 0)).toBeNull()
    expect(retryableImageSrc(url, 1, 1)).toBeNull()
    expect(retryableImageSrc(url, 2, 2)).toBeNull()
    expect(retryableImageSrc(null, 0, null)).toBeNull()
  })
})
