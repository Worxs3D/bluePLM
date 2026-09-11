/**
 * Table-driven coverage for `analyzeAlignment`. Every bucket is exercised in isolation, plus the
 * two behaviours the plan calls out as easy to get wrong: a `moved`/`moved_away` pair counted
 * once (not twice), and a repairable row demoted to `blocked_checkout` by somebody else's
 * checkout.
 */

import { describe, expect, it } from 'vitest'

import type { PDMFile } from '@/types/pdm'
import type { DiffStatus, LocalFile } from '@/stores/types'
import { ALIGNMENT_SAMPLE_LIMIT, type AlignmentBucketId } from '@/types/realign'

import { analyzeAlignment } from './analyzeAlignment'

const ME = 'user-me'
const OTHER = 'user-other'
const VAULT_ID = 'vault-1'

interface PdmOptions {
  checkedOutBy?: string | null
  holderName?: string | null
  holderEmail?: string
  filePath?: string
}

/** A minimal server row. Only the fields this module reads are populated. */
function pdm(fileId: string, options: PdmOptions = {}): PDMFile {
  const checkedOutBy = options.checkedOutBy ?? null
  return {
    id: fileId,
    file_path: options.filePath,
    checked_out_by: checkedOutBy,
    checked_out_user: checkedOutBy
      ? {
          id: checkedOutBy,
          email: options.holderEmail ?? `${checkedOutBy}@example.com`,
          full_name: options.holderName ?? null,
          avatar_url: null,
        }
      : null,
  } as unknown as PDMFile
}

interface RowOptions {
  diffStatus?: DiffStatus
  isDirectory?: boolean
  pdmData?: PDMFile
  movedToRelativePath?: string
}

function row(relativePath: string, options: RowOptions = {}): LocalFile {
  return {
    name: relativePath.split('/').pop()!,
    path: `C:/vault/${relativePath}`,
    relativePath,
    isDirectory: options.isDirectory ?? false,
    extension: relativePath.includes('.') ? relativePath.split('.').pop()! : '',
    size: 0,
    modifiedTime: '2026-01-01T00:00:00.000Z',
    diffStatus: options.diffStatus,
    pdmData: options.pdmData,
    movedToRelativePath: options.movedToRelativePath,
  } as LocalFile
}

function analyze(files: LocalFile[], currentUserId = ME) {
  return analyzeAlignment({
    files,
    serverFileCount: files.filter((f) => f.pdmData?.id).length,
    vaultId: VAULT_ID,
    currentUserId,
  })
}

function bucket(report: ReturnType<typeof analyze>, id: AlignmentBucketId) {
  const found = report.buckets.find((b) => b.id === id)
  if (!found) throw new Error(`bucket ${id} missing from report`)
  return found
}

describe('bucket shape', () => {
  it('always contains all nine bucket ids, in stable order, even for an empty vault', () => {
    const report = analyze([])

    expect(report.buckets.map((b) => b.id)).toEqual([
      'pending_move',
      'orphaned',
      'outdated',
      'cloud_only',
      'local_only',
      'modified',
      'ghost',
      'ignored',
      'blocked_checkout',
    ])
    expect(report.buckets.every((b) => b.count === 0 && b.sample.length === 0)).toBe(true)
    expect(report.pendingMoveItems).toEqual([])
    expect(report.isAligned).toBe(true)
    expect(report.localFileCount).toBe(0)
    expect(report.inSyncCount).toBe(0)
  })

  it('assigns the documented disposition to every bucket', () => {
    const report = analyze([])
    const dispositionOf = (id: AlignmentBucketId) => bucket(report, id).disposition

    expect(dispositionOf('pending_move')).toBe('repairable')
    expect(dispositionOf('orphaned')).toBe('repairable')
    expect(dispositionOf('outdated')).toBe('repairable')
    expect(dispositionOf('cloud_only')).toBe('informational')
    expect(dispositionOf('local_only')).toBe('needs_decision')
    expect(dispositionOf('modified')).toBe('needs_decision')
    expect(dispositionOf('ghost')).toBe('needs_decision')
    expect(dispositionOf('ignored')).toBe('informational')
    expect(dispositionOf('blocked_checkout')).toBe('informational')
  })
})

