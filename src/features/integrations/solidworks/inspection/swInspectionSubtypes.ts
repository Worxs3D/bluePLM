// SOLIDWORKS Inspection characteristic sub-types (swiCharacteristicSubType_e, read from the
// add-in interop DLL). The Inspection API exposes SubType as an integer but has no Type field,
// so we both label the Sub-Type column and derive the bluePLM Type (Dimension/GTOL) from it.
const SWI_SUBTYPE_LABELS: Record<number, string> = {
  0: 'Diameter',
  1: 'Radial',
  2: 'Angular',
  3: 'Length',
  4: 'Angularity',
  5: 'Concentricity',
  6: 'Cylindricity',
  7: 'Flatness',
  8: 'Parallelism',
  9: 'Perpendicularity',
  10: 'Position',
  11: 'Profile',
  12: 'Profile of a Line',
  13: 'Circularity',
  14: 'Runout',
  15: 'Straightness',
  16: 'Symmetry',
  17: 'Total Runout',
  // 18 = NA (no meaningful sub-type) → left blank
  19: 'Arc Length',
  20: 'Chamfer',
  21: 'Scalar',
  22: 'Depth',
  23: 'Counterbore Diameter',
  24: 'Counterbore Depth',
  25: 'Countersink Diameter',
  26: 'Countersink Depth',
  27: 'Square',
  28: 'Thread',
  29: 'Thread Size',
  30: 'Thread Depth',
  31: 'Countersink Angle',
  32: 'Bend Angle',
  33: 'Bend Radius',
  34: 'Bend Direction',
  35: 'Bend Sequence',
  36: 'Bend Quantity',
  37: 'Counterdrill Angle',
  38: 'Counterdrill Depth',
  39: 'Counterdrill Diameter',
  40: 'Description',
  41: 'Drill Angle',
  42: 'Far Side Countersink Angle',
  43: 'Far Side Countersink Diameter',
  44: 'Fastener Size',
  45: 'Fastener Type',
  46: 'Head Clearance',
  47: 'Hole Depth',
  48: 'Hole Diameter',
  49: 'Major Diameter',
  50: 'Middle Countersink Angle',
  51: 'Middle Countersink Diameter',
  52: 'Minor Diameter',
  53: 'Near Side Countersink Angle',
  54: 'Near Side Countersink Diameter',
  55: 'Standard',
  56: 'Tap Drill Depth',
  57: 'Tap Drill Diameter',
  58: 'Thread Angle',
  59: 'Thread Description',
  60: 'Thread Diameter',
  61: 'Thread Series',
  62: 'Thru Hole Depth',
  63: 'Thru Hole Diameter',
  64: 'Thru Tap Depth',
  65: 'Thru Tap Drill Diameter',
  66: 'Thread Class',
  67: 'Slot Length',
  100: 'Hole X Location',
  101: 'Hole Y Location',
}

// swiCharacteristicSubType_e IDs 4–17 are the geometric tolerances (Angularity…Total Runout).
const SWI_GTOL_SUBTYPES = new Set([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17])
const SWI_SUBTYPE_NA = 18

/** Human-readable label for a SOLIDWORKS Inspection sub-type code (null when unknown/NA). */
export function subtypeLabel(subType: number | null | undefined): string | null {
  if (subType === null || subType === undefined || subType === SWI_SUBTYPE_NA) return null
  return SWI_SUBTYPE_LABELS[subType] ?? null
}

/**
 * Derive the bluePLM characteristic Type from the SOLIDWORKS Inspection sub-type code. The
 * Inspection API has no Type field, but the sub-type unambiguously implies the category:
 * IDs 4–17 are geometric tolerances (GTOL); everything else is dimensional (Dimension).
 * Returns null for the NA sub-type so the Type is left for the user to set.
 */
export function deriveCharType(subType: number | null | undefined): string | null {
  if (subType === null || subType === undefined || subType === SWI_SUBTYPE_NA) return null
  if (SWI_GTOL_SUBTYPES.has(subType)) return 'GTOL'
  return 'Dimension'
}
