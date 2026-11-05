/** A typed quantity as the server accepts it (a whole number of at least 1), or null. */
export function parseQuantity(text: string): number | null {
  if (!/^\s*\d+\s*$/.test(text)) return null
  const n = Number(text)
  return Number.isSafeInteger(n) && n >= 1 ? n : null
}
