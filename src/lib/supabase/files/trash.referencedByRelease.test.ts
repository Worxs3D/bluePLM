/**
 * Schema 515 refuses deleting a version a released version's closure references (hint
 * `REFERENCED_BY_RELEASE`). A permanent delete must stop there, before the file's references go,
 * say why in words, and write no "permanently deleted" activity row. A delete that goes through
 * writes the row after the file is gone.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const steps: string[] = []
let refuseVersions = true

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
            steps.push('delete file')
            return { error: null }
          },
        }),
      }
    }
    if (table === 'activity') {
      return {
        insert: async () => {
          steps.push('activity')
          return { error: null }
        },
      }
    }
    if (table === 'file_version') {
      return {
        delete: () => ({
          eq: async () => {
            if (refuseVersions) return { error: { message: 'refused', hint: 'REFERENCED_BY_RELEASE', code: 'P0001' } }
            steps.push('delete versions')
            return { error: null }
          },
        }),
      }
    }
    return {
      delete: () => ({
        or: async () => {
          steps.push(`delete ${table}`)
          return { error: null }
        },
      }),
    }
  },
}

vi.mock('../client', () => ({ getSupabaseClient: () => client }))

import { permanentlyDeleteFile } from './trash'

describe('permanentlyDeleteFile and a version a release references', () => {
  beforeEach(() => {
    steps.length = 0
  })

  it('stops before anything else is deleted, logs no activity, and explains the refusal', async () => {
    refuseVersions = true
    const result = await permanentlyDeleteFile('f1', 'u1')
    expect(result.success).toBe(false)
    expect(result.error).toContain('Bolt.SLDPRT')
    expect(result.error).not.toContain('REFERENCED_BY_RELEASE')
    expect(steps).toEqual([])
  })

  it('logs the permanent delete only after the file is gone', async () => {
    refuseVersions = false
    const result = await permanentlyDeleteFile('f1', 'u1')
    expect(result.success).toBe(true)
    expect(steps).toEqual(['delete versions', 'delete file_reference', 'delete file', 'activity'])
  })
})
