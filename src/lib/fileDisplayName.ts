/**
 * A file name as the explorer shows it: with the "lowercase extensions" display preference
 * (`lowercaseExtensions`, on by default) the extension is lower case, so `PMP-2000.SLDDRW` on the
 * server reads `PMP-2000.slddrw` everywhere the user sees it. Only the extension changes, and only
 * for display: paths, search and server calls keep the stored name.
 */
export function fileDisplayName(name: string, lowercaseExtensions: boolean | undefined): string {
  if (lowercaseExtensions === false) return name
  const dot = name.lastIndexOf('.')
  // No extension, a dot file (".gitignore") or a trailing dot: nothing to change.
  if (dot <= 0 || dot === name.length - 1) return name
  return name.slice(0, dot) + name.slice(dot).toLowerCase()
}
