/**
 * Where package files go on disk. Pure.
 *
 * A package is `<destination>/<sanitized title>/<vault-relative path>`. The vault path comes from
 * the server, so every segment is sanitized for Windows and `..` can never climb out of the
 * package folder.
 */

const INVALID_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g
const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i
const MAX_TITLE_LENGTH = 80
const MAX_SEGMENT_LENGTH = 200

function sanitize(name: string, maxLength: number): string {
  let out = name.replace(INVALID_CHARS, '_').replace(/\s+/g, ' ').trim()
  // Windows drops trailing dots and spaces, which would merge two different names.
  out = out.replace(/[. ]+$/, '')
  if (out.length > maxLength) out = out.slice(0, maxLength).replace(/[. ]+$/, '')
  if (out === '' || out === '.' || out === '..') return ''
  if (RESERVED_NAMES.test(out)) out = `_${out}`
  return out
}

/** A review title as one folder name. Falls back to `fallback` when nothing usable is left. */
export function sanitizeFolderName(title: string | null | undefined, fallback = 'Review'): string {
  return sanitize(title ?? '', MAX_TITLE_LENGTH) || sanitize(fallback, MAX_TITLE_LENGTH) || 'Review'
}

/** One path segment (file or folder name); `_` when nothing usable is left. */
export function sanitizePathSegment(segment: string): string {
  return sanitize(segment, MAX_SEGMENT_LENGTH) || '_'
}

/**
 * The path inside the package for a vault-relative path: forward slashes, no empty, `.` or `..`
 * segments, every segment sanitized.
 */
export function packageRelativePath(vaultPath: string): string {
  return vaultPath
    .split(/[\\/]+/)
    .filter((segment) => segment !== '' && segment !== '.')
    .map((segment) => (segment === '..' ? '_' : sanitizePathSegment(segment)))
    .join('/')
}

/** Join a local root and a package-relative path with the root's own separator. */
export function joinLocalPath(root: string, relativePath: string): string {
  const windows = root.includes('\\') || /^[A-Za-z]:/.test(root)
  const sep = windows ? '\\' : '/'
  const trimmedRoot = root.replace(/[\\/]+$/, '')
  const rel = relativePath.split('/').filter(Boolean).join(sep)
  return rel ? `${trimmedRoot}${sep}${rel}` : trimmedRoot
}

/** Whether a path names a SOLIDWORKS file the service can retarget (assemblies and drawings). */
export function isRetargetable(path: string): boolean {
  return /\.(sldasm|slddrw)$/i.test(path)
}

export function isDrawingPath(path: string): boolean {
  return /\.slddrw$/i.test(path)
}

/** A content hash safe to use as a file name (the review PDF cache): letters and digits only. */
export function isStorageHash(value: string): boolean {
  return /^[A-Za-z0-9]{16,128}$/.test(value)
}

export function isPdfPath(path: string): boolean {
  return /\.pdf$/i.test(path)
}

/**
 * Package files whose name matches a document already open in SOLIDWORKS. SOLIDWORKS reuses an
 * open document of the same name instead of loading the staged one, which would render the PDF
 * against the wrong model, so a render must not start while any of these are open.
 */
export function openDocumentNameClashes(
  packageFileNames: ReadonlyArray<string>,
  openDocumentPaths: ReadonlyArray<string>,
  stagingRoot: string,
): string[] {
  const root = stagingRoot.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  const staged = new Set(packageFileNames.map((name) => name.toLowerCase()))
  const clashes = new Set<string>()
  for (const openPath of openDocumentPaths) {
    const normalized = openPath.replace(/\\/g, '/').toLowerCase()
    if (normalized.startsWith(`${root}/`)) continue
    const name = normalized.split('/').pop() ?? ''
    if (staged.has(name)) clashes.add(openPath)
  }
  return [...clashes]
}
