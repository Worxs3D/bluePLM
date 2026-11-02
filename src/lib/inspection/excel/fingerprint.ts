/**
 * Fingerprints written into a report's `_blueplm` sheet.
 *
 * They detect accidental or casual edits to the requirement cells of a returned workbook, not a
 * determined forger (the algorithm is public). FNV-1a 64 keeps reading synchronous.
 */
import { fieldText, type InspectionReportRow } from './format'
import type { RowField } from './tokens'

const FNV_OFFSET = 0xcbf29ce484222325n
const FNV_PRIME = 0x100000001b3n
const MASK = 0xffffffffffffffffn

/** FNV-1a 64 of the UTF-8 bytes of `value`, as 16 hex digits. */
export function fnv1a64(value: string): string {
  let hash = FNV_OFFSET
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte)
    hash = (hash * FNV_PRIME) & MASK
  }
  return hash.toString(16).padStart(16, '0')
}

/** The fields that make up a characteristic's requirement, independent of the template. */
export const SPEC_FIELDS = [
  'balloon_number',
  'char_type',
  'sub_type',
  'nominal_value',
  'unit',
  'plus_tolerance',
  'minus_tolerance',
  'upper_limit',
  'lower_limit',
  'tolerance_source',
] as const satisfies readonly RowField[]

/** Fingerprint of a row's requirement (template independent). */
export function specFingerprint(row: InspectionReportRow): string {
  return fnv1a64(JSON.stringify(SPEC_FIELDS.map((f) => fieldText(row, f))))
}

/** Fingerprint of the texts written into a row's locked cells, in column order. */
export function cellsFingerprint(texts: readonly string[]): string {
  return fnv1a64(JSON.stringify(texts))
}

/** SHA-256 hex of bytes (the vault's storage hash convention). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}
