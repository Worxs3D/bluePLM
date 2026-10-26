// @vitest-environment jsdom
/**
 * Render-count gate for the file pane and the details panel on a 30k-file vault.
 *
 * Counts, not timings: how many file rows are mounted, how many re-render after one file changes
 * or the selection moves, and how many commits the first mount takes. A row render is counted by
 * wrapping one cell component (ExtensionCell, a default column, one per row render); commits by
 * React's <Profiler>. Wall-clock appears only as a loose ceiling (10x over what CI measures).
 *
 * The vault is workstream C's synthetic one (src/lib/loadPipelineFixtures.ts), its 30k files moved
 * into one folder so the list has 30k rows to window.
 */
import { act, cleanup, render } from '@testing-library/react'
import { createElement, Profiler, type ProfilerOnRenderCallback } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CellRendererBaseProps } from '@/features/source/browser/components/FileList/cells/types'
import type { LocalFile } from '@/stores/types'

vi.mock('@/lib/supabase/client', async (importOriginal) =>
  (await import('@/test/supabaseClientMock')).mockClientModule(await importOriginal()),
)

const rowRenders: string[] = []
vi.mock('@/features/source/browser/components/FileList/cells', async (importOriginal) => {
  const cells = await importOriginal<typeof import('@/features/source/browser/components/FileList/cells')>()
  return {
    ...cells,
    ExtensionCell: (props: CellRendererBaseProps) => {
      rowRenders.push(props.file.path)
      return createElement(cells.ExtensionCell, props)
    },
  }
})

const { FilePane } = await import('@/features/source/browser/FilePane')
const { DetailsPanel } = await import('@/features/source/details/DetailsPanel')
const { usePDMStore } = await import('@/stores/pdmStore')
const { buildLoadedStoreFiles, buildSyntheticVault, FIXTURE_VAULT_ROOT } = await import(
  '@/lib/loadPipelineFixtures'
)
const { VAULT_ID, createHarness } = await import('@/test/harness')
const { installDomShims, lenientElectron, signedInVault } = await import('@/test/render')


const FILE_COUNT = 30_000
const FOLDER = 'Flat'

/** The synthetic vault's files, all in one folder. Built once: the fixture costs ~1 s. */
const flatFiles: LocalFile[] = (() => {
  const files = buildLoadedStoreFiles(buildSyntheticVault(FILE_COUNT)).filter((f) => !f.isDirectory)
  const flat = files.map((f) => ({
    ...f,
    relativePath: `${FOLDER}/${f.name}`,
    path: `${FIXTURE_VAULT_ROOT}\\${FOLDER}\\${f.name}`,
  }))
  flat.push({
    name: FOLDER,
    path: `${FIXTURE_VAULT_ROOT}\\${FOLDER}`,
    relativePath: FOLDER,
    isDirectory: true,
    extension: '',
    size: 0,
    modifiedTime: '2026-10-01T12:00:00.000Z',
  })
  return flat
})()

const commits: Array<{ id: string; phase: string }> = []
const onRender: ProfilerOnRenderCallback = (id, phase) => {
  commits.push({ id, phase })
}

function renderBoth() {
  return render(
    <>
      <Profiler id="pane" onRender={onRender}>
        <FilePane onRefresh={() => {}} />
      </Profiler>
      <Profiler id="details" onRender={onRender}>
        <DetailsPanel />
      </Profiler>
    </>,
  )
}

const mountedRows = () => document.querySelectorAll('tr[data-path]').length
const visiblePaths = () =>
  Array.from(document.querySelectorAll('tr[data-path]')).map((el) => el.getAttribute('data-path')!)

function resetCounts() {
  rowRenders.length = 0
  commits.length = 0
}

beforeEach(async () => {
  const h = await createHarness()
  installDomShims()
  lenientElectron(h)
  signedInVault()
  usePDMStore.setState({
    vaultPath: FIXTURE_VAULT_ROOT,
    connectedVaults: [
      { id: VAULT_ID, name: 'Perf Vault', localPath: FIXTURE_VAULT_ROOT, isExpanded: true, hasCompletedSetup: true },
    ],
    currentFolder: FOLDER,
  })
  usePDMStore.getState().setFiles(flatFiles)
  resetCounts()
})

