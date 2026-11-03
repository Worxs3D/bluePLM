import { beforeEach, describe, expect, it, vi } from 'vitest'

import { usePDMStore } from '@/stores/pdmStore'
import type { VersionOutput } from '@/types/versionOutputs'

const recorded: VersionOutput = {
  id: 'o1',
  kind: 'step',
  fileId: 'f',
  fileVersionId: 'v1',
  configuration: null,
  storageHash: 'a'.repeat(64),
  fileSize: 1,
  fileName: 'P.step',
  closureExact: true,
  generatedBy: null,
  generatedAt: '2026-11-03T00:00:00Z',
}

const getModelOutput = vi.fn(async () => recorded)
vi.mock('@/lib/supabase/versionOutputs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/supabase/versionOutputs')>()),
  getModelOutput: () => getModelOutput(),
}))
// The web build: anything past the cache check answers desktop_only, so nothing is generated.
vi.mock('@/lib/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/platform')>()),
  hasDesktop: () => false,
}))

import { ensureVersionOutput } from './ensure'

type Role = ReturnType<ReturnType<typeof usePDMStore.getState>['getEffectiveRole']>
const asRole = (role: Role) => usePDMStore.setState({ getEffectiveRole: () => role })

describe('ensureVersionOutput regenerate', () => {
  beforeEach(() => getModelOutput.mockClear())

  it('is an ordinary ensure for a non-administrator: the recorded output comes back', async () => {
    asRole('engineer')
    expect(await ensureVersionOutput('v1', 'step', { regenerate: true })).toEqual({ status: 'cached', output: recorded })
    expect(getModelOutput).toHaveBeenCalledTimes(1)
  })

  it('skips the recorded output for an administrator', async () => {
    asRole('admin')
    expect(await ensureVersionOutput('v1', 'step', { regenerate: true })).toEqual({ status: 'desktop_only' })
    expect(getModelOutput).not.toHaveBeenCalled()
  })
})
