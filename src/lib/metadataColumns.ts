import type { FileMetadataColumn } from '@/types/database'
import { routeBackend } from './backendAdapter'
import {
  createCommunityMetadataColumn,
  deleteCommunityMetadataColumn,
  getCommunityMetadataColumns,
  updateCommunityMetadataColumn,
} from './community'
import { supabase } from './supabase'

type MetadataColumnCreate = Omit<
  FileMetadataColumn,
  'id' | 'org_id' | 'created_at' | 'updated_at' | 'updated_by'
>
type MetadataColumnUpdate = Partial<
  Omit<FileMetadataColumn, 'id' | 'org_id' | 'created_at' | 'created_by'>
>

const db = supabase as any // TODO: type custom metadata mutations in the generated schema

export async function getMetadataColumns(organizationId: string): Promise<FileMetadataColumn[]> {
  return routeBackend({
    mdb: async () => (await getCommunityMetadataColumns()) as FileMetadataColumn[],
    supabase: async () => {
      const { data, error } = await supabase
        .from('file_metadata_columns')
        .select('*')
        .eq('org_id', organizationId)
        .order('sort_order')
      if (error) throw error
      return data || []
    },
  })
}

export async function createMetadataColumn(payload: MetadataColumnCreate): Promise<void> {
  return routeBackend({
    mdb: () => createCommunityMetadataColumn(payload),
    supabase: async () => {
      const { error } = await db.from('file_metadata_columns').insert(payload)
      if (error) throw error
    },
  })
}

export async function updateMetadataColumn(
  columnId: string,
  payload: MetadataColumnUpdate,
): Promise<void> {
  return routeBackend({
    mdb: () => updateCommunityMetadataColumn(columnId, payload),
    supabase: async () => {
      const { error } = await db.from('file_metadata_columns').update(payload).eq('id', columnId)
      if (error) throw error
    },
  })
}

export async function deleteMetadataColumn(columnId: string): Promise<void> {
  return routeBackend({
    mdb: () => deleteCommunityMetadataColumn(columnId),
    supabase: async () => {
      const { error } = await supabase.from('file_metadata_columns').delete().eq('id', columnId)
      if (error) throw error
    },
  })
}
