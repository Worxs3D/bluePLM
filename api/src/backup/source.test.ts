import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

import { isUnknownTableError, SourceError, SupabaseBackupSource } from './source'

function sourceAnswering(error: { code: string; message: string }) {
  const admin = { rpc: async () => ({ data: null, error }) } as unknown as SupabaseClient
  return new SupabaseBackupSource(admin, 'org', 'https://example.supabase.co')
}

describe('SupabaseBackupSource.exportTable', () => {
  it('treats a table the database does not list yet (22023, one release behind) as missing', async () => {
    const source = sourceAnswering({
      code: '22023',
      message: 'backup_list_org_rows: unknown table file_version_output',
    })
    await expect(source.exportTable('file_version_output', null, 10)).resolves.toEqual({ missing: true })
  })

  it('still fails on any other error', async () => {
    const source = sourceAnswering({ code: '22023', message: 'invalid input syntax' })
    await expect(source.exportTable('file', null, 10)).rejects.toBeInstanceOf(SourceError)
    expect(isUnknownTableError({ code: '42501', message: 'backup_list_org_rows: unknown table x' })).toBe(false)
  })
})
