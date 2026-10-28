/**
 * SOLIDWORKS serial number helpers: comparing the serial this machine's
 * SOLIDWORKS is licensed with against the ones BluePLM assigns the signed-in
 * user, and masking a serial for display.
 */

/**
 * Canonical form for comparison. Production stores serials both grouped
 * ("9000 0000 ...") and run together, and people paste them with dashes, so
 * case, whitespace and dashes are not significant.
 */
export function normalizeSerial(serial: string): string {
  return serial.replace(/[\s-]+/g, '').toUpperCase()
}

/** Show this many trailing characters of a serial; mask the rest. */
const VISIBLE_TAIL = 8

/**
 * Mask a serial for display, keeping the last 8 characters (4 when the serial
 * is shorter than 16, none when it is 4 or shorter) and the original grouping.
 */
export function maskSerial(serial: string): string {
  const trimmed = serial.trim()
  const total = normalizeSerial(trimmed).length
  const visible = total <= 4 ? 0 : total < 16 ? 4 : VISIBLE_TAIL
  let toMask = total - visible
  let out = ''
  for (const ch of trimmed) {
    if (toMask > 0 && !/[\s-]/.test(ch)) {
      out += '•'
      toMask--
    } else {
      out += ch
    }
  }
  return out
}

export interface MachineSerialEntry {
  /** Registry value name: the product the serial licenses. */
  product: string
  serial: string
}

/**
 * - `match`: this machine's SOLIDWORKS runs on a serial assigned to the user.
 * - `mismatch`: the user has a serial assigned, and SOLIDWORKS here runs on another.
 * - `unassigned`: the user has none assigned, and SOLIDWORKS here runs on some serial.
 * - `unknown`: the machine's serial could not be read, or there is none
 *   (not installed, or licensed through a network licence server).
 */
export type LicenseMatchStatus = 'match' | 'mismatch' | 'unassigned' | 'unknown'

/**
 * Which machine serials decide the status: the core "SolidWorks" product's
 * when the registry has one, since add-ons such as Inspection carry their own
 * serial; otherwise every serial on the machine.
 */
function decidingSerials(machine: MachineSerialEntry[]): string[] {
  const core = machine.filter((e) => e.product.trim().toUpperCase() === 'SOLIDWORKS')
  return (core.length > 0 ? core : machine).map((e) => normalizeSerial(e.serial)).filter(Boolean)
}

export function evaluateLicenseMatch(
  assignedSerials: string[],
  machine: MachineSerialEntry[] | null,
): LicenseMatchStatus {
  if (!machine) return 'unknown'
  const deciding = decidingSerials(machine)
  if (deciding.length === 0) return 'unknown'
  const assigned = new Set(assignedSerials.map(normalizeSerial).filter(Boolean))
  if (assigned.size === 0) return 'unassigned'
  return deciding.some((s) => assigned.has(s)) ? 'match' : 'mismatch'
}

export function isLicenseWarning(status: LicenseMatchStatus): boolean {
  return status === 'mismatch' || status === 'unassigned'
}
