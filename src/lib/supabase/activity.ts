import { getSupabaseClient } from './client'
import { getCommunityActivity, getCommunityFileActivity, isBackendConfigured } from '@/lib/community'

// ============================================
// Activity Log
// ============================================

export async function getRecentActivity(orgId: string, limit = 50) {
  if (isBackendConfigured('community')) {
    try {
      return { activity: await getCommunityActivity(limit), error: null }
    } catch (error) {
      return { activity: null, error: error instanceof Error ? error : new Error(String(error)) }
    }
  }
  const client = getSupabaseClient()
  const { data, error } = await client
    .from('activity')
    .select(
      `
      *,
      file:files(file_name, file_path)
    `,
    )
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(limit)

  return { activity: data, error }
}

export async function getFileActivity(fileId: string, limit = 20) {
  if (isBackendConfigured('community')) {
    try {
      return { activity: await getCommunityFileActivity(fileId, limit), error: null }
    } catch (error) {
      return { activity: null, error: error instanceof Error ? error : new Error(String(error)) }
    }
  }
  const client = getSupabaseClient()
  const { data, error } = await client
    .from('activity')
    .select('*')
    .eq('file_id', fileId)
    .order('created_at', { ascending: false })
    .limit(limit)

  return { activity: data, error }
}
