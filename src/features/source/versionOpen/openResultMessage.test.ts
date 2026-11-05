import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/reviews', () => ({ getVersionDependencyClosure: vi.fn() }))

import type { OpenVersionResult } from '@/lib/versionOpen'

import { describeOpenResult, progressStatus } from './openResultMessage'

const file = { name: 'Frame.SLDASM', version: 4 }

function opened(extra: Partial<Extract<OpenVersionResult, { status: 'opened' }>> = {}): OpenVersionResult {
  return {
    status: 'opened',
    path: 'C:/cache/v1/Frame.SLDASM',
    reused: false,
    exact: true,
    approximate: false,
    missing: 0,
    conflicts: 0,
    retargetFailed: 0,
    retargetMissing: 0,
    ...extra,
  }
}

describe('describeOpenResult', () => {
  it('is a success for an exact open', () => {
    const { tone, message } = describeOpenResult(opened(), file)
    expect(tone).toBe('success')
    expect(message).toContain('Frame.SLDASM')
    expect(message).toContain('read-only')
  })

  it('warns when the closure is approximate', () => {
    const { tone, message } = describeOpenResult(opened({ exact: false, approximate: true }), file)
    expect(tone).toBe('warning')
    expect(message).toContain('predates exact reference tracking')
  })

  it('counts missing references, conflicts and retarget failures', () => {
    const { tone, message } = describeOpenResult(opened({ exact: false, missing: 2, conflicts: 1, retargetFailed: 3 }), file)
    expect(tone).toBe('warning')
    expect(message).toContain('2 references are not in the vault')
    expect(message).toContain('1 file is referenced at two versions')
    expect(message).toContain('3 files could not be pointed')
  })

  it('names at most three open documents to close', () => {
    const { tone, message } = describeOpenResult(
      { status: 'same_name_open', documents: ['C:\\V\\a.sldprt', 'C:/V/b.sldprt', 'c.sldprt', 'd.sldprt'] },
      file,
    )
    expect(tone).toBe('warning')
    expect(message).toContain('a.sldprt, b.sldprt, c.sldprt, …')
  })

  it('says what the service needs', () => {
    expect(describeOpenResult({ status: 'needs_service', reason: 'service_offline' }, file).message).toContain('Start')
    expect(describeOpenResult({ status: 'needs_service', reason: 'service_outdated' }, file).message).toContain('1.26.0')
  })

  it('reports failures in words', () => {
    const { tone, message } = describeOpenResult({ status: 'failed', error: 'HTTP 404' }, file)
    expect(tone).toBe('error')
    expect(message).toBe('Could not open Frame.SLDASM version 4: HTTP 404')
  })

  it('has a status line for every phase', () => {
    for (const phase of ['resolving', 'checking', 'downloading', 'retargeting', 'opening'] as const) {
      expect(progressStatus(phase)).not.toContain('versionOpen.')
    }
  })
})