describe('each bucket in isolation', () => {
  const cases: Array<{
    name: string
    diffStatus: DiffStatus
    expectedBucket: AlignmentBucketId
  }> = [
    { name: 'deleted_remote -> orphaned', diffStatus: 'deleted_remote', expectedBucket: 'orphaned' },
    { name: 'outdated -> outdated', diffStatus: 'outdated', expectedBucket: 'outdated' },
    { name: 'cloud -> cloud_only', diffStatus: 'cloud', expectedBucket: 'cloud_only' },
    { name: 'added -> local_only', diffStatus: 'added', expectedBucket: 'local_only' },
    { name: 'modified -> modified', diffStatus: 'modified', expectedBucket: 'modified' },
    { name: 'deleted -> ghost', diffStatus: 'deleted', expectedBucket: 'ghost' },
    { name: 'ignored -> ignored', diffStatus: 'ignored', expectedBucket: 'ignored' },
  ]

  for (const { name, diffStatus, expectedBucket } of cases) {
    it(name, () => {
      const report = analyze([row('a/file.sldprt', { diffStatus, pdmData: pdm('f1') })])

      expect(bucket(report, expectedBucket).count).toBe(1)
      expect(bucket(report, expectedBucket).sample[0]).toMatchObject({
        relativePath: 'a/file.sldprt',
        fileName: 'file.sldprt',
        fileId: 'f1',
        bucket: expectedBucket,
      })

      const otherBuckets = report.buckets.filter((b) => b.id !== expectedBucket)
      expect(otherBuckets.every((b) => b.count === 0)).toBe(true)
    })
  }

  it('an in-sync row (no diffStatus) lands in no bucket', () => {
    const report = analyze([row('a/file.sldprt', { pdmData: pdm('f1') })])

    expect(report.buckets.every((b) => b.count === 0)).toBe(true)
    expect(report.isAligned).toBe(true)
    expect(report.localFileCount).toBe(1)
    expect(report.inSyncCount).toBe(1)
  })
})

describe('pending_move pairing', () => {
  it('counts a moved row and its moved_away stub once, keyed on the moved row', () => {
    const movedRow = row('new/part.sldprt', {
      diffStatus: 'moved',
      pdmData: pdm('f1', { filePath: 'old/part.sldprt' }),
    })
    const stub = row('old/part.sldprt', {
      diffStatus: 'moved_away',
      pdmData: pdm('f1', { filePath: 'old/part.sldprt' }),
      movedToRelativePath: 'new/part.sldprt',
    })

    const report = analyze([movedRow, stub])

    expect(bucket(report, 'pending_move').count).toBe(1)
    expect(bucket(report, 'pending_move').sample[0]).toMatchObject({
      relativePath: 'new/part.sldprt',
      movedToRelativePath: 'new/part.sldprt',
      serverRelativePath: 'old/part.sldprt',
      fileId: 'f1',
    })
    expect(report.pendingMoveItems).toHaveLength(1)
    expect(report.pendingMoveItems[0].serverRelativePath).toBe('old/part.sldprt')
  })

  it('counts a pair where only the stub is present, keyed on the stub', () => {
    const stub = row('old/part.sldprt', {
      diffStatus: 'moved_away',
      pdmData: pdm('f1'),
      movedToRelativePath: 'new/part.sldprt',
    })

    const report = analyze([stub])

    expect(bucket(report, 'pending_move').count).toBe(1)
    expect(bucket(report, 'pending_move').sample[0]).toMatchObject({
      relativePath: 'old/part.sldprt',
      movedToRelativePath: 'new/part.sldprt',
      serverRelativePath: 'old/part.sldprt',
      fileId: 'f1',
    })
  })

  it('counts a pair where only the moved row is present (no stub), with no destination', () => {
    const movedRow = row('new/part.sldprt', {
      diffStatus: 'moved',
      pdmData: pdm('f1', { filePath: 'old/part.sldprt' }),
    })

    const report = analyze([movedRow])

    expect(bucket(report, 'pending_move').count).toBe(1)
    expect(bucket(report, 'pending_move').sample[0].movedToRelativePath).toBeUndefined()
    expect(bucket(report, 'pending_move').sample[0].serverRelativePath).toBe('old/part.sldprt')
  })

  it('does not double count when both halves of several pairs are present', () => {
    const files = [1, 2, 3].flatMap((n) => [
      row(`new/${n}.sldprt`, { diffStatus: 'moved', pdmData: pdm(`f${n}`) }),
      row(`old/${n}.sldprt`, {
        diffStatus: 'moved_away',
        pdmData: pdm(`f${n}`),
        movedToRelativePath: `new/${n}.sldprt`,
      }),
    ])

    const report = analyze(files)

    expect(bucket(report, 'pending_move').count).toBe(3)
  })
})

