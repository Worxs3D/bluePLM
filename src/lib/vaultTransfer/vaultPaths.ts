/**
 * Whether two vault folders share any disk.
 *
 * A transfer copies files from one vault's folder into another's. If the two are the same folder,
 * or one sits inside the other, the "destination" copy is also a file in the source vault: the
 * copy would shadow itself, and a Move would delete what it had just written. Windows paths
 * compare case-insensitively and accept either slash.
 */

function canonical(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

export function vaultFoldersOverlap(first: string, second: string): boolean {
  const a = canonical(first)
  const b = canonical(second)
  if (a === '' || b === '') return false
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)
}
