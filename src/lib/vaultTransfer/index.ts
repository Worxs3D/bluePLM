export { buildTransferMetadata } from './metadata'
export {
  candidateDestinationPaths,
  normalizeDestFolder,
  planVaultTransfer,
  WINDOWS_MAX_PATH,
} from './plan'
export { prepareVaultTransfer } from './prepare'
export type { PrepareDeps, PrepareFailure, PrepareInput, PrepareResult } from './prepare'
export { runVaultTransfer, canRemoveSource, isSourceRowUnchanged } from './execute'
export type {
  InsertDestinationFileArgs,
  LocalCopyOutcome,
  SourceRowState,
  TransferEngineDeps,
  TransferFailure,
  TransferItemResult,
  TransferRunResult,
} from './execute'
export { createPrepareDeps, createRemovalDeps, createTransferDeps } from './deps'
export { removeMovedSources } from './removeSources'
export type {
  KeptSource,
  KeptSourceReason,
  RemoveSourcesDeps,
  RemoveSourcesOutcome,
} from './removeSources'
export { vaultFoldersOverlap } from './vaultPaths'
export type {
  PlannedTransferFile,
  SkippedTransferFile,
  TransferSkipReason,
  TransferStrategy,
  TransferTargetSnapshot,
  VaultTransferMode,
  VaultTransferOptions,
  VaultTransferPlan,
} from './types'
