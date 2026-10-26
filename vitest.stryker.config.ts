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
    },
  }),
)
