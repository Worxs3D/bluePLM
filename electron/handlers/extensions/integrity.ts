/**
 * Package integrity checks.
 *
 * A store download is accepted only when the store states the package's SHA-256
 * (response header `X-Content-SHA256`) and the downloaded bytes match it. A
 * missing or malformed hash is a refusal, not a pass.
 */

import { createHash, timingSafeEqual } from 'crypto'

/** Response header the extension store sends with a package download. */
export const PACKAGE_SHA256_HEADER = 'X-Content-SHA256'

export function sha256Hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

/**
 * Normalize a stated SHA-256 to 64 lowercase hex characters.
 * Accepts an optional `sha256:` or `sha256=` prefix. Returns null when the value
 * is not a SHA-256 at all.
 */
export function normalizeSha256(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value
    .trim()
    .replace(/^sha256[:=]/i, '')
    .toLowerCase()
  return /^[0-9a-f]{64}$/.test(trimmed) ? trimmed : null
}

/** True when `data` hashes to `expected`. False for a malformed `expected`. */
export function matchesSha256(data: Uint8Array, expected: string): boolean {
  const normalized = normalizeSha256(expected)
  if (!normalized) return false
  const actual = Buffer.from(sha256Hex(data), 'hex')
  return timingSafeEqual(actual, Buffer.from(normalized, 'hex'))
}

/**
 * Throw unless the stated hash is present, well-formed and matches the bytes.
 * Fails closed: no hash means no install.
 */
export function assertPackageIntegrity(data: Uint8Array, statedSha256: string | null): string {
  const expected = normalizeSha256(statedSha256)
  if (!expected) {
    throw new Error(
      'The extension store did not provide a valid SHA-256 for this package, so it was not installed.',
    )
  }
  if (!matchesSha256(data, expected)) {
    throw new Error(
      'The downloaded package does not match the SHA-256 the extension store stated, so it was not installed.',
    )
  }
  return expected
}
