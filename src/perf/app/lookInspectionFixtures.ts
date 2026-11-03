/**
 * Inspection fixture data for ui-look scenes (src/perf/app/look.ts) and for the workbook renders
 * (scripts/ui-look/xlsxFixtures.ts): one project folder with a ballooned drawing, its part and
 * assembly, the drawing's 25 characteristics, three checked-in versions, reports in every status
 * across two versions, and the organization's templates. Pure data and seeding, no DOM, so the
 * Node script can import it too.
 */
import type { InspectionRowValues } from '@/lib/supabase/files/inspection'
import type { SyntheticVault } from '@/lib/loadPipelineFixtures'
import type { FakeSupabase } from '@/test/fakeSupabase'

/** Folder of the synthetic vault the inspection files are moved into. */
export const LOOK_INSPECTION_FOLDER = 'P00/Assy-00/Sub-00'

interface LookFile {
  name: string
  extension: string
  fileType: 'part' | 'assembly' | 'drawing' | 'other'
  partNumber: string
  description: string
  revision: string
  version: number
  state: string
  checkedOutBy: 'me' | 'other' | null
}

const LOOK_FILES: LookFile[] = [
  {
    name: 'BR-103849-201.SLDDRW',
    extension: '.slddrw',
    fileType: 'drawing',
    partNumber: 'BR-103849-201',
    description: 'Bracket, motor mount, 6061-T6',
    revision: 'B',
    version: 3,
    state: 'In Work',
    checkedOutBy: 'me',
  },
  {
    name: 'BR-103849-201.SLDPRT',
    extension: '.sldprt',
    fileType: 'part',
    partNumber: 'BR-103849-201',
    description: 'Bracket, motor mount, 6061-T6',
    revision: 'B',
    version: 6,
    state: 'In Work',
    checkedOutBy: null,
  },
  {
    name: 'BR-103849-202.SLDDRW',
    extension: '.slddrw',
    fileType: 'drawing',
    partNumber: 'BR-103849-202',
    description: 'Spacer, motor mount, Delrin',
    revision: 'A',
    version: 1,
    state: 'In Work',
    checkedOutBy: 'me',
  },
  {
    name: 'BR-103849-202.SLDPRT',
    extension: '.sldprt',
    fileType: 'part',
    partNumber: 'BR-103849-202',
    description: 'Spacer, motor mount, Delrin',
    revision: 'A',
    version: 2,
    state: 'In Work',
    checkedOutBy: null,
  },
  {
    name: 'BR-103849-100.SLDASM',
    extension: '.sldasm',
    fileType: 'assembly',
    partNumber: 'BR-103849-100',
    description: 'Motor mount assembly',
    revision: 'B',
    version: 4,
    state: 'In Work',
    checkedOutBy: null,
  },
  {
    name: 'BR-103849-100.SLDDRW',
    extension: '.slddrw',
    fileType: 'drawing',
    partNumber: 'BR-103849-100',
    description: 'Motor mount assembly',
    revision: 'B',
    version: 2,
    state: 'Released',
    checkedOutBy: 'other',
  },
  {
    name: 'BR-103849-203.SLDPRT',
    extension: '.sldprt',
    fileType: 'part',
    partNumber: 'BR-103849-203',
    description: 'Clamp plate, 304 stainless',
    revision: 'A',
    version: 3,
    state: 'In Work',
    checkedOutBy: null,
  },
  {
    name: 'BR-103849-204.SLDPRT',
    extension: '.sldprt',
    fileType: 'part',
    partNumber: 'BR-103849-204',
    description: 'Shim, 0.5 mm, 304 stainless',
    revision: 'A',
    version: 1,
    state: 'In Work',
    checkedOutBy: null,
  },
  {
    name: 'BR-103849-201.PDF',
    extension: '.pdf',
    fileType: 'other',
    partNumber: 'BR-103849-201',
    description: 'Bracket, motor mount, 6061-T6',
    revision: 'B',
    version: 2,
    state: 'In Work',
    checkedOutBy: null,
  },
  {
    name: 'BR-103849-201.STEP',
    extension: '.step',
    fileType: 'other',
    partNumber: 'BR-103849-201',
    description: 'Bracket, motor mount, 6061-T6',
    revision: 'B',
    version: 2,
    state: 'In Work',
    checkedOutBy: null,
  },
]

