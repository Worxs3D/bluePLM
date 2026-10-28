import type { OperationType } from '@/stores/types'

/**
 * Get the operation type for a FILE if it's being processed.
 * Checks for exact match OR if this file is inside a processing folder (downward propagation).
 */
export function getFileProcessingOperation(
  relativePath: string,
  processingOperations: Map<string, OperationType>,
): OperationType | null {
  const normalizedPath = relativePath.replace(/\\/g, '/')

  // Check exact match first
  if (processingOperations.has(relativePath)) {
    return processingOperations.get(relativePath)!
  }
  if (processingOperations.has(normalizedPath)) {
    return processingOperations.get(normalizedPath)!
  }

  // Check if this file is INSIDE any processing folder (downward propagation)
  for (const [processingPath, opType] of processingOperations) {
    const normalizedProcessingPath = processingPath.replace(/\\/g, '/')
    if (normalizedPath.startsWith(normalizedProcessingPath + '/')) {
      return opType
    }
  }

  return null
}

/**
 * Get the operation type for a FOLDER if it's being processed.
 * Checks for exact match OR if this folder is inside a processing folder (downward propagation).
 * Does NOT propagate UP to parent folders.
 */
export function getFolderProcessingOperation(
  folderPath: string,
  processingOperations: Map<string, OperationType>,
): OperationType | null {
  const normalizedFolder = folderPath.replace(/\\/g, '/')

  // Check if the folder itself is being processed
  if (processingOperations.has(folderPath)) {
    return processingOperations.get(folderPath)!
  }
  if (processingOperations.has(normalizedFolder)) {
    return processingOperations.get(normalizedFolder)!
  }

  // Check if this folder is INSIDE any processing folder (downward propagation)
  // This makes spinners propagate DOWN to children, not UP to parents
  for (const [path, opType] of processingOperations) {
    const normalizedPath = path.replace(/\\/g, '/')
    if (normalizedFolder.startsWith(normalizedPath + '/')) {
      return opType
    }
  }

  return null
}

/**
 * Ancestor folder -> operations running somewhere beneath it, built once per processing map.
 * The store replaces the map on every change, so the map instance is a safe cache key.
 */
const descendantOperationsIndex = new WeakMap<
  Map<string, OperationType>,
  Map<string, Set<OperationType>>
>()

function buildDescendantOperationsIndex(
  processingOperations: Map<string, OperationType>,
): Map<string, Set<OperationType>> {
  const index = new Map<string, Set<OperationType>>()
  for (const [path, opType] of processingOperations) {
    let ancestor = path.replace(/\\/g, '/')
    let slash = ancestor.lastIndexOf('/')
    while (slash > 0) {
      ancestor = ancestor.slice(0, slash)
      let ops = index.get(ancestor)
      if (!ops) {
        ops = new Set()
        index.set(ancestor, ops)
      } else if (ops.has(opType)) {
        // Every ancestor above this one already carries this operation.
        break
      }
      ops.add(opType)
      slash = ancestor.lastIndexOf('/')
    }
  }
  return index
}

/**
 * Operations running on files or folders BENEATH this folder (not on the folder itself).
 *
 * A command started on a file list rather than on the folder (Get Latest from the vault header,
 * a multi-select) tracks only the file paths, so the folder's own lookup finds nothing. Folder
 * action buttons use this to show their spinner while the files they would act on are in flight,
 * instead of offering a second click on the same files.
 */
export function getFolderDescendantOperations(
  folderPath: string,
  processingOperations: Map<string, OperationType>,
): ReadonlySet<OperationType> | null {
  if (processingOperations.size === 0) return null
  let index = descendantOperationsIndex.get(processingOperations)
  if (!index) {
    index = buildDescendantOperationsIndex(processingOperations)
    descendantOperationsIndex.set(processingOperations, index)
  }
  return index.get(folderPath.replace(/\\/g, '/')) ?? null
}

/** Content equality for two descendant-operation sets, for memo comparators. */
export function sameOperationSet(
  a: ReadonlySet<OperationType> | null | undefined,
  b: ReadonlySet<OperationType> | null | undefined,
): boolean {
  if (a === b) return true
  if (!a || !b || a.size !== b.size) return (a?.size ?? 0) === 0 && (b?.size ?? 0) === 0
  for (const op of a) if (!b.has(op)) return false
  return true
}

/**
 * Smart processing operation getter that handles both files and folders correctly
 * - For both: returns if the exact path is processing OR if it's inside a processing folder
 * - Spinners propagate DOWN to children, NOT up to parents
 */
export function getProcessingOperation(
  relativePath: string,
  processingOperations: Map<string, OperationType>,
  isDirectory: boolean,
): OperationType | null {
  if (isDirectory) {
    return getFolderProcessingOperation(relativePath, processingOperations)
  } else {
    return getFileProcessingOperation(relativePath, processingOperations)
  }
}
