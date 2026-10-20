/**
 * Turn whatever was thrown or returned as an error into something a log line can hold.
 *
 * `String(error)` on a PostgREST error gives `[object Object]`, and an `IDBRequest.error` or
 * `DOMException` passed straight to the logger serializes as `{}` because its fields are
 * prototype getters. Both hid the actual cause in field logs, so every field worth reading is
 * copied out explicitly here.
 */

const MAX_DETAIL_LENGTH = 500

export interface ErrorDetails {
  name?: string
  message?: string
  /** DOMException legacy numeric code, or the PostgREST / Postgres error code. */
  code?: string | number
  details?: string
  hint?: string
  status?: number
  cause?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function clip(value: string): string {
  return value.length > MAX_DETAIL_LENGTH ? `${value.slice(0, MAX_DETAIL_LENGTH)}...` : value
}

function readString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key]
  return typeof value === 'string' && value.length > 0 ? clip(value) : undefined
}

/**
 * Collect name, message, code, details, hint and status from an Error, a DOMException, a
 * PostgREST/Supabase error object or a plain thrown value. Fields that are absent are omitted.
 */
export function describeError(error: unknown): ErrorDetails {
  if (error === null || error === undefined) return { message: String(error) }
  if (typeof error === 'string') return { message: clip(error) }
  if (typeof error === 'number' || typeof error === 'boolean') return { message: String(error) }
  if (!isRecord(error)) return { message: clip(String(error)) }

  const details: ErrorDetails = {}

  const name = readString(error, 'name')
  if (name) details.name = name
  const message = readString(error, 'message')
  if (message) details.message = message

  const code = error['code']
  if (typeof code === 'string' || typeof code === 'number') details.code = code

  const detail = readString(error, 'details')
  if (detail) details.details = detail
  const hint = readString(error, 'hint')
  if (hint) details.hint = hint

  const status = error['status']
  if (typeof status === 'number') details.status = status

  const cause = error['cause']
  if (cause !== undefined && cause !== null) {
    details.cause = typeof cause === 'string' ? clip(cause) : clip(describeError(cause).message ?? String(cause))
  }

  if (Object.keys(details).length === 0) {
    try {
      details.message = clip(JSON.stringify(error))
    } catch {
      details.message = clip(String(error))
    }
  }

  return details
}

/** True when the error is Chromium's corrupt-IndexedDB-backing-store failure or kin. */
export function isIndexedDbCorruptionError(error: unknown): boolean {
  const { name, message } = describeError(error)
  if (name === 'UnknownError' || name === 'InvalidStateError') return true
  return typeof message === 'string' && message.toLowerCase().includes('backing store')
}
