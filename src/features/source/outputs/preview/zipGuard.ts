/**
 * What a .xlsx expands to, read from its ZIP central directory before anything inflates it. A
 * returned workbook comes from a supplier, and exceljs expands every part of the archive, so a
 * small file could otherwise unpack to gigabytes (a zip bomb). Pure.
 */

/** Largest total the workbook preview expands. */
export const MAX_WORKBOOK_UNCOMPRESSED_BYTES = 200 * 1024 * 1024
/** A workbook has tens of parts; thousands means something else. */
export const MAX_WORKBOOK_ENTRIES = 5000

export type ZipSizeResult =
  | { ok: true; uncompressed: number; entries: number }
  /** Over a cap, ZIP64 (sizes past 4 GB) or not a readable ZIP. `uncompressed` is what was counted. */
  | { ok: false; reason: 'tooLarge' | 'tooManyEntries' | 'zip64' | 'notZip'; uncompressed: number }

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50

export function zipUncompressedSize(
  bytes: Uint8Array,
  maxBytes = MAX_WORKBOOK_UNCOMPRESSED_BYTES,
  maxEntries = MAX_WORKBOOK_ENTRIES,
): ZipSizeResult {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  // The end-of-central-directory record is the last 22 bytes plus a comment of up to 64 KB.
  let eocd = -1
  for (let i = bytes.byteLength - 22; i >= Math.max(0, bytes.byteLength - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) {
      eocd = i
      break
    }
  }
  if (eocd < 0) return { ok: false, reason: 'notZip', uncompressed: 0 }
  const count = view.getUint16(eocd + 10, true)
  const offset = view.getUint32(eocd + 16, true)
  if (count === 0xffff || offset === 0xffffffff) return { ok: false, reason: 'zip64', uncompressed: 0 }
  if (count > maxEntries) return { ok: false, reason: 'tooManyEntries', uncompressed: 0 }

  let total = 0
  let at = offset
  for (let n = 0; n < count; n++) {
    if (at + 46 > bytes.byteLength || view.getUint32(at, true) !== CENTRAL_SIGNATURE) {
      return { ok: false, reason: 'notZip', uncompressed: total }
    }
    const size = view.getUint32(at + 24, true)
    if (size === 0xffffffff) return { ok: false, reason: 'zip64', uncompressed: total }
    total += size
    if (total > maxBytes) return { ok: false, reason: 'tooLarge', uncompressed: total }
    at += 46 + view.getUint16(at + 28, true) + view.getUint16(at + 30, true) + view.getUint16(at + 32, true)
  }
  return { ok: true, uncompressed: total, entries: count }
}
