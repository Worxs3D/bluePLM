import type { SolidWorksServiceStatus } from '@/types/solidworks'

/**
 * Whether this machine offers Generate missing (else Request missing): the desktop app with the
 * SOLIDWORKS service running and SOLIDWORKS known to be installed. The status starts as
 * `{ running: false }` before the first check, so an unknown machine requests rather than offering
 * a Generate that would end in `needs_solidworks`. Pure.
 */
export function canGenerateHere(
  desktop: boolean,
  status: Pick<SolidWorksServiceStatus, 'running' | 'swInstalled'> | null | undefined,
): boolean {
  return desktop && status?.running === true && status.swInstalled === true
}
