// @vitest-environment jsdom
/**
 * The perf boot end to end in jsdom: the real App, the real auth listener and the real vault
 * load, over the fakes the nightly render-performance run uses, with a small vault. Proves the
 * boot reaches "vault looks loaded" without Electron; the nightly measures it in Electron.
 */
import { cleanup, render } from '@testing-library/react'
import { afterAll, describe, expect, it, vi } from 'vitest'

import { installDomShims } from '@/test/render'

vi.mock('@/lib/supabase/client', async () => await import('./supabaseClient'))

// Unmount and let React's scheduled work run while jsdom still exists.
afterAll(async () => {
  cleanup()
  await new Promise((resolve) => setTimeout(resolve, 200))
})

describe('perf boot', () => {
  it('boots the real App signed in, and the vault looks loaded', async () => {
    installDomShims()
    const { installPerfBoot } = await import('./boot')
    await installPerfBoot(300)
    const { App } = await import('@/app/App')
    render(<App />)

    const perf = window.__blueplmPerf!
    const deadline = Date.now() + 45_000
    while (!perf.loaded && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100))

    const state = perf.state()
    expect({ loaded: !!perf.loaded, state, misses: perf.misses().slice(0, 15) }).toMatchObject({
      loaded: true,
      state: { filesLoaded: true, isLoading: false },
    })
    expect(state.files).toBeGreaterThanOrEqual(300)
    expect(perf.rowCount()).toBeGreaterThan(0)

    const delivered = await perf.realtimeBurst(20)
    expect(delivered).toBeGreaterThan(0)
  }, 60_000)
})
