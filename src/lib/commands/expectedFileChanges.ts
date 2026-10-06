/**
 * Paths the file watcher should treat as our own writes, not external changes.
 *
 * Download and Get Latest register the files they write. They must also register
 * every parent folder: creating a file fires a directory event on the parent, and
 * that event is what scheduled the silent loadFiles that OOM'd Rai's session
 * (see `.cursor/plans/toolbox-download-oom-report.md`).
 *
 * Whatever is added to `expectedFileChanges` has to be cleared on the same timer,
 * or the set grows for the life of the session. Callers pass this array to both
 * `addExpectedFileChanges` and `clearExpectedFileChanges`.
 */
export function withExpectedParentFolders(filePaths: string[]): string[] {
  const paths = new Set<string>()
  for (const filePath of filePaths) {
    const normalized = filePath.replace(/\\/g, '/').replace(/\/+$/, '')
    if (!normalized) continue
    paths.add(normalized)
    const parts = normalized.split('/')
    for (let i = 1; i < parts.length; i++) {
      paths.add(parts.slice(0, i).join('/'))
    }
  }
  return [...paths]
}
