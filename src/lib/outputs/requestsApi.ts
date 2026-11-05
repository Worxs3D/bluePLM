/**
 * Output requests on the server (5.13.0, schema 515): the wrappers of the
 * `version_output_request_*` RPCs and the read of `version_output_request` under RLS (the file's
 * vault). Free of store imports, so the orders slice can read requests. The desktop worker that
 * generates requests is `./requests`.
 *
 * Calls go through the untyped client, as `src/lib/orders/api.ts` does; RPC names and argument
 * keys are literal so `rpcContract.test.ts` checks them against the SQL.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import { log } from '@/lib/logger'
import { readAllPages } from '@/lib/orders/paging'
import { getSupabaseClient } from '@/lib/supabase/client'
import {
  ACTIVE_OUTPUT_REQUEST_STATUSES,
  OUTPUT_REQUEST_ERROR_CODES,
  OUTPUT_REQUEST_SKIP_REASONS,
  OUTPUT_REQUEST_STATUSES,
  type OutputRequest,
  type OutputRequestErrorCode,
  type OutputRequestItem,
  type OutputRequestResult,
  type OutputRequestSkipReason,
  type OutputRequestStatus,
  type RequestOutputsResult,
} from '@/types/outputRequests'
import { VERSION_OUTPUT_KINDS, type VersionOutputKind } from '@/types/versionOutputs'

/** Requests one claim takes (each is a SOLIDWORKS export, minutes at worst). */
export const OUTPUT_REQUEST_CLAIM_LIMIT = 3
/** Items one create call carries. */
const CREATE_BATCH = 500
const IN_BATCH = 100
const ERROR_MAX_LENGTH = 500
const REQUEST_COLUMNS =
  'id, org_id, vault_id, file_version_id, kind, configuration, status, requested_by, requested_at, claimed_by, claimed_at, finished_at, error, order_id'

function db(): SupabaseClient {
  return getSupabaseClient() as unknown as SupabaseClient
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null
}

function isKind(v: unknown): v is VersionOutputKind {
  return typeof v === 'string' && (VERSION_OUTPUT_KINDS as readonly string[]).includes(v)
}

function isStatus(v: unknown): v is OutputRequestStatus {
  return typeof v === 'string' && (OUTPUT_REQUEST_STATUSES as readonly string[]).includes(v)
}

/** A `version_output_request` row, or null when it is not one. Pure. */
export function toOutputRequest(row: unknown): OutputRequest | null {
  if (!isRecord(row)) return null
  const id = str(row.id)
  const fileVersionId = str(row.file_version_id)
  if (!id || !fileVersionId || !isKind(row.kind) || !isStatus(row.status)) return null
  return {
    id,
    orgId: str(row.org_id) ?? '',
    vaultId: str(row.vault_id),
    fileVersionId,
    kind: row.kind,
    configuration: str(row.configuration),
    status: row.status,
    requestedBy: str(row.requested_by),
    requestedAt: str(row.requested_at) ?? '',
    claimedBy: str(row.claimed_by),
    claimedAt: str(row.claimed_at),
    finishedAt: str(row.finished_at),
    error: str(row.error),
    orderId: str(row.order_id),
  }
}

type RpcError = { message: string; hint?: string | null }

/** The error code of a refused RPC: its hint when it is one of ours. Pure. */
export function outputRequestErrorCode(error: { hint?: string | null } | null | undefined): OutputRequestErrorCode {
  const hint = error?.hint ?? ''
  return OUTPUT_REQUEST_ERROR_CODES.find((c) => c === hint) ?? 'UNKNOWN'
}

function refused(what: string, error: RpcError): { ok: false; code: OutputRequestErrorCode; message: string } {
  const code = outputRequestErrorCode(error)
  log.warn('[OutputRequests]', `${what} refused`, { code, error: error.message })
  return { ok: false, code, message: error.message }
}

function skipReason(v: unknown): OutputRequestSkipReason {
  return OUTPUT_REQUEST_SKIP_REASONS.find((r) => r === v) ?? 'UNKNOWN'
}

/** The create RPC's answer, summed over batches. Pure. */
export function parseCreateResult(data: unknown, into: RequestOutputsResult): RequestOutputsResult {
  if (!isRecord(data)) return into
  into.created += typeof data.created === 'number' ? data.created : 0
  into.existing += typeof data.existing === 'number' ? data.existing : 0
  if (Array.isArray(data.skipped)) {
    for (const s of data.skipped) {
      if (!isRecord(s) || !str(s.file_version_id) || !isKind(s.kind)) continue
      into.skipped.push({ fileVersionId: s.file_version_id as string, kind: s.kind, reason: skipReason(s.reason) })
    }
  }
  return into
}

