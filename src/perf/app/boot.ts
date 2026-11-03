/**
 * The render-performance boot: the real app, signed in as a test user over a 30k-file synthetic
 * vault, with no network. CI only (.github/workflows/render-perf.yml).
 *
 * Reached only through `perf.html`, which only the perf build emits (BLUEPLM_PERF_BUILD=1, see
 * vite.config.ts), and loaded only by an unpackaged main process started with BLUEPLM_PERF_BOOT=1
 * (electron/perfBoot.ts). That main process tells the preload to expose the real API as
 * `electronAPIReal`, which leaves `electronAPI` for the fake installed here.
 *
 * Order matters: the disk fake goes on `window` before any app module is evaluated, and the
 * Supabase stand-in is installed before the store or App import the client.
 */
import { buildSyntheticVault, FIXTURE_USER_ID, FIXTURE_VAULT_ROOT } from '@/lib/loadPipelineFixtures'

import type { Misses } from './lenientClient'
import { createPerfElectron, type PerfElectronHooks } from './perfElectron'
import { installFakeClock, installTimerProbe } from './soakProbes'

/** How far the boot got: read by the runner when a boot never reports the vault loaded. */
function stage(name: string): void {
  document.documentElement.dataset.perfBootStage = name
}

/** A ui-look boot (scripts/ui-look) renders screens, not scale: a vault this size loads in a moment. */
const LOOK_FILE_COUNT = 600
/** PERF_OTHER_USER_ID in backend.ts (not imported here: backend loads after the disk fake). */
const LOOK_OTHER_USER_ID = 'user-other-0002'

export async function installPerfBoot(fileCount = 30_000): Promise<void> {
  const bootStartedAt = performance.now()
  const look = new URLSearchParams(location.search).has('look')
  if (look) fileCount = LOOK_FILE_COUNT
  // The soak (scripts/render-perf/soak.ts) loads the page with ?soak=1. Its probes go in first, so
  // every timer and date the app makes is seen.
  const soakProbes = new URLSearchParams(location.search).has('soak')
    ? { timers: installTimerProbe(), clock: installFakeClock() }
    : null
  const electronHooks = {} as PerfElectronHooks
  stage('vault')
  const vault = buildSyntheticVault(fileCount)
  // ui-look: the inspection scenes' project folder (a ballooned drawing, its part, its outputs).
  const lookFixtures = look ? await import('./lookInspectionFixtures') : null
  lookFixtures?.prepareLookInspectionVault(vault, FIXTURE_VAULT_ROOT, FIXTURE_USER_ID, LOOK_OTHER_USER_ID)
  const misses: Misses = new Map()

  const real = (window as Window & { electronAPIReal?: NonNullable<Window['electronAPI']> }).electronAPIReal
  Object.defineProperty(window, 'electronAPI', {
    value: createPerfElectron(vault, FIXTURE_VAULT_ROOT, misses, real, electronHooks),
    configurable: true,
    writable: true,
  })

  stage('backend-import')
  const [{ createPerfBackend, PERF_ORG_ID, PERF_VAULT_ID }, { installPerfSupabaseClient }, { createRestFetch }] =
    await Promise.all([import('./backend'), import('./supabaseClient'), import('./lenientClient')])
  stage('backend')
  const backend = createPerfBackend(vault, misses)
  lookFixtures?.seedLookInspection(backend.db, {
    orgId: PERF_ORG_ID,
    vaultId: PERF_VAULT_ID,
    userId: FIXTURE_USER_ID,
    otherUserId: LOOK_OTHER_USER_ID,
  })
  installPerfSupabaseClient(backend.client)
  window.fetch = createRestFetch(backend.client, misses)

  stage('store-import')
  const [{ usePDMStore }, { installControl }] = await Promise.all([
    import('@/stores/pdmStore'),
    import('./control'),
  ])
  // A connected vault and a finished onboarding, as a returning user's persisted store has them.
  usePDMStore.setState({
    onboardingComplete: true,
    connectedVaults: [
      {
        id: PERF_VAULT_ID,
        name: 'Perf Vault',
        localPath: FIXTURE_VAULT_ROOT,
        isExpanded: true,
        hasCompletedSetup: true,
      },
    ],
    activeVaultId: PERF_VAULT_ID,
    vaultPath: FIXTURE_VAULT_ROOT,
  })
  const control = installControl(backend, usePDMStore, bootStartedAt)
  if (soakProbes) {
    const { installSoak } = await import('./soak')
    installSoak(backend, usePDMStore, control, soakProbes, electronHooks)
  }
  if (look) {
    const { installLook } = await import('./look')
    installLook(usePDMStore, backend)
  }
  stage('installed')
}
