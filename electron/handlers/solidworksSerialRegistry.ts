/**
 * Parse `reg query "HKLM\Software\SolidWorks\Licenses\Serial Numbers"` output.
 *
 * The SOLIDWORKS installer writes one REG_SZ value per licensed product under
 * that key: the value NAME is the product ("SolidWorks", "Inspection",
 * "Simulation", ...) and the value DATA is that product's serial number, in
 * 4-character groups separated by spaces. Observed on a SOLIDWORKS 2024/2026
 * install:
 *
 *   HKEY_LOCAL_MACHINE\Software\SolidWorks\Licenses\Serial Numbers
 *       SolidWorks    REG_SZ    9000 0000 0000 0000 XXXX XXXX
 *       Inspection    REG_SZ    9000 0000 0000 0000 XXXX XXXX
 *
 * The reader before this one took the value names for serials, so it reported
 * "SolidWorks" and "Inspection". Values with empty data (which BluePLM's own
 * "push to registry" used to write, serial as the name) are not serials
 * SOLIDWORKS reads and are skipped.
 */

export interface RegistrySerialEntry {
  /** Value name: the SOLIDWORKS product this serial licenses. */
  product: string
  /** Value data as written by the installer (spacing kept). */
  serial: string
}

export function parseSerialNumbersRegistry(output: string): RegistrySerialEntry[] {
  const entries: RegistrySerialEntry[] = []
  for (const line of output.split(/\r?\n/)) {
    // Value names may contain spaces ("SOLIDWORKS Simulation"), so split on the
    // type column rather than on whitespace.
    const match = line.match(/^\s+(.+?)\s+REG_(?:SZ|EXPAND_SZ)\s+(.+?)\s*$/)
    if (!match) continue
    const product = match[1].trim()
    const serial = match[2].trim()
    if (!product || product === '(Default)' || !serial) continue
    entries.push({ product, serial })
  }
  return entries
}

/** The installer's value name for the core SOLIDWORKS serial. */
export const SOLIDWORKS_CORE_PRODUCT = 'SolidWorks'

/**
 * Case, whitespace and dashes are not significant in a serial. Same rule as
 * `normalizeSerial` in src/lib/solidworksLicense/serial.ts, which the main
 * process cannot import.
 */
export function normalizeRegistrySerial(serial: string): string {
  return serial.replace(/[\s-]+/g, '').toUpperCase()
}

/**
 * The serial as the installer writes it: 4-character groups separated by
 * spaces. Returns null for anything that is not letters and digits once
 * spacing and dashes are removed, so no other text reaches `reg`.
 */
export function formatSerialForRegistry(serial: string): string | null {
  const clean = normalizeRegistrySerial(serial)
  if (!/^[A-Z0-9]+$/.test(clean)) return null
  return (clean.match(/.{1,4}/g) ?? []).join(' ')
}

/** The products whose registry serial is this serial. */
export function productsWithSerial(entries: RegistrySerialEntry[], serial: string): string[] {
  const target = normalizeRegistrySerial(serial)
  return entries.filter((e) => normalizeRegistrySerial(e.serial) === target).map((e) => e.product)
}