/** Server row ids of the files above, by name. Stable, so scenes and seeds agree. */
export const LOOK_FILE_IDS: Record<string, string> = Object.fromEntries(
  LOOK_FILES.map((f, i) => [f.name, `00000000-0000-4000-8000-a1ec${String(i).padStart(8, '0')}`]),
)

export const LOOK_DRAWING = 'BR-103849-201.SLDDRW'
export const LOOK_EMPTY_DRAWING = 'BR-103849-202.SLDDRW'
export const LOOK_READONLY_DRAWING = 'BR-103849-100.SLDDRW'

const WIN = (relativePath: string) => relativePath.replace(/\//g, '\\')

/**
 * Move the vault's first files into one folder under realistic names, so a file list scene shows a
 * drawing beside its part and the outputs made from it. Server rows and disk entries change together.
 */
export function prepareLookInspectionVault(
  vault: SyntheticVault,
  root: string,
  userId: string,
  otherUserId: string,
): void {
  // Files 0.. sit one per leaf folder; drop the ones being renamed from wherever they were.
  LOOK_FILES.forEach((f, i) => {
    const row = vault.serverRows[i]
    const relativePath = `${LOOK_INSPECTION_FOLDER}/${f.name}`
    const holder =
      f.checkedOutBy === 'me' ? userId : f.checkedOutBy === 'other' ? otherUserId : null
    const oldPath = row.file_path
    Object.assign(row, {
      id: LOOK_FILE_IDS[f.name],
      file_path: relativePath,
      file_name: f.name,
      extension: f.extension,
      file_type: f.fileType,
      part_number: f.partNumber,
      description: f.description,
      revision: f.revision,
      version: f.version,
      state: f.state,
      checked_out_by: holder,
      checked_out_at: holder ? '2026-10-30T09:12:00.000Z' : null,
      checked_out_file_path: holder ? relativePath : null,
      checked_out_file_name: holder ? f.name : null,
      custom_properties: {
        Material: f.description.split(', ').pop() ?? '',
        Vendor: 'Northshore Machining',
        Project: 'Motor mount',
      },
    })
    const local = vault.localEntries.find((e) => !e.isDirectory && e.relativePath === oldPath)
    if (local) {
      Object.assign(local, {
        name: f.name,
        relativePath,
        path: `${root}\\${WIN(relativePath)}`,
        extension: f.extension,
      })
    } else {
      // A cloud-only slot in the synthetic vault: give this file a disk copy too.
      vault.localEntries.push({
        name: f.name,
        path: `${root}\\${WIN(relativePath)}`,
        relativePath,
        isDirectory: false,
        extension: f.extension,
        size: 180_000 + i * 7_919,
        modifiedTime: '2026-10-01T12:00:00.000Z',
        ino: 9_000_000 + i,
      })
    }
  })
}

// ---------------------------------------------------------------------------
// Characteristics
// ---------------------------------------------------------------------------

type Char = Partial<InspectionRowValues> & Pick<InspectionRowValues, 'char_type'>

const drawing = (key: string, sheet = 'Sheet1', view: string | null = 'Drawing View1') => ({
  source_key: key,
  source_sheet: sheet,
  source_view: view,
})

/**
 * The drawing's characteristics, in balloon order: dimensions with their own tolerances, a few
 * filled from the title block's general tolerances, GTOL frames, a hole callout, surface finish,
 * and three manual rows (no source key) the quality engineer added.
 */
const CHARACTERISTICS: Char[] = [
  {
    balloon_number: '1',
    zone: 'B2',
    char_type: 'Dimension',
    sub_type: 'Linear',
    nominal_value: '120.00',
    unit: 'mm',
    plus_tolerance: '0.10',
    minus_tolerance: '0.10',
    classification: 'Major',
    inspection_method: 'Calipers',
    tolerance_source: 'drawing',
    ...drawing('a3f1c9'),
  },
  {
    balloon_number: '2',
    zone: 'B3',
    char_type: 'Dimension',
    sub_type: 'Linear',
    nominal_value: '64.50',
    unit: 'mm',
    plus_tolerance: '0.05',
    minus_tolerance: '0.05',
    classification: 'Critical',
    inspection_method: 'CMM',
    tolerance_source: 'drawing',
    ...drawing('b81d02'),
  },
  {
    balloon_number: '3',
    zone: 'C2',
    char_type: 'Dimension',
    sub_type: 'Linear',
    nominal_value: '8.00',
    unit: 'mm',
    plus_tolerance: '0.2',
    minus_tolerance: '0.2',
    classification: 'Minor',
    inspection_method: 'Calipers',
    tolerance_source: 'general',
    ...drawing('c0aa71'),
  },
  {
    balloon_number: '4',
    zone: 'C3',
    char_type: 'Dimension',
    sub_type: 'Diameter',
    nominal_value: '22.000',
    unit: 'mm',
    plus_tolerance: '0.021',
    minus_tolerance: '0',
    classification: 'Critical',
    inspection_method: 'Bore Gauge',
    comments: 'Bearing bore, H7',
    tolerance_source: 'drawing',
    ...drawing('d4e5f6'),
  },
  {
    balloon_number: '5',
    zone: 'C3',
    char_type: 'GTOL',
    sub_type: 'Position',
    nominal_value: '⌖ Ø0.05 Ⓜ A B C',
    unit: 'mm',
    plus_tolerance: '0.05',
    classification: 'Critical',
    inspection_method: 'CMM',
    tolerance_source: 'drawing',
    ...drawing('d4e5f6#1'),
  },
  {
    balloon_number: '6',
    zone: 'D2',
    char_type: 'Dimension',
    sub_type: 'Hole Callout',
    nominal_value: '4X M5x0.8 - 6H ↧ 10',
    unit: 'mm',
    classification: 'Major',
    inspection_method: 'Thread Gauge',
    tolerance_source: 'drawing',
    ...drawing('e19b33#0'),
  },
  {
    balloon_number: '7',
    zone: 'D2',
    char_type: 'Dimension',
    sub_type: 'Hole Callout',
    nominal_value: '↧ 12.0',
    unit: 'mm',
    plus_tolerance: '0.5',
    minus_tolerance: '0',
    classification: 'Minor',
    inspection_method: 'Depth Micrometer',
    tolerance_source: 'drawing',
    ...drawing('e19b33#1'),
  },
  {
    balloon_number: '8',
    zone: 'D3',
    char_type: 'Dimension',
    sub_type: 'Linear',
    nominal_value: '45.00',
    unit: 'mm',
    plus_tolerance: '0.2',
    minus_tolerance: '0.2',
    classification: 'Minor',
    inspection_method: 'Calipers',
    tolerance_source: 'general',
    ...drawing('f77c10'),
  },
  {
    balloon_number: '9',
    zone: 'D4',
    char_type: 'Dimension',
    sub_type: 'Radius',
    nominal_value: 'R3.0',
    unit: 'mm',
    plus_tolerance: '0.5',
    minus_tolerance: '0.5',
    classification: 'Incidental',
    inspection_method: 'Radius Gauge',
    tolerance_source: 'general',
    ...drawing('0a9b8c'),
  },
  {
    balloon_number: '10',
    zone: 'B4',
    char_type: 'Dimension',
    sub_type: 'Angle',
    nominal_value: '30°',
    unit: 'deg',
    plus_tolerance: '0.5°',
    minus_tolerance: '0.5°',
    classification: 'Minor',
    inspection_method: 'Protractor',
    tolerance_source: 'general',
    ...drawing('1b2c3d'),
  },
  {
    balloon_number: '11',
    zone: 'B4',
    char_type: 'GTOL',
    sub_type: 'Flatness',
    nominal_value: '⏥ 0.02',
    unit: 'mm',
    plus_tolerance: '0.02',
    classification: 'Major',
    inspection_method: 'Dial Indicator',
    tolerance_source: 'drawing',
    ...drawing('2c3d4e'),
  },
  {
    balloon_number: '12',
    zone: 'A3',
    char_type: 'GTOL',
    sub_type: 'Perpendicularity',
    nominal_value: '⟂ 0.03 A',
    unit: 'mm',
    plus_tolerance: '0.03',
    classification: 'Major',
    inspection_method: 'CMM',
    tolerance_source: 'drawing',
    ...drawing('3d4e5f'),
  },
  {
    balloon_number: '13',
    zone: 'A2',
    char_type: 'Dimension',
    sub_type: 'Linear',
    nominal_value: '6.35',
    unit: 'mm',
    upper_limit: '6.40',
    lower_limit: '6.30',
    classification: 'Major',
    inspection_method: 'Micrometer (OD)',
    tolerance_source: 'drawing',
    ...drawing('4e5f60', 'Sheet1', 'Section View A-A'),
  },
  {
    balloon_number: '14',
    zone: 'A2',
    char_type: 'Dimension',
    sub_type: 'Linear',
    nominal_value: '15.00',
    unit: 'mm',
    plus_tolerance: '0.2',
    minus_tolerance: '0.2',
    classification: 'Minor',
    inspection_method: 'Calipers',
    tolerance_source: 'general',
    ...drawing('5f6071', 'Sheet1', 'Section View A-A'),
  },
  {
    balloon_number: '15',
    zone: 'C1',
    char_type: 'Dimension',
    sub_type: 'Diameter',
    nominal_value: 'Ø5.50 THRU',
    unit: 'mm',
    plus_tolerance: '0.10',
    minus_tolerance: '0',
    classification: 'Major',
    inspection_method: 'Pin Gauge',
    tolerance_source: 'drawing',
    ...drawing('607182'),
  },
  {
    balloon_number: '16',
    zone: 'C1',
    char_type: 'Dimension',
    sub_type: 'Linear',
    nominal_value: '96.00',
    unit: 'mm',
    plus_tolerance: '0.05',
    minus_tolerance: '0.05',
    classification: 'Critical',
    inspection_method: 'CMM',
    comments: 'Motor bolt pattern',
    tolerance_source: 'drawing',
    ...drawing('718293'),
  },
  {
    balloon_number: '17',
    zone: 'B1',
    char_type: 'Note',
    sub_type: 'Surface Finish',
    nominal_value: 'Ra 1.6',
    unit: 'µm',
    classification: 'Major',
    inspection_method: 'Surface Roughness Tester',
    tolerance_source: null,
    ...drawing('8293a4'),
  },
  {
    balloon_number: '18',
    zone: 'B2',
    char_type: 'Dimension',
    sub_type: 'Linear',
    nominal_value: '3.00',
    unit: 'mm',
    plus_tolerance: '0.2',
    minus_tolerance: '0.2',
    classification: 'Incidental',
    inspection_method: 'Calipers',
    tolerance_source: 'general',
    ...drawing('93a4b5', 'Sheet2', 'Detail View B (2:1)'),
  },
  {
    balloon_number: '19',
    zone: 'B3',
    char_type: 'Dimension',
    sub_type: 'Chamfer',
    nominal_value: '0.5 X 45°',
    unit: 'mm',
    classification: 'Incidental',
    inspection_method: 'Visual',
    tolerance_source: null,
    ...drawing('a4b5c6', 'Sheet2', 'Detail View B (2:1)'),
  },
  {
    balloon_number: '20',
    zone: 'C2',
    char_type: 'Dimension',
    sub_type: 'Linear',
    nominal_value: '28.00',
    unit: 'mm',
    plus_tolerance: '0.10',
    minus_tolerance: '0.10',
    classification: 'Major',
    inspection_method: 'Height Gauge',
    tolerance_source: 'drawing',
    ...drawing('b5c6d7', 'Sheet2', 'Drawing View4'),
  },
  {
    balloon_number: '21',
    zone: 'C3',
    char_type: 'GTOL',
    sub_type: 'Parallelism',
    nominal_value: '∥ 0.05 A',
    unit: 'mm',
    plus_tolerance: '0.05',
    classification: 'Major',
    inspection_method: 'Dial Indicator',
    tolerance_source: 'drawing',
    ...drawing('c6d7e8', 'Sheet2', 'Drawing View4'),
  },
  {
    balloon_number: '22',
    zone: 'D1',
    char_type: 'Note',
    sub_type: null,
    nominal_value: 'Anodize per MIL-A-8625 Type II, Class 2, black',
    unit: null,
    classification: 'Major',
    inspection_method: 'Visual',
    tolerance_source: null,
    ...drawing('d7e8f9', 'Sheet2', null),
  },
  // Manual rows: no drawing annotation behind them.
  {
    balloon_number: '23',
    zone: null,
    char_type: 'Note',
    sub_type: null,
    nominal_value: 'Break all sharp edges, no burrs',
    unit: null,
    classification: 'Minor',
    inspection_method: 'Visual',
    operation: 'Final',
    source_key: null,
    source_sheet: null,
    source_view: null,
    tolerance_source: null,
  },
  {
    balloon_number: '24',
    zone: null,
    char_type: 'Note',
    sub_type: null,
    nominal_value: 'Material certificate 6061-T6',
    unit: null,
    classification: 'Major',
    inspection_method: 'Visual',
    operation: 'Receiving',
    comments: 'Attach cert to report',
    source_key: null,
    source_sheet: null,
    source_view: null,
    tolerance_source: null,
  },
  {
    balloon_number: '25',
    zone: null,
    char_type: 'Dimension',
    sub_type: 'Linear',
    nominal_value: 'Mass 182 g',
    unit: 'g',
    plus_tolerance: '5',
    minus_tolerance: '5',
    classification: 'Incidental',
    inspection_method: 'Scale/Ruler',
    source_key: null,
    source_sheet: null,
    source_view: null,
    tolerance_source: null,
  },
]

const EMPTY_VALUES: InspectionRowValues = {
  sort_order: 0,
  balloon_number: null,
  char_id: null,
  zone: null,
  char_type: null,
  sub_type: null,
  nominal_value: null,
  unit: null,
  plus_tolerance: null,
  minus_tolerance: null,
  upper_limit: null,
  lower_limit: null,
  classification: null,
  inspection_method: null,
  operation: null,
  aql: null,
  sample_size: null,
  supplier_inspection_rate: null,
  internal_inspection_rate: null,
  reference: null,
  comments: null,
  source_key: null,
  source_sheet: null,
  source_view: null,
  tolerance_source: null,
}

/** The 25 characteristics as full row values, `count` of them (the oldest version had fewer). */
export function lookCharacteristics(count = CHARACTERISTICS.length): InspectionRowValues[] {
  return CHARACTERISTICS.slice(0, count).map((c, i) => ({
    ...EMPTY_VALUES,
    sample_size: c.classification === 'Critical' ? 5 : 2,
    ...c,
    // As extraction writes a GTOL: the frame is the value, its tolerance the upper limit.
    ...(c.char_type === 'GTOL'
      ? { plus_tolerance: null, upper_limit: c.plus_tolerance ?? null }
      : {}),
    sort_order: i + 1,
    char_id: c.balloon_number ?? null,
    source_key: c.source_key ? `9f2e${c.source_key}`.padEnd(16, '0') : null,
  }))
}

// ---------------------------------------------------------------------------
// Backend seed
// ---------------------------------------------------------------------------

const hash = (seed: string) => {
  let out = ''
  let state = [...seed].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7)
  while (out.length < 64) {
    state = (state * 1103515245 + 12345) >>> 0
    out += state.toString(16).padStart(8, '0')
  }
  return out.slice(0, 64)
}