/**
 * Ask for these outputs (one request per version, kind and configuration; one that is already
 * pending or claimed counts as `existing`). The server skips a kind the file cannot have, an
 * output that already exists and a vault the caller cannot read, and says why.
 */
export async function requestOutputs(
  items: readonly OutputRequestItem[],
): Promise<OutputRequestResult<RequestOutputsResult>> {
  const result: RequestOutputsResult = { created: 0, existing: 0, skipped: [] }
  const unique = new Map<string, OutputRequestItem>()
  for (const item of items) {
    const key = `${item.fileVersionId}:${item.kind}:${item.configuration ?? ''}`
    if (!unique.has(key)) unique.set(key, item)
  }
  const all = [...unique.values()]
  for (let i = 0; i < all.length; i += CREATE_BATCH) {
    const p_items = all.slice(i, i + CREATE_BATCH).map((item) => ({
      file_version_id: item.fileVersionId,
      kind: item.kind,
      configuration: item.configuration ?? null,
      order_id: item.orderId ?? null,
    }))
    const { data, error } = await db().rpc('version_output_request_create', { p_items })
    if (error) return refused('Output request', error)
    parseCreateResult(data, result)
  }
  if (result.created > 0) log.info('[OutputRequests]', 'Outputs requested', { created: result.created, existing: result.existing })
  return { ok: true, ...result }
}

/**
 * The requests of these versions, readable under RLS (the file's vault), oldest first. By default
 * only the ones still waiting (`pending`, `claimed`). Throws on a query error.
 */
export async function listOutputRequests(
  fileVersionIds: readonly string[],
  statuses: readonly OutputRequestStatus[] = ACTIVE_OUTPUT_REQUEST_STATUSES,
): Promise<OutputRequest[]> {
  const ids = [...new Set(fileVersionIds)].filter(Boolean)
  const out: OutputRequest[] = []
  for (let i = 0; i < ids.length; i += IN_BATCH) {
    const batch = ids.slice(i, i + IN_BATCH)
    const rows = await readAllPages((from, to) =>
      db()
        .from('version_output_request')
        .select(REQUEST_COLUMNS)
        .in('file_version_id', batch)
        .in('status', [...statuses])
        .order('requested_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    )
    for (const row of rows) {
      const request = toOutputRequest(row)
      if (request) out.push(request)
    }
  }
  return out
}

/** Cancel requests that are still pending or claimed (the requester or an admin). */
export async function cancelOutputRequests(ids: readonly string[]): Promise<OutputRequestResult<{ cancelled: number }>> {
  const p_ids = [...new Set(ids)].filter(Boolean)
  if (p_ids.length === 0) return { ok: true, cancelled: 0 }
  const { data, error } = await db().rpc('version_output_request_cancel', { p_ids })
  if (error) return refused('Cancel output requests', error)
  const cancelled = typeof data === 'number' ? data : isRecord(data) && typeof data.cancelled === 'number' ? data.cancelled : 0
  return { ok: true, cancelled }
}

/** Claim up to `limit` requests for this user (explorer edit and vault access). Throws on an error. */
export async function claimOutputRequests(limit = OUTPUT_REQUEST_CLAIM_LIMIT): Promise<OutputRequest[]> {
  const { data, error } = await db().rpc('version_output_request_claim', { p_limit: limit })
  if (error) {
    const e = new Error(error.message) as Error & { code?: OutputRequestErrorCode }
    e.code = outputRequestErrorCode(error)
    throw e
  }
  const rows: unknown[] = Array.isArray(data)
    ? data
    : isRecord(data) && Array.isArray(data.requests)
      ? data.requests
      : []
  return rows.map(toOutputRequest).filter((r): r is OutputRequest => r !== null)
}

/** Finish a request this user claimed. */
export async function finishOutputRequest(
  id: string,
  status: 'done' | 'failed',
  error: string | null = null,
): Promise<OutputRequestResult> {
  const { error: rpcError } = await db().rpc('version_output_request_finish', {
    p_id: id,
    p_status: status,
    p_error: error ? error.slice(0, ERROR_MAX_LENGTH) : null,
  })
  if (rpcError) return refused('Finish output request', rpcError)
  return { ok: true }
}
