/**
 * A short, stable fingerprint of a layout, so a person's copy can tell when the template it was
 * made from has changed since (`customizedFrom.baseHash`). Key order and absent optional fields do
 * not change it; any change to order, grouping, display, labels, hidden or removed groups does.
 * Not a security hash: it only compares a layout with an earlier copy of itself.
 */

import type { MenuLayout } from './types'

/** JSON with object keys sorted and `undefined` fields left out. */
export function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`
}

/** cyrb53: a fast 53-bit string hash, written as 14 hex digits. */
function cyrb53(text: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ code, 2654435761)
    h2 = Math.imul(h2 ^ code, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  const value = 4294967296 * (2097151 & h2) + (h1 >>> 0)
  return value.toString(16).padStart(14, '0')
}

export function layoutHash(layout: MenuLayout): string {
  return `v1-${cyrb53(stableJson(layout))}`
}
