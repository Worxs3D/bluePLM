/**
 * Version outputs (5.5.0): the drawing PDF and the STEP/IGES/STL/DXF exports of a checked-in
 * version, generated from its staged closure and stored content-addressed (schema 505), and the
 * physical copies a user asks for. Plan: `.cursor/plans/inspection-outputs-5.5.plan.md` (C).
 */

export {
  ensureVersionOutput,
  type EnsureVersionOutputOptions,
  type EnsureVersionOutputResult,
  type OutputProgress,
  type OutputProgressPhase,
} from './ensure'
export { listVersionOutputs, loadFileReleases, loadOutputHeads, loadVersionOutputs } from './list'
export {
  applyOutputNamePattern,
  baseNameOf,
  normalizeExtension,
  OUTPUT_NAME_MAX_BASE,
  OUTPUT_NAME_TOKENS,
  outputFileName,
  SAMPLE_OUTPUT_NAME_VALUES,
  type OutputNameToken,
  type OutputNameValues,
} from './fileName'
export { orgExportFilenamePattern, versionOutputFileName, type OutputSourceInfo } from './naming'
export {
  openVersionOutput,
  saveOutputCopy,
  saveOutputNextToSource,
  siblingPath,
  type OpenOutputResult,
  type SaveNextToSourceResult,
  type SaveOutputCopyResult,
} from './save'
export {
  autoOutputSettings,
  isDrawingFile,
  isModelFile,
  isModelOutputKind,
  kindTakesConfiguration,
  outputExtension,
  outputKindLabel,
  outputKindsForPath,
  primaryOutputKinds,
  supportsOutputKind,
  type AutoOutputSettings,
} from './kinds'
export {
  AUTO_OUTPUT_MAX_BATCH,
  AUTO_OUTPUT_MAX_QUEUED,
  checkinCandidates,
  createOutputQueue,
  planCheckinOutputs,
  queueCheckinOutputs,
  queueOutputs,
  queuedJobKey,
  resetOutputQueue,
  SAME_NAME_MAX_ATTEMPTS,
  SAME_NAME_RETRY_MS,
  type CheckinOutputCandidate,
  type CheckinOutputPlan,
  type OutputQueue,
  type OutputQueueDeps,
  type PlannedOutputJob,
} from './autoQueue'