export interface LookSeedIds {
  orgId: string
  vaultId: string
  userId: string
  otherUserId: string
}

/** `file_version` id of a look file's version `n`. */
export function lookVersionId(fileName: string, n: number): string {
  const index = LOOK_FILES.findIndex((f) => f.name === fileName)
  return `00000000-0000-4000-8000-fe50${String(index).padStart(4, '0')}${String(n).padStart(4, '0')}`
}

const DAY = 86_400_000

/** Seed versions, characteristics, snapshots, reports and outputs; the org's report naming. */
export function seedLookInspection(db: FakeSupabase, ids: LookSeedIds, now = Date.now()): void {
  const iso = (daysAgo: number, hour = 10) =>
    new Date(Math.floor((now - daysAgo * DAY) / DAY) * DAY + hour * 3_600_000).toISOString()

  const org = db.rows('organization').find((r) => r.id === ids.orgId)
  if (org) {
    org.settings = {
      ...((org.settings as Record<string, unknown> | null) ?? {}),
      inspection_reports: {
        number_pattern: '{partNumber}_Rev{rev}_IRv{n}',
        sequence_scope: 'drawing',
        include_logo: true,
      },
    }
  }

  // Versions of every look file (the Inspection tab's history selector and report version numbers).
  LOOK_FILES.forEach((f, fileIndex) => {
    for (let n = 1; n <= f.version; n++) {
      const daysAgo = (f.version - n) * 9 + 2 + fileIndex
      db.seed('file_version', {
        id: lookVersionId(f.name, n),
        file_id: LOOK_FILE_IDS[f.name],
        version: n,
        revision: n === 1 && f.revision === 'B' ? 'A' : f.revision,
        content_hash: hash(`${f.name}-${n}`),
        file_size: 180_000 + n * 3_100,
        created_by: n % 2 === 0 ? ids.otherUserId : ids.userId,
        created_at: iso(daysAgo),
        state: f.state,
        part_number: f.partNumber,
        description: f.description,
        comment:
          n === 1
            ? 'Initial release'
            : n === 2
              ? 'Balloons and inspection table'
              : 'Bolt pattern tolerance tightened',
        inspection_hash:
          f.name === LOOK_DRAWING && n > 1
            ? hash(`insp-${n}`)
            : f.name === LOOK_READONLY_DRAWING
              ? hash('insp-asm')
              : null,
      })
    }
  })

  const drawingId = LOOK_FILE_IDS[LOOK_DRAWING]
  // Live table (checked out by me).
  for (const row of lookCharacteristics()) {
    db.seed('inspection_characteristic', {
      ...row,
      file_id: drawingId,
      org_id: ids.orgId,
      is_key: row.classification === 'Critical',
      created_by: ids.userId,
      updated_by: ids.userId,
    })
  }
  // Snapshots: v2 had the first 21, v3 all 25.
  for (const [n, count] of [
    [2, 21],
    [3, 25],
  ] as const) {
    for (const row of lookCharacteristics(count)) {
      db.seed('inspection_characteristic_version', {
        ...row,
        file_version_id: lookVersionId(LOOK_DRAWING, n),
        org_id: ids.orgId,
        is_key: row.classification === 'Critical',
      })
    }
  }
  // The assembly drawing (checked out by someone else): a short read-only table.
  const asmId = LOOK_FILE_IDS[LOOK_READONLY_DRAWING]
  for (const row of lookCharacteristics(8)) {
    db.seed('inspection_characteristic', {
      ...row,
      file_id: asmId,
      org_id: ids.orgId,
      is_key: false,
      created_by: ids.otherUserId,
      updated_by: ids.otherUserId,
    })
  }

  const templates = lookTemplateRows(ids, iso)
  for (const t of templates) db.seed('inspection_template' as never, t as never)

  // Reports across versions 2 and 3, one per status, newest last here (listed newest first).
  const reports: Array<{
    n: number
    seq: number
    v: number
    status: string
    daysAgo: number
    tpl: 0 | 1
    results?: { pass: number; fail: number; blank: number }
    notes?: string
  }> = [
    {
      n: 1,
      seq: 1,
      v: 2,
      status: 'rejected',
      daysAgo: 14,
      tpl: 0,
      results: { pass: 18, fail: 2, blank: 1 },
      notes: 'Bolt pattern out of tolerance on 2 of 5 parts',
    },
    {
      n: 2,
      seq: 2,
      v: 2,
      status: 'accepted',
      daysAgo: 11,
      tpl: 1,
      results: { pass: 21, fail: 0, blank: 0 },
    },
    {
      n: 3,
      seq: 3,
      v: 3,
      status: 'returned',
      daysAgo: 4,
      tpl: 0,
      results: { pass: 22, fail: 1, blank: 2 },
    },
    { n: 4, seq: 4, v: 3, status: 'sent', daysAgo: 2, tpl: 1 },
    { n: 5, seq: 5, v: 3, status: 'issued', daysAgo: 0, tpl: 0 },
  ]
  for (const r of reports) {
    const tpl = templates[r.tpl]
    const total = r.v === 2 ? 21 : 25
    const returned = r.results !== undefined
    db.seed(
      'inspection_report' as never,
      {
        id: `00000000-0000-4000-8000-1e9070000${r.n.toString().padStart(3, '0')}`,
        org_id: ids.orgId,
        file_id: drawingId,
        file_version_id: lookVersionId(LOOK_DRAWING, r.v),
        template_id: tpl.id,
        template_name: tpl.name,
        template_hash: tpl.storage_hash,
        report_number: `BR-103849-201_Rev${r.v === 1 ? 'A' : 'B'}_IRv${r.seq}`,
        sequence: r.seq,
        title: null,
        status: r.status,
        storage_hash: hash(`report-${r.n}`),
        file_size: 412_000 + r.n * 9_000,
        characteristic_count: total,
        drawing_pdf_hash: hash(`pdf-${r.v}`),
        returned_hash: returned ? hash(`returned-${r.n}`) : null,
        returned_at: returned ? iso(r.daysAgo - 1, 15) : null,
        returned_by: returned ? ids.otherUserId : null,
        results: null,
        results_summary: r.results ? { total, ...r.results } : null,
        notes: r.notes ?? null,
        created_by: r.n % 2 === 0 ? ids.otherUserId : ids.userId,
        created_at: iso(r.daysAgo, 9 + r.n),
        updated_by: ids.userId,
        updated_at: iso(Math.max(0, r.daysAgo - 1), 16),
      } as never,
    )
  }

  // Version outputs of the drawing's latest versions (PDF renders), for the chevron.
  for (const v of [2, 3]) {
    db.seed('drawing_pdf_render', {
      file_id: drawingId,
      file_version_id: lookVersionId(LOOK_DRAWING, v),
      org_id: ids.orgId,
      storage_hash: hash(`pdf-${v}`),
      file_size: 1_240_000 + v * 21_000,
      is_closure_exact: true,
      generated_by: ids.userId,
      generated_at: iso(v === 3 ? 4 : 13, 8),
    })
  }
  const partId = LOOK_FILE_IDS['BR-103849-201.SLDPRT']
  db.seed(
    'file_version_output' as never,
    {
      org_id: ids.orgId,
      file_id: partId,
      file_version_id: lookVersionId('BR-103849-201.SLDPRT', 6),
      kind: 'step',
      configuration: null,
      storage_hash: hash('step-6'),
      file_size: 2_830_000,
      file_name: 'BR-103849-201_RevB.step',
      is_closure_exact: true,
      generated_by: ids.userId,
      generated_at: iso(3, 11),
    } as never,
  )
}

