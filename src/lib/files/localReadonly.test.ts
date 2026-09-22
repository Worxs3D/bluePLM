import { afterEach, describe, expect, it, vi } from 'vitest'

import { makeFilesWritable, readDiskWriteAccess } from './localReadonly'

type ReadonlyResult = { success: boolean; readonly?: boolean; error?: string }

function install(options: {
  reads: ReadonlyResult[]
  batch?: { success: boolean; results?: Array<{ path: string; success: boolean }> } | null
}) {
  const isReadonly = vi.fn(async () => options.reads.shift() ?? { success: false })
  const setReadonlyBatch = vi.fn(async () => options.batch ?? { success: true, results: [] })
  // @ts-expect-error the test only needs the filesystem surface these functions touch
  globalThis.window = { electronAPI: { isReadonly, setReadonlyBatch } }
  return { isReadonly, setReadonlyBatch }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('readDiskWriteAccess', () => {
  it('reports a read-only file', async () => {
    install({ reads: [{ success: true, readonly: true }] })
    expect(await readDiskWriteAccess('C:\\vault\\a.sldprt')).toBe('readonly')
  })

  it('reports a writable file', async () => {
    install({ reads: [{ success: true, readonly: false }] })
    expect(await readDiskWriteAccess('C:\\vault\\a.sldprt')).toBe('writable')
  })

  it('reports unknown when the attribute cannot be read', async () => {
    install({ reads: [{ success: false, error: 'locked' }] })
    expect(await readDiskWriteAccess('C:\\vault\\a.sldprt')).toBe('unknown')
  })
})

describe('makeFilesWritable', () => {
  it('retries once and returns only the paths that stay unwritable', async () => {
    const { setReadonlyBatch } = install({
      reads: [
        { success: true, readonly: true },
        { success: true, readonly: false },
        { success: true, readonly: true },
        { success: true, readonly: true },
      ],
    })

    const still = await makeFilesWritable(['C:\\vault\\stuck.sldprt', 'C:\\vault\\ok.sldprt'])

    expect(setReadonlyBatch).toHaveBeenCalledTimes(2)
    expect(still).toEqual(['C:\\vault\\stuck.sldprt'])
  })

  it('does nothing for an empty list', async () => {
    const { setReadonlyBatch } = install({ reads: [] })
    expect(await makeFilesWritable([])).toEqual([])
    expect(setReadonlyBatch).not.toHaveBeenCalled()
  })
})
