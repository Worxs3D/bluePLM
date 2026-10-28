// @vitest-environment jsdom
/**
 * Random interleavings of two machines' operations, with realtime held, released, dropped and
 * reconnected (simOps.ts). fast-check shrinks a failure to a minimal sequence; save it in
 * savedSequences.test.ts with the fix.
 *
 * Every CI run does a small count from a fixed seed, so a red CI run means a change broke a
 * sequence that used to converge (well under a minute). The nightly workflow runs a large count
 * from a fresh seed, to find new failures:
 *   MULTI_SIM_SEED=random MULTI_SIM_RUNS=1000 MULTI_SIM_STEPS=24 npx vitest run src/test/multi/randomInterleavings.test.ts
 * MULTI_SIM_SEED=<n> replays a run's seed (fast-check prints it on failure).
 */
import fc from 'fast-check'
import { it, vi } from 'vitest'

vi.mock('@/lib/supabase/client', async (importOriginal) =>
  (await import('@/test/multi/clientMock')).mockMachineClientModule(await importOriginal()),
)

import { opArbitrary, runSequence } from './simOps'

const RUNS = Number(process.env.MULTI_SIM_RUNS ?? 30)
const STEPS = Number(process.env.MULTI_SIM_STEPS ?? 16)
const CI_SEED = 20261025
const SEED =
  process.env.MULTI_SIM_SEED === 'random'
    ? undefined
    : process.env.MULTI_SIM_SEED
      ? Number(process.env.MULTI_SIM_SEED)
      : CI_SEED

it(
  `${RUNS} random two-machine sequences of up to ${STEPS} steps converge`,
  async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(opArbitrary, { minLength: 1, maxLength: STEPS }), async (ops) => {
        await runSequence(ops)
      }),
      { numRuns: RUNS, seed: SEED, verbose: 1 },
    )
  },
  // The nightly count runs for many minutes; the CI count for well under one.
  Math.max(120_000, RUNS * STEPS * 2_000),
)