/** inspection_template rows; `layout` is filled in by the scene that needs it (analysis is async). */
function lookTemplateRows(ids: LookSeedIds, iso: (daysAgo: number, hour?: number) => string) {
  return [
    {
      id: '00000000-0000-4000-8000-7e3910000001',
      org_id: ids.orgId,
      name: 'Dimensional inspection report',
      description: 'Standard supplier report: three measurements per characteristic, sign-off.',
      storage_hash: hash('tpl-dimensional'),
      file_size: 18_400,
      original_filename: 'Dimensional inspection report.xlsx',
      revision: 3,
      is_default: true,
      layout: null,
      archived_at: null,
      created_by: ids.userId,
      created_at: iso(60),
      updated_by: ids.userId,
      updated_at: iso(12),
    },
    {
      id: '00000000-0000-4000-8000-7e3910000002',
      org_id: ids.orgId,
      name: 'First article inspection (AS9102 Form 3)',
      description: 'Characteristic accountability for first articles.',
      storage_hash: hash('tpl-fai'),
      file_size: 21_900,
      original_filename: 'FAI Form 3.xlsx',
      revision: 1,
      is_default: false,
      layout: null,
      archived_at: null,
      created_by: ids.userId,
      created_at: iso(40),
      updated_by: ids.userId,
      updated_at: iso(40),
    },
    {
      id: '00000000-0000-4000-8000-7e3910000003',
      org_id: ids.orgId,
      name: 'Customer CMM layout (legacy)',
      description: 'Old layout without result columns.',
      storage_hash: hash('tpl-legacy'),
      file_size: 9_800,
      original_filename: 'cmm_layout_v2.xlsx',
      revision: 2,
      is_default: false,
      layout: null,
      archived_at: null,
      created_by: ids.otherUserId,
      created_at: iso(120),
      updated_by: ids.otherUserId,
      updated_at: iso(90),
    },
  ]
}

export const LOOK_TEMPLATE_IDS = {
  dimensional: '00000000-0000-4000-8000-7e3910000001',
  fai: '00000000-0000-4000-8000-7e3910000002',
  legacy: '00000000-0000-4000-8000-7e3910000003',
} as const
