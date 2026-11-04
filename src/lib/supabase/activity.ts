import { getSupabaseClient } from './client'

// ============================================
// Activity Log
// ============================================

export async function getRecentActivity(orgId: string, limit = 50) {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from('activity')
    .select(
      `
      *,
      file:file(file_name, file_path)
    `,
    )
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(limit)

  return { activity: data, error }
}

export async function getFileActivity(fileId: string, limit = 20) {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from('activity')
    .select('*')
    .eq('file_id', fileId)
    .order('created_at', { ascending: false })
    .limit(limit)

  return { activity: data, error }
}

/** The vault's last recorded move of a file: who wrote its current path, and when. */
export interface FileMoveRecord {
  fileId: string
  userId: string
  userEmail: string
  movedAt: string
  oldPath: string | null
  newPath: string | null
}

/** `in()` filters go into the URL; keep each request well inside its length limit. */
const MOVE_LOOKUP_CHUNK = 50
/** Moves read per chunk. A file moved more often than this shows its newest moves only. */
const MOVE_LOOKUP_ROWS = 500

function detailText(details: unknown, key: string): string | null {
  if (!details || typeof details !== 'object') return null
  const value = (details as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : null
}

/**
 * The newest `move` activity of each file in `fileIds`, keyed by file id. Files the vault never
 * moved have no entry. Read-only and bounded: one request per 50 ids, at most `maxFiles` ids.
 */
export async function getLatestFileMoves(
  fileIds: string[],
  maxFiles = 500,
): Promise<{ moves: Map<string, FileMoveRecord>; error: string | null }> {
  const client = getSupabaseClient()
  const moves = new Map<string, FileMoveRecord>()
  const ids = Array.from(new Set(fileIds)).slice(0, maxFiles)

  for (let start = 0; start < ids.length; start += MOVE_LOOKUP_CHUNK) {
    const chunk = ids.slice(start, start + MOVE_LOOKUP_CHUNK)
    const { data, error } = await client
      .from('activity')
      .select('file_id, user_id, user_email, created_at, details')
      .eq('action', 'move')
      .in('file_id', chunk)
      .order('created_at', { ascending: false })
      .limit(MOVE_LOOKUP_ROWS)

    if (error) return { moves, error: error.message }

    for (const row of data ?? []) {
      if (!row.file_id || !row.created_at || moves.has(row.file_id)) continue
      moves.set(row.file_id, {
        fileId: row.file_id,
        userId: row.user_id,
        userEmail: row.user_email,
        movedAt: row.created_at,
        oldPath: detailText(row.details, 'old_path'),
        newPath: detailText(row.details, 'new_path'),
      })
    }
  }

  return { moves, error: null }
}