describe('blocked_checkout demotes the three repairable buckets', () => {
  it('demotes a pending move held by another user, and reports the holder', () => {
    const movedRow = row('new/part.sldprt', {
      diffStatus: 'moved',
      pdmData: pdm('f1', { checkedOutBy: OTHER, holderName: 'Ana Ruiz' }),
    })

    const report = analyze([movedRow])

    expect(bucket(report, 'pending_move').count).toBe(0)
    expect(report.pendingMoveItems).toEqual([])
    expect(bucket(report, 'blocked_checkout').count).toBe(1)
    expect(bucket(report, 'blocked_checkout').sample[0]).toMatchObject({
      heldByUserId: OTHER,
      heldBy: 'Ana Ruiz',
    })
  })

  it('demotes an orphan held by another user', () => {
    const orphan = row('gone.sldprt', {
      diffStatus: 'deleted_remote',
      pdmData: pdm('f2', { checkedOutBy: OTHER }),
    })

    const report = analyze([orphan])

    expect(bucket(report, 'orphaned').count).toBe(0)
    expect(bucket(report, 'blocked_checkout').count).toBe(1)
    expect(bucket(report, 'blocked_checkout').sample[0].heldByUserId).toBe(OTHER)
  })

  it('demotes an outdated file held by another user', () => {
    const outdated = row('old.sldprt', {
      diffStatus: 'outdated',
      pdmData: pdm('f3', { checkedOutBy: OTHER }),
    })

    const report = analyze([outdated])

    expect(bucket(report, 'outdated').count).toBe(0)
    expect(bucket(report, 'blocked_checkout').count).toBe(1)
  })

  it('demotes an outdated file even when the current user holds the checkout', () => {
    // "nobody holds a checkout (neither the current user nor anyone else)" - outdated is
    // stricter than pending_move/orphaned, which only care about somebody else's checkout.
    const outdated = row('old.sldprt', {
      diffStatus: 'outdated',
      pdmData: pdm('f3', { checkedOutBy: ME }),
    })

    const report = analyze([outdated])

    expect(bucket(report, 'outdated').count).toBe(0)
    expect(bucket(report, 'blocked_checkout').count).toBe(1)
    expect(bucket(report, 'blocked_checkout').sample[0].heldByUserId).toBe(ME)
  })

  it('does not demote a pending move or orphan the current user holds themselves', () => {
    const movedRow = row('new/part.sldprt', {
      diffStatus: 'moved',
      pdmData: pdm('f1', { checkedOutBy: ME }),
    })
    const orphan = row('gone.sldprt', {
      diffStatus: 'deleted_remote',
      pdmData: pdm('f2', { checkedOutBy: ME }),
    })

    const report = analyze([movedRow, orphan])

    expect(bucket(report, 'pending_move').count).toBe(1)
    expect(bucket(report, 'orphaned').count).toBe(1)
    expect(bucket(report, 'blocked_checkout').count).toBe(0)
  })

  it('reports selfHeldCount for an outdated row the current user holds themselves', () => {
    const outdated = row('old.sldprt', {
      diffStatus: 'outdated',
      pdmData: pdm('f3', { checkedOutBy: ME }),
    })

    const report = analyze([outdated])

    expect(bucket(report, 'blocked_checkout').selfHeldCount).toBe(1)
  })

  it('leaves selfHeldCount at 0 when the blocking checkout belongs to someone else', () => {
    const orphan = row('gone.sldprt', {
      diffStatus: 'deleted_remote',
      pdmData: pdm('f2', { checkedOutBy: OTHER }),
    })

    const report = analyze([orphan])

    expect(bucket(report, 'blocked_checkout').count).toBe(1)
    expect(bucket(report, 'blocked_checkout').selfHeldCount).toBe(0)
  })

  it('leaves selfHeldCount at 0 for every non-blocked_checkout bucket', () => {
    const report = analyze([
      row('gone.sldprt', { diffStatus: 'deleted_remote', pdmData: pdm('f1') }),
      row('local.sldprt', { diffStatus: 'added' }),
    ])

    expect(report.buckets.every((b) => b.selfHeldCount === 0)).toBe(true)
  })

  it('falls back to no heldBy when the checkout profile has not hydrated', () => {
    const orphan = row('gone.sldprt', {
      diffStatus: 'deleted_remote',
      pdmData: pdm('f2', { checkedOutBy: OTHER }),
    })
    // Simulate an unhydrated profile: checked_out_by present, checked_out_user absent.
    orphan.pdmData!.checked_out_user = null

    const report = analyze([orphan])

    expect(bucket(report, 'blocked_checkout').sample[0]).toMatchObject({ heldByUserId: OTHER })
    expect(bucket(report, 'blocked_checkout').sample[0].heldBy).toBeUndefined()
  })
})

