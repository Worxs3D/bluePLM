/**
 * Assembly reference freeze, the desktop side (5.13.0, gap 12 b and c).
 *
 * - `openVersionWithReferences`: a checked-in version and its exact closure, staged read-only in
 *   a per-version cache under userData (`electron/handlers/versionOpen.ts`), retargeted, opened in
 *   SOLIDWORKS. Reused when already staged.
 * - `getFreezeStatus` / `freezeStatusOf`: whether a version's references are frozen (exact).
 * - `findApproximateReleases`: assemblies and drawings whose release would not freeze them.
 * - `isReferencedByRelease`: the database's refusal to delete a version a release references.
 *
 * UI: `src/features/source/versionOpen/` (version history) and
 * `src/features/source/releases/approximateRelease.tsx` (the warning before a release).
 */

export * from './types'
export { isOpenableWithReferences, openVersionWithReferences } from './open'
export { freezeStatusOf, getFreezeStatus, resetFreezeCache } from './freeze'
export { findApproximateReleases, hasFreezableReferences, type ApproximateRelease, type ReleaseCandidate } from './releaseCheck'
export { isReferencedByRelease, referencedByReleaseMessage, REFERENCED_BY_RELEASE } from './deleteRefusal'
