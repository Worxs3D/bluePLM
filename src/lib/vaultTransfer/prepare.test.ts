import { describe, expect, it } from 'vitest'

import type { LocalFile } from '@/stores/types'

import { prepareVaultTransfer, type PrepareDeps } from './prepare'

function file(relativePath: string): LocalFile {
  return {
    name: relativePath.split('/').pop() ?? relativePath,
    path: `C:\\a\\${relativePath}`,
    relativePath,
    isDirectory: false,
    extension: '.sldprt',
    size: 1,
    modifiedTime: '',
  }
}

function deps(overrides: Partial<PrepareDeps> & { onDisk?: string[]; onServer?: string[] } = {}) {
  const onDisk = new Set((overrides.onDisk ?? []).map((path) => path.toLowerCase()))
  const probed: string[] = []
  const loads: string[] = []

  const result: PrepareDeps = {
    fileExists: async (absolutePath) => {
      probed.push(absolutePath)
      return absolutePath === 'C:\\b' || onDisk.has(absolutePath.toLowerCase())
    },
    loadIndex: async (_orgId, vaultId) => {
      loads.push(vaultId)
      return { ok: true, serverPaths: new Set(overrides.onServer ?? []) }
    },
    joinPath: (vaultPath, relativePath) => `${vaultPath}\\${relativePath.replace(/\//g, '\\')}`,
    ...overrides,
  }
  return { deps: result, probed, loads }
}

const baseInput = {
  orgId: 'org',
  destVaultId: 'vault-b',
  destVaultPath: 'C:\\b',
  options: { mode: 'copy' as const, destFolder: '', keepPath: false },
}

describe('prepareVaultTransfer', () => {
  it('plans against what the destination holds on the server and on disk', async () => {
    const files = [file('a.SLDPRT'), file('b.SLDPRT'), file('c.SLDPRT')]
    const { deps: d } = deps({ onServer: ['a.sldprt'], onDisk: ['C:\\b\\b.SLDPRT'] })

    const result = await prepareVaultTransfer(
      { ...baseInput, selection: files, vaultFiles: files },
      d,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.files.map((entry) => entry.sourceRelativePath)).toEqual(['c.SLDPRT'])
    expect(Object.fromEntries(result.plan.skipped.map((s) => [s.relativePath, s.reason]))).toEqual(
      { 'a.SLDPRT': 'exists-in-destination', 'b.SLDPRT': 'exists-on-disk' },
    )
  })

  it('refuses a folder that could leave the vault before touching anything', async () => {
    const { deps: d, probed, loads } = deps()

    const result = await prepareVaultTransfer(
      {
        ...baseInput,
        selection: [file('a.SLDPRT')],
        vaultFiles: [],
        options: { ...baseInput.options, destFolder: '../Elsewhere' },
      },
      d,
    )

    expect(result).toEqual({ ok: false, failure: 'invalid-folder' })
    expect(probed).toHaveLength(0)
    expect(loads).toHaveLength(0)
  })

  it('refuses a destination whose folder is gone, without reading the server', async () => {
    const { deps: d, loads } = deps({ fileExists: async () => false })

    const result = await prepareVaultTransfer(
      { ...baseInput, selection: [file('a.SLDPRT')], vaultFiles: [] },
      d,
    )

    expect(result).toEqual({ ok: false, failure: 'destination-missing' })
    expect(loads).toHaveLength(0)
  })

  it('reports an unreadable destination instead of planning against an empty one', async () => {
    // An empty index would read as "nothing is taken", the one answer that must not be guessed.
    const { deps: d } = deps({ loadIndex: async () => ({ ok: false, error: 'rls' }) })

    const result = await prepareVaultTransfer(
      { ...baseInput, selection: [file('a.SLDPRT')], vaultFiles: [] },
      d,
    )

    expect(result).toEqual({ ok: false, failure: 'destination-unreadable', message: 'rls' })
  })

  it('reuses an index it was given', async () => {
    const files = [file('a.SLDPRT')]
    const { deps: d, loads } = deps()

    const result = await prepareVaultTransfer(
      {
        ...baseInput,
        selection: files,
        vaultFiles: files,
        serverPaths: new Set(['a.sldprt']),
      },
      d,
    )

    expect(loads).toHaveLength(0)
    expect(result.ok && result.plan.files).toHaveLength(0)
  })

  it('normalizes the destination folder it plans into', async () => {
    const files = [file('a.SLDPRT')]
    const { deps: d } = deps()

    const result = await prepareVaultTransfer(
      {
        ...baseInput,
        selection: files,
        vaultFiles: files,
        options: { ...baseInput.options, destFolder: 'Incoming\\Parts\\' },
      },
      d,
    )

    expect(result.ok && result.plan.files[0].destRelativePath).toBe('Incoming/Parts/a.SLDPRT')
  })
})
