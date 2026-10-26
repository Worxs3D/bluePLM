/**
 * The render-performance boot's switch (perfBoot.ts). Its own module, free of `electron`, so the
 * preload and the unit tests can import it.
 */

/** The argument the main process hands the preload in a perf boot. */
export const PERF_BOOT_ARG = '--blueplm-perf-boot'

/** On only for an unpackaged app started with BLUEPLM_PERF_BOOT=1: never in a packaged build. */
export function isPerfBootRequested(packaged: boolean, env: Record<string, string | undefined>): boolean {
  return !packaged && env.BLUEPLM_PERF_BOOT === '1'
}
