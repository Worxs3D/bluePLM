// Mutation testing: how many regressions would the test suite actually catch?
//
// Stryker changes one operator, condition or literal at a time in the files below and runs the
// tests that cover that line. A mutant the tests still pass on ("survived") is a behaviour change
// nothing guards. The targets are the code where shipped regressions have lived (see
// .cursor/plans/test-audit-2026-10-25.md and test-mutation-report.md).
//
// Runs nightly in .github/workflows/nightly.yml, one matrix job per shard. Never run it on a
// developer machine: a full run is hours of CPU (machine rule, .cursor/rules/testing.mdc).
//
// STRYKER_SHARD picks one shard; unset means every shard at once.
/* global process */

const handlers = 'src/lib/commands/handlers'

/** Shard name -> mutate globs. Sized to finish well inside the 6 h job limit on a 4-core runner. */
export const shards = {
  'handlers-a': [`${handlers}/[ab]*.ts`, `${handlers}/checkin.ts`],
  'handlers-b': [
    `${handlers}/checkout*.ts`,
    `${handlers}/collaboration.ts`,
    `${handlers}/d*.ts`,
    `${handlers}/extractReferences.ts`,
  ],
  'handlers-c': [`${handlers}/[f-p]*.ts`],
  'handlers-d': [`${handlers}/[q-z]*.ts`],
  metadata: ['src/lib/metadata/**/*.ts'],
  'supabase-files': ['src/lib/supabase/files/**/*.ts'],
  'store-load': ['src/stores/slices/filesSlice.ts', 'src/hooks/useLoadFiles/**/*.ts'],
  'realign-transfer': ['src/lib/realign/**/*.ts', 'src/lib/vaultTransfer/**/*.ts'],
  electron: ['electron/handlers/fs.ts', 'electron/handlers/solidworks.ts'],
  'api-routes': ['api/routes/**/*.ts'],
}

const shard = process.env.STRYKER_SHARD
if (shard && !shards[shard]) {
  throw new Error(`Unknown STRYKER_SHARD "${shard}". Known: ${Object.keys(shards).join(', ')}`)
}
const name = shard ?? 'all'
const mutate = [
  ...(shard ? shards[shard] : Object.values(shards).flat()),
  '!**/*.test.ts',
  '!**/*.test.tsx',
  '!**/*.d.ts',
]

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: 'vitest',
  vitest: {
    configFile: 'vitest.stryker.config.ts',
    // Dry run only the test files whose import graph reaches this shard's files.
    related: true,
  },
  // Each mutant runs only the tests that executed its line in the dry run.
  coverageAnalysis: 'perTest',
  // Static mutants (module-level initialisers) need the whole suite per mutant. They are a small
  // share and would dominate the run time.
  ignoreStatic: true,
  mutate,
  plugins: ['@stryker-mutator/vitest-runner', './stryker/ignore-logging.mjs'],
  // Log, console and t() calls: a changed log message or i18n key is noise, not a regression.
  ignorers: ['logging'],
  // Incremental: reuse results for mutants whose code and covering tests are unchanged. The
  // nightly workflow caches this file per shard.
  incremental: true,
  incrementalFile: `reports/mutation/${name}/stryker-incremental.json`,
  reporters: ['html', 'json', 'clear-text', 'progress'],
  htmlReporter: { fileName: `reports/mutation/${name}/mutation.html` },
  jsonReporter: { fileName: `reports/mutation/${name}/mutation.json` },
  // The survivor list lives in the JSON/HTML reports; printing it too floods the job log.
  clearTextReporter: { allowColor: false, logTests: false, reportMutants: false },
  // CI checks out a throwaway tree, so mutate it in place: the sandbox copy would miss api/'s own
  // node_modules. Off locally so a stray run cannot leave a mutated working tree behind.
  inPlace: Boolean(process.env.CI),
  tempDirName: '.stryker-tmp',
  timeoutMS: 10000,
  // Measured, not gated (nightly.yml does not fail on score). The ratchet is proposed in
  // .cursor/plans/test-mutation-report.md.
  thresholds: { high: 80, low: 60, break: null },
}
