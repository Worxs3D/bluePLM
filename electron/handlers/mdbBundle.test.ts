import { describe, expect, it } from 'vitest'
import { computeMdbBundleDigest, serializeMdbBundleManifest } from './mdbBundle'

describe('MDB bundle identity', () => {
  it('is deterministic for sorted normalized entries', () => {
    const first = computeMdbBundleDigest([
      { relativePath: 'public\\index.php', digest: 'b'.repeat(64) },
      { relativePath: '/src/Runtime.php', digest: 'a'.repeat(64) },
    ])
    const second = computeMdbBundleDigest([
      { relativePath: 'src/Runtime.php', digest: 'A'.repeat(64) },
      { relativePath: 'public/index.php', digest: 'B'.repeat(64) },
    ])
    expect(first).toBe(second)
    expect(first).toMatch(/^[a-f0-9]{64}$/)
  })

  it('serializes only the non-secret manifest identity', () => {
    const json = serializeMdbBundleManifest({ version: 1, digest: 'a'.repeat(64), fileCount: 3 })
    expect(JSON.parse(json)).toEqual({ version: 1, digest: 'a'.repeat(64), fileCount: 3 })
    expect(json).not.toMatch(/password|token|secret/i)
  })
})
