/**
 * Schema 515 refuses deleting a version a released version's closure references (hint
 * `REFERENCED_BY_RELEASE`). A permanent delete must stop there, before the file's references go,
 * and say why in words.
 */
import { describe, expect, it, vi } from 'vitest'

const deleted: string[] = []

const client = {
  from: (table: string) => {
    if (table === 'file') {
      return {
        select: () => ({
          eq: () => ({
            single: async () => ({
              data: { id: 'f1', org_id: 'o1', file_name: 'Bolt.SLDPRT', file_path: 'Parts/Bolt.SLDPRT', deleted_at: '2026-11-01' },
              error: null,
            }),
          }),
        }),
        delete: () => ({
          eq: async () => {
            deleted.push('file')
            return { error: null }
          },
        }),
      }
    }
    if (table === 'activity') return { insert: async () => ({ error: null }) }
    if (table === 'file_version') {
      return {
        delete: () => ({
          eq: async () => ({
            error: { message: 'refused', hint: 'REFERENCED_BY_RELEASE', code: 'P0001' },
          }),
        }),
      }
    }
    return {
      delete: () => ({
        or: async () => {
          deleted.push(table)
          return { error: null }
        },
      }),
    }
  },
}

vi.mock('../client', () => ({ getSupabaseClient: () => client }))

import { permanentlyDeleteFile } from './trash'

describe('permanentlyDeleteFile and a version a release references', () => {
  it('stops before anything else is deleted and explains the refusal', async () => {
    const result = await permanentlyDeleteFile('f1', 'u1')
    expect(result.success).toBe(false)
    expect(result.error).toContain('Bolt.SLDPRT')
    expect(result.error).not.toContain('REFERENCED_BY_RELEASE')
    expect(deleted).toEqual([])
  })
})
