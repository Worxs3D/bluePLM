// @vitest-environment jsdom
/**
 * The nightly render-performance session in jsdom, with counts instead of timings: the real App
 * over the perf boot's fakes (the same as appBoot.test.tsx), driven through `window.__blueplmPerf`
 * the way scripts/render-perf/run.ts drives it in Electron.
 *
 * - Heap: the nightly measured ~165 MB per 10 minutes. Every store write makes a new `files`
 *   array; after a garbage collection no list from the middle of the session may be alive. Two
 *   retainers kept them: tree rows whose memo comparator skipped renders kept handlers closing
 *   over old FileTree renders, and memoized callbacks with different inputs in FilePane and
 *   CrumbBar chained each render's scope to the previous one (useStableCallback, paneReaders).
 * - Realtime: a burst of updates is one batched store write, plus one for the checkout profiles
 *   it looked up. Each store write is a synchronous re-render of the explorer and the file list.
 *   Per-event lookups are gated by row reads in src/perf/storeRealtime.perf.test.ts.
 */
import { render } from '@testing-library/react'
import { setFlagsFromString } from 'node:v8'
import { runInNewContext } from 'node:vm'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { installDomShims } from '@/test/render'

vi.mock('@/lib/supabase/client', async () => await import('./supabaseClient'))

setFlagsFromString('--expose-gc')
const gc = runInNewContext('gc') as () => void

// WeakRef is in Node; the renderer's TypeScript lib predates it.
interface Ref {
  deref(): object | undefined
}
const WeakRefOf = (globalThis as unknown as { WeakRef: new (target: object) => Ref }).WeakRef

const FILE_COUNT = 3_000
const CYCLES = 12

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function boot() {
  installDomShims()
  const { installPerfBoot } = await import('./boot')
  await installPerfBoot(FILE_COUNT)
  const { App } = await import('@/app/App')
  const { usePDMStore } = await import('@/stores/pdmStore')
  render(<App />)
  const perf = window.__blueplmPerf!
  const deadline = Date.now() + 45_000
  while (!perf.loaded && Date.now() < deadline) await pause(100)
  expect(perf.loaded).toBeTruthy()
  return { perf, store: usePDMStore }
}

let env: Awaited<ReturnType<typeof boot>>

beforeAll(async () => {
  env = await boot()
}, 60_000)

/** Wait out the realtime batching windows (250 ms quiet) and the lookups they start. */
const settle = () => pause(700)

describe('render-perf session in jsdom', () => {
  it('applies a burst of 500 realtime updates in at most two store writes', async () => {
    const { perf, store } = env
    await perf.expandFolders(['P00', 'P00/Assy-00', 'P00/Assy-00/Sub-00'])
    await settle()
    let writes = 0
    const unsubscribe = store.subscribe((s, prev) => {
      if (s.files !== prev.files) writes += 1
    })
    const delivered = await perf.realtimeBurst(500)
    await settle()
    unsubscribe()

    expect(delivered).toBeGreaterThan(0)
    // The batch, then the checkout owners' profiles. (In the nightly each profile that resolved
    // on its own flushed the batch: a store write and a full re-render per checkout taken from
    // this user. This vault's burst takes none, so the nightly is what measures that part.)
    expect(writes).toBeLessThanOrEqual(2)
  }, 30_000)

  it('keeps no old file list alive across a session with folders expanded', async () => {
    const { perf, store } = env
    const generations: Ref[] = []
    const unsubscribe = store.subscribe((s, prev) => {
      if (s.files !== prev.files) generations.push(new WeakRefOf(s.files))
    })

    // The nightly's session cycle (sessionSteps in scripts/render-perf/run.ts), without the
    // collapse that releases the tree's rows.
    for (let n = 0; n < CYCLES; n++) {
      const project = `P${String(n % 20).padStart(2, '0')}`
      const assembly = `${project}/Assy-${String(n % 12).padStart(2, '0')}`
      const folder = `${assembly}/Sub-${String(n % 10).padStart(2, '0')}`
      await perf.expandFolders([project, assembly, folder])
      await perf.openFolder(folder)
      await perf.realtimeBurst(50)
      await settle()
    }
    unsubscribe()
    expect(generations.length).toBeGreaterThanOrEqual(CYCLES)

    // WeakRefs made in a job hold their target until the job ends.
    await pause(0)
    gc()
    await pause(0)
    gc()
    const current = store.getState().files
    const isAlive = (ref: Ref) => {
      const files = ref.deref()
      return files !== undefined && files !== current
    }
    const alive = generations.filter(isAlive).length
    // What may survive: the last two lists (React's previous tree still holds its props), and in
    // a development build the first renders' lists, through the owner stacks React keeps for its
    // warnings (a production build has none). Nothing from the middle of the session: before the
    // fixes 11 of 12 lists were alive, chained through memoized callbacks' render scopes.
    const middle = generations.slice(3, -3).filter(isAlive).length
    expect(middle, `${alive} of ${generations.length} old file lists alive`).toBe(0)
    expect(alive).toBeLessThanOrEqual(5)
  }, 60_000)
})
