import type { LocalFile } from '@/stores/pdmStore'

/**
 * Find the row, by exact path/ending/filename, that a component path resolves to - without
 * any knowledge of `'moved_away'` stubs. Kept private: every external caller must go through
 * {@link findLocalFileByPath} below, which redirects a stub match to the row with real content.
 *
 * SolidWorks reports the path it resolved, which may sit under a different vault root than the one
 * this machine mounted, so an exact comparison alone loses matches that plainly are the same file.
 */
function findByPathStrategies(componentPath: string, files: LocalFile[]): LocalFile | undefined {
  const normalizedPath = componentPath.toLowerCase().replace(/\//g, '\\')
  const componentFileName = componentPath.split(/[\\/]/).pop()?.toLowerCase() || ''

  let match = files.find((f) => f.path.toLowerCase() === normalizedPath)

  // Try matching by path ending (handles different vault roots)
  if (!match) {
    match = files.find((f) => {
      const fPath = f.path.toLowerCase()
      return fPath.endsWith(normalizedPath) || normalizedPath.endsWith(fPath)
    })
  }

  // Try matching by filename only (last resort)
  if (!match && componentFileName) {
    match = files.find((f) => {
      const fName = f.path.split(/[\\/]/).pop()?.toLowerCase() || ''
      return fName === componentFileName
    })
  }

  return match
}

/**
 * Redirect a `'moved_away'` stub to the row that actually has content behind it.
 *
 * A stub sits at exactly the path the database still records for a file, and every strategy in
 * {@link findByPathStrategies} matches on path - its exact-path branch in particular means a
 * stub is *preferred* over its `'moved'` partner whenever the caller is resolving a component's
 * database-recorded (and now stale) path, not merely reachable by accident. The partner is
 * looked up by the stub's own `movedToRelativePath` (stamped in at merge time by
 * `cloudFileReconciliation.ts`), matched case-insensitively with normalized separators to
 * tolerate the same vault-root differences `findByPathStrategies` already accounts for.
 *
 * Falls back to the stub itself if no partner is present in `files` (e.g. a caller passing a
 * filtered subset) - a result is still produced rather than silently dropping the file, matching
 * the fallback `pickCanonicalLocalFile` (`src/lib/fileOperations/assemblyResolver.ts`) already
 * uses for the identical shape.
 */
function resolveStubToPartner(
  match: LocalFile | undefined,
  files: LocalFile[],
): LocalFile | undefined {
  if (!match || match.diffStatus !== 'moved_away' || !match.movedToRelativePath) {
    return match
  }

  const destination = match.movedToRelativePath.toLowerCase().replace(/\//g, '\\')
  const partner = files.find(
    (f) =>
      f.diffStatus !== 'moved_away' &&
      f.relativePath.toLowerCase().replace(/\//g, '\\') === destination,
  )

  return partner ?? match
}

/**
 * Find a local file matching the given component path.
 * Tries exact match first, then falls back to filename match within the vault.
 *
 * A `'moved_away'` stub sits at exactly the path the database records for a file whose content
 * now lives elsewhere on disk, so a plain path match would return a row with nothing behind it
 * in preference to the row that actually has the file. This resolves through
 * {@link resolveStubToPartner} so every caller gets the row with real content by default -
 * making the caller responsible for that redirect (as a handful of callers used to do
 * individually) means every *future* caller inherits the bug instead.
 */
export function findLocalFileByPath(
  componentPath: string,
  files: LocalFile[],
): LocalFile | undefined {
  return resolveStubToPartner(findByPathStrategies(componentPath, files), files)
}
