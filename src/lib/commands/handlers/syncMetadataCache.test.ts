import { beforeEach, describe, expect, it } from 'vitest'

import { usePDMStore } from '../../../stores/pdmStore'

import { collectStaleConfigPaths, evictConfigDrawingRows } from './syncMetadataCache'

const PART = 'C:\\vault\\Parts\\FILL-HEAD-TUBE-CARTRIDGE.SLDPRT'
const OTHER_PART = 'C:\\vault\\Parts\\OTHER.SLDPRT'
const ASSEMBLY = 'C:\\vault\\Assemblies\\TOP.SLDASM'

function seed(keys: string[]): void {
  usePDMStore.setState({ configDrawingData: new Map(keys.map((key) => [key, []])) })
}

function remainingKeys(): string[] {
  return Array.from(usePDMStore.getState().configDrawingData.keys())
}

describe('collectStaleConfigPaths', () => {
  it('merges the synced parts with the parents their drawings resolved to, ignoring gaps', () => {
    const paths = collectStaleConfigPaths([PART], [ASSEMBLY, null, undefined])

    expect(paths.size).toBe(2)
  })
})

describe('evictConfigDrawingRows', () => {
  beforeEach(() => {
    usePDMStore.setState({ configDrawingData: new Map() })
  })

  it('drops every configuration of a synced part and leaves other parts alone', () => {
    seed([`${PART}::0375`, `${PART}::01875`, `${OTHER_PART}::Default`])

    const evicted = evictConfigDrawingRows(collectStaleConfigPaths([PART], []))

    expect(evicted).toBe(2)
    expect(remainingKeys()).toEqual([`${OTHER_PART}::Default`])
  })

  it('matches a drawing parent in another casing and slash style', () => {
    seed([`${PART}::0375`, `${OTHER_PART}::Default`])

    const parent = PART.toLowerCase().replace(/\\/g, '/')
    evictConfigDrawingRows(collectStaleConfigPaths([], [parent]))

    expect(remainingKeys()).toEqual([`${OTHER_PART}::Default`])
  })

  it('does nothing when nothing was synced', () => {
    seed([`${PART}::0375`])

    expect(evictConfigDrawingRows(new Set())).toBe(0)
    expect(remainingKeys()).toEqual([`${PART}::0375`])
  })
})