describe('directories', () => {
  it('are never classified into any bucket and do not affect counts', () => {
    const dir = row('folder', { isDirectory: true, diffStatus: 'added' })
    const file = row('folder/file.sldprt', { diffStatus: 'added' })

    const report = analyze([dir, file])

    expect(bucket(report, 'local_only').count).toBe(1)
    expect(report.localFileCount).toBe(1)
    expect(report.buckets.reduce((sum, b) => sum + b.count, 0)).toBe(1)
  })
})

describe('isAligned', () => {
  it('is true when every repairable bucket is empty, even with non-repairable divergence', () => {
    const report = analyze([
      row('cloud.sldprt', { diffStatus: 'cloud', pdmData: pdm('f1') }),
      row('local.sldprt', { diffStatus: 'added' }),
      row('mod.sldprt', { diffStatus: 'modified', pdmData: pdm('f2') }),
    ])

    expect(report.isAligned).toBe(true)
  })

  it('is false when any repairable bucket has a count', () => {
    const report = analyze([
      row('gone.sldprt', { diffStatus: 'deleted_remote', pdmData: pdm('f1') }),
    ])

    expect(report.isAligned).toBe(false)
  })
})

describe('sample cap', () => {
  it('caps sample at ALIGNMENT_SAMPLE_LIMIT while count reflects the true total', () => {
    const total = ALIGNMENT_SAMPLE_LIMIT + 10
    const files = Array.from({ length: total }, (_, i) =>
      row(`local-${i}.sldprt`, { diffStatus: 'added' }),
    )

    const report = analyze(files)

    expect(bucket(report, 'local_only').count).toBe(total)
    expect(bucket(report, 'local_only').sample).toHaveLength(ALIGNMENT_SAMPLE_LIMIT)
  })

  it('keeps pendingMoveItems uncapped while the pending_move sample stays capped', () => {
    const total = ALIGNMENT_SAMPLE_LIMIT + 10
    const files = Array.from({ length: total }, (_, i) =>
      row(`new/${i}.sldprt`, {
        diffStatus: 'moved',
        pdmData: pdm(`f${i}`, { filePath: `old/${i}.sldprt` }),
      }),
    )

    const report = analyze(files)

    expect(bucket(report, 'pending_move').count).toBe(total)
    expect(bucket(report, 'pending_move').sample).toHaveLength(ALIGNMENT_SAMPLE_LIMIT)
    expect(report.pendingMoveItems).toHaveLength(total)
    expect(report.pendingMoveItems.every((item) => item.serverRelativePath?.startsWith('old/'))).toBe(
      true,
    )
  })
})

describe('orientation counts', () => {
  it('reports server file count straight from the input and derives local/in-sync counts', () => {
    const report = analyzeAlignment({
      files: [
        row('synced.sldprt', { pdmData: pdm('f1') }),
        row('cloud.sldprt', { diffStatus: 'cloud', pdmData: pdm('f2') }),
        row('ghost.sldprt', { diffStatus: 'deleted', pdmData: pdm('f3', { checkedOutBy: ME }) }),
        row('local.sldprt', { diffStatus: 'added' }),
      ],
      serverFileCount: 42,
      vaultId: VAULT_ID,
      currentUserId: ME,
    })

    expect(report.serverFileCount).toBe(42)
    // Local presence: synced + local (added) count; cloud and ghost (deleted) do not.
    expect(report.localFileCount).toBe(2)
    expect(report.inSyncCount).toBe(1)
  })
})
