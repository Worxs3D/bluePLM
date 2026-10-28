// @vitest-environment jsdom
/**
 * The Halloween effects animate without rendering. They are on all October for everyone with
 * seasonal themes (the default), and the sparks used to move through React state: a render of
 * this component and ~160 restyled elements every frame (render-perf nightly, 2026-10-26).
 */
import { act, cleanup, render } from '@testing-library/react'
import { Profiler } from 'react'
import { afterEach, expect, it } from 'vitest'

import { usePDMStore } from '@/stores/pdmStore'

import { HalloweenEffects } from './HalloweenEffects'

afterEach(cleanup)

// jsdom has no 2D canvas; the effect draws nothing without one, which is all this test needs.
HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext

const frame = () => new Promise((resolve) => requestAnimationFrame(resolve))

it('runs its animation frames without committing a render', async () => {
  usePDMStore.setState({ theme: 'halloween' })
  let commits = 0
  render(
    <Profiler id="halloween" onRender={() => (commits += 1)}>
      <HalloweenEffects />
    </Profiler>,
  )
  await act(async () => {
    await frame()
  })
  commits = 0

  await act(async () => {
    for (let i = 0; i < 30; i++) await frame()
  })

  // No ghost is in flight in the first frames (the first one starts after 8 s).
  expect(commits).toBe(0)
  expect(document.querySelector('canvas')).not.toBeNull()
})