afterEach(() => {
  cleanup()
})

describe('render counts, 30k-file folder', () => {
  it('mounts only the rows in the virtualization window, in a few commits', () => {
    const started = performance.now()
    renderBoth()
    const elapsed = performance.now() - started

    expect(usePDMStore.getState().files.length).toBe(FILE_COUNT + 1)
    expect(mountedRows()).toBeGreaterThan(10)
    expect(mountedRows()).toBeLessThan(120)
    // Every mounted row rendered at most a couple of times on the way in.
    expect(rowRenders.length).toBeLessThan(mountedRows() * 3)
    expect(commits.filter((c) => c.id === 'pane').length).toBeLessThanOrEqual(8)
    // Loose ceiling: CI mounts this in well under a few seconds.
    expect(elapsed).toBeLessThan(60_000)
  })

  // Measured 2026-10-26: one file change takes 3 pane commits and a selection change 2 (one of
  // them a nested update from the virtualizer's layout effect), and each commit re-renders every
  // mounted row, because every cell reads FilePaneContext, whose value changes with any file or
  // the selection. So the cost is O(window x passes), not O(vault). The gate holds it there:
  // passes pinned, rows per pass bounded by the window, the same at 1k and 30k files. O(1) rows
  // needs FilePaneContext split so cells stop reading all of it (follow-up in the report).
  const UPDATE_PASSES = 3
  const SELECTION_PASSES = 2

  function rowRendersForOneChange(): {
    target: string
    renders: string[]
    mounted: number
    commits: typeof commits
  } {
    renderBoth()
    const target = visiblePaths()[5]
    const before = usePDMStore.getState().files.find((f) => f.path === target)!
    resetCounts()
    // What a realtime UPDATE from another user does to one row.
    act(() => {
      usePDMStore.getState().updateFileInStore(target, {
        pdmData: { ...before.pdmData!, description: 'Changed once' },
      })
    })
    const result = { target, renders: [...rowRenders], mounted: mountedRows(), commits: [...commits] }
    cleanup()
    return result
  }

  it('one file change: passes pinned, rows per pass bounded by the window, independent of vault size', () => {
    const large = rowRendersForOneChange()
    expect(large.renders).toContain(large.target)
    expect(large.commits.filter((c) => c.id === 'pane').length).toBeLessThanOrEqual(UPDATE_PASSES)
    expect(large.renders.length, JSON.stringify(large.commits)).toBeLessThanOrEqual(
      large.mounted * UPDATE_PASSES,
    )
    // No row renders more than once per pass.
    const perRow = new Map<string, number>()
    for (const p of large.renders) perRow.set(p, (perRow.get(p) ?? 0) + 1)
    expect(Math.max(...perRow.values())).toBeLessThanOrEqual(UPDATE_PASSES)

    usePDMStore.getState().setFiles([...flatFiles.slice(0, 1_000), flatFiles[flatFiles.length - 1]])
    const small = rowRendersForOneChange()
    expect(large.renders.length).toBe(small.renders.length)
  })

  it('a selection change: passes pinned, rows bounded by the window, the details panel commits', () => {
    renderBoth()
    const [first, second] = [visiblePaths()[3], visiblePaths()[4]]
    act(() => {
      usePDMStore.getState().setSelectedFiles([first])
    })
    resetCounts()

    act(() => {
      usePDMStore.getState().setSelectedFiles([second])
    })

    expect(rowRenders).toContain(first)
    expect(rowRenders).toContain(second)
    expect(rowRenders.length, JSON.stringify(commits)).toBeLessThanOrEqual(
      mountedRows() * SELECTION_PASSES,
    )
    expect(commits.filter((c) => c.id === 'pane').length).toBeLessThanOrEqual(SELECTION_PASSES)
    expect(commits.some((c) => c.id === 'details')).toBe(true)
  })
})
