import { defineConfig, mergeConfig } from 'vitest/config'
import base from './vitest.config'

// The suite Stryker runs per mutant (stryker.config.mjs). Same as vitest.config.ts minus the perf
// gates: they assert wall-clock and render-count budgets, so under mutation they time out or fail
// for reasons unrelated to the mutant, and they guard nothing a functional test does not.
export default mergeConfig(
  base,
  defineConfig({
    test: {
      exclude: ['**/node_modules/**', '**/*.perf.test.ts', '**/*.perf.test.tsx', '.stryker-tmp/**'],
      // The multi-machine property test runs 30 fixed-seed sequences (about 7 s) by default; under
      // mutation that cost repeats per mutant. Five keep it deterministic and still cover the paths.
      env: { MULTI_SIM_RUNS: '5' },
    },
  }),
)
