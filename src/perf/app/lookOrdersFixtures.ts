/**
 * Fixture data for the ui-look Orders scenes, on top of the review scenes' project folder
 * (lookReviewFixtures.ts: the pump assembly, its parts and drawings, their versions and PDFs):
 * STEP outputs with real stored bytes for some model versions (so chips are ready or missing and
 * an export downloads and hash-checks them), the drawing-to-model references the line planner
 * pairs on, three suppliers, and the order world the scenes start from, built through the order
 * RPCs (lookOrdersModel.ts) as the perf user and Sam.
 */
import type { FakeSupabase, Row } from '@/test/fakeSupabase'

import type { LookOrdersModel } from './lookOrdersModel'
import {
  LOOK_REVIEW_FILE_IDS,
  LOOK_REVIEW_FILES,
  LOOK_REVIEW_FOLDER,
  LOOK_REVIEW_PEOPLE,
  lookReviewVersionId,
  sha256Hex,
  storeLookReviewPdf,
} from './lookReviewFixtures'

const DAY = 86_400_000

/** Model versions that have a STEP at boot; PMP-2002.SLDPRT has none ("Missing STEP"). */
const STEP_VERSIONS: Array<[string, number]> = [
  ['PMP-2000.SLDASM', 4],
  ['PMP-2001.SLDPRT', 4],
  ['PMP-2001.SLDPRT', 5],
  ['PMP-2003.SLDPRT', 2],
]

export const LOOK_SUPPLIERS = {
  northline: { id: '00000000-0000-4000-8000-5a9910000001', name: 'Northline Machining', code: 'NLM' },
  apex: { id: '00000000-0000-4000-8000-5a9910000002', name: 'Apex Polymer Works', code: 'APW' },
  harbor: { id: '00000000-0000-4000-8000-5a9910000003', name: 'Harbor Sheet Metal', code: 'HSM' },
} as const

export interface LookOrdersIds {
  orgId: string
  vaultId: string
  userId: string
}

const spec = (name: string) => LOOK_REVIEW_FILES.find((f) => f.name === name)!

/** A small STEP file whose bytes differ per version, stored under its SHA-256. */
export async function storeLookStep(db: FakeSupabase, ids: LookOrdersIds, name: string, version: number): Promise<void> {
  const base = name.replace(/\.[^.]+$/, '')
  const text = [
    'ISO-10303-21;',
    'HEADER;',
    `FILE_DESCRIPTION(('${base} version ${version}'),'2;1');`,
    `FILE_NAME('${base}.step','2026-10-30T12:00:00',('BluePLM'),(''),'','','');`,
    "FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));",
    'ENDSEC;',
    'DATA;',
    `#1=PRODUCT('${base}','${spec(name).description}','',(#2));`,
    'ENDSEC;',
    'END-ISO-10303-21;',
  ].join('\n')
  const bytes = new TextEncoder().encode(text)
  const storageHash = await sha256Hex(bytes)
  db.storeObject(`vault/${ids.orgId}/${storageHash}`, bytes)
  db.seed('file_version_output' as never, {
    org_id: ids.orgId,
    file_id: LOOK_REVIEW_FILE_IDS[name],
    file_version_id: lookReviewVersionId(name, version),
    kind: 'step',
    configuration: null,
    storage_hash: storageHash,
    file_size: bytes.byteLength,
    file_name: `${base}_Rev${spec(name).revision}.step`,
    is_closure_exact: true,
    generated_by: ids.userId,
    generated_at: new Date(Date.now() - 3 * DAY).toISOString(),
  } as never)
}

/** Record the PDF of a drawing version (what Generate does with SOLIDWORKS). */
export function storeLookOrderPdf(db: FakeSupabase, ids: LookOrdersIds, name: string, version: number): Promise<void> {
  return storeLookReviewPdf(db, ids.orgId, ids.userId, spec(name), version)
}

/** STEP outputs, drawing references and suppliers. Once per boot. */
export async function seedLookOrders(db: FakeSupabase, ids: LookOrdersIds): Promise<void> {
  for (const [name, version] of STEP_VERSIONS) await storeLookStep(db, ids, name, version)
  // Each drawing version references its model (the planner's drawing pairing reads these).
  for (const f of LOOK_REVIEW_FILES) {
    if (f.fileType !== 'drawing') continue
    for (const child of f.references) {
      const model = spec(child)
      for (let n = 1; n <= f.version; n++) {
        db.seed('file_version_reference', {
          org_id: ids.orgId,
          parent_file_id: LOOK_REVIEW_FILE_IDS[f.name],
          parent_version_id: lookReviewVersionId(f.name, n),
          child_file_id: LOOK_REVIEW_FILE_IDS[child],
          child_version_id: lookReviewVersionId(child, model.version),
          child_path: `${LOOK_REVIEW_FOLDER}/${child}`,
          reference_type: 'reference',
          is_exact: true,
        })
      }
    }
  }
  for (const s of Object.values(LOOK_SUPPLIERS)) {
    db.seed('supplier', { id: s.id, org_id: ids.orgId, name: s.name, code: s.code, is_active: true })
  }
}

// ---------------------------------------------------------------------------
// The order world
// ---------------------------------------------------------------------------

interface LineSpec {
  file: string
  version?: number
  drawing?: string
  drawingVersion?: number
  quantity?: number
  kinds?: string[]
  notes?: string
}

const latestOf = (db: FakeSupabase, name: string) =>
  Number(db.rows('file').find((f) => f.id === LOOK_REVIEW_FILE_IDS[name])?.version ?? spec(name).version)

function lineJson(db: FakeSupabase, l: LineSpec): Row {
  return {
    file_version_id: lookReviewVersionId(l.file, l.version ?? latestOf(db, l.file)),
    ...(l.drawing ? { drawing_version_id: lookReviewVersionId(l.drawing, l.drawingVersion ?? latestOf(db, l.drawing)) } : {}),
    ...(l.quantity ? { quantity: l.quantity } : {}),
    ...(l.kinds ? { output_kinds: l.kinds } : {}),
  }
}

interface OrderSpec {
  key: string
  title: string
  by?: 'author' | 'sam'
  purpose?: 'quote' | 'purchase'
  supplier?: keyof typeof LOOK_SUPPLIERS
  supplierName?: string
  dueInDays?: number
  notes?: string
  lines: LineSpec[]
  /** Status moves after the lines are added, with `allowMissing` for a send. */
  moves?: Array<'sent' | 'received' | 'closed' | 'cancelled'>
  allowMissing?: boolean
  /** How long ago it was created; its moves are spread after that. */
  daysAgo: number
}

const dueIn = (days: number) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10)

export const LOOK_MAIN_DRAFT = 'pumpBuild'

const WORLD: OrderSpec[] = [
  {
    key: 'flange', title: 'Mounting flange, first article', supplierName: 'Cedar Lane Fabrication', daysAgo: 41,
    lines: [{ file: 'PMP-2004.SLDDRW', quantity: 2 }], moves: ['sent', 'received', 'closed'],
  },
  {
    key: 'sealQuote', title: 'Seal carrier, quote', purpose: 'quote', supplier: 'northline', daysAgo: 33,
    lines: [{ file: 'PMP-2003.SLDPRT', drawing: 'PMP-2003.SLDDRW', quantity: 50 }], moves: ['cancelled'],
  },
  {
    key: 'impeller', title: 'Impeller, first batch', supplier: 'apex', daysAgo: 24,
    lines: [{ file: 'PMP-2002.SLDPRT', drawing: 'PMP-2002.SLDDRW', drawingVersion: 1, quantity: 12, kinds: ['pdf'] }],
    moves: ['sent', 'received'],
  },
  {
    key: 'housing', title: 'Pump housing, rev C machining', supplier: 'northline', dueInDays: 9, daysAgo: 6,
    notes: 'Bead blast after machining. Certificates of conformance with the shipment.',
    lines: [
      { file: 'PMP-2001.SLDPRT', drawing: 'PMP-2001.SLDDRW', quantity: 6 },
      { file: 'PMP-2004.SLDDRW', quantity: 6 },
      { file: 'PMP-2002.SLDPRT', drawing: 'PMP-2002.SLDDRW', quantity: 6 },
    ],
    moves: ['sent'], allowMissing: true,
  },
  {
    key: 'spares', title: 'Spare impellers', by: 'sam', supplier: 'apex', daysAgo: 2,
    lines: [{ file: 'PMP-2002.SLDPRT', drawing: 'PMP-2002.SLDDRW', quantity: 20 }],
  },
  {
    key: LOOK_MAIN_DRAFT, title: 'Pump assembly, rev B build', supplier: 'northline', dueInDays: 14, daysAgo: 1,
    notes: 'Clear anodize per drawing notes. Ship to the receiving dock, attention Sam Rivera.',
    lines: [
      { file: 'PMP-2000.SLDASM', drawing: 'PMP-2000.SLDDRW', quantity: 2 },
      { file: 'PMP-2001.SLDPRT', version: 4, drawing: 'PMP-2001.SLDDRW', quantity: 4, notes: 'Bore H7, see section A-A' },
      { file: 'PMP-2002.SLDPRT', drawing: 'PMP-2002.SLDDRW', quantity: 4 },
      { file: 'PMP-2003.SLDPRT', drawing: 'PMP-2003.SLDDRW', quantity: 4 },
      { file: 'PMP-2004.SLDDRW', quantity: 2 },
    ],
  },
]

/** The purged line of the main draft: its file was deleted from the vault, only the snapshot is left. */
const PURGED_LINE = { file_name: 'PMP-1990.SLDPRT', part_number: 'PMP-1990', description: 'Gasket, housing, EPDM', revision: 'A', version: 2 }

/**
 * Build the order world: one order in every status, Sam's draft, and the main draft with ready,
 * missing and not-included outputs, a line pinned to an older version, a purged line and two
 * lines in a vault the user cannot read. Returns the order ids by key.
 */
export function buildLookOrderWorld(db: FakeSupabase, model: LookOrdersModel, ids: LookOrdersIds): Record<string, string> {
  const out: Record<string, string> = {}
  const previous = db.actorId
  for (const o of WORLD) {
    db.actorId = o.by === 'sam' ? LOOK_REVIEW_PEOPLE.sam.id : ids.userId
    const supplier = o.supplier ? LOOK_SUPPLIERS[o.supplier] : null
    const created = model.create({
      p_title: o.title,
      p_purpose: o.purpose ?? 'purchase',
      p_supplier_id: supplier?.id ?? null,
      p_supplier_name: supplier?.name ?? o.supplierName ?? null,
      p_due_date: o.dueInDays === undefined ? null : dueIn(o.dueInDays),
      p_notes: o.notes ?? null,
    }).order as Row
    const id = String(created.id)
    out[o.key] = id
    model.addLines({ p_order_id: id, p_lines: o.lines.map((l) => lineJson(db, l)) })
    o.lines.forEach((l, i) => {
      if (!l.notes) return
      const line = model.lines(id)[i]
      if (line) line.notes = l.notes
    })
    for (const status of o.moves ?? []) model.setStatus({ p_order_id: id, p_status: status, p_allow_missing: o.allowMissing === true })
    // Dates as a real history would have them, oldest first.
    const row = db.rows('supply_order' as never).find((r) => r.id === id)!
    const at = (days: number) => new Date(Date.now() - days * DAY).toISOString()
    row.created_at = at(o.daysAgo)
    row.updated_at = at(Math.max(0, o.daysAgo - 1))
    if (row.sent_at) row.sent_at = at(o.daysAgo - 1)
    if (row.received_at) row.received_at = at(o.daysAgo - 9)
    if (row.closed_at) row.closed_at = at(o.daysAgo - 10)
    if (row.cancelled_at) row.cancelled_at = at(o.daysAgo - 3)
  }
  db.actorId = previous

  // The main draft: the purged line, and two lines RLS hides.
  const main = out[LOOK_MAIN_DRAFT]
  const position = model.lines(main).length + 1
  db.seed('supply_order_line' as never, {
    ...PURGED_LINE,
    order_id: main, org_id: ids.orgId, vault_id: ids.vaultId, position, file_id: null, file_version_id: null,
    quantity: 4, output_kinds: ['step'], added_by: ids.userId, added_at: new Date(Date.now() - DAY).toISOString(),
  } as never)
  model.hidden.set(main, 2)
  // Schema 515: which vaults they are in (supply_order_count_hidden_lines).
  model.hiddenVaults.set(main, [
    { vault_id: 'look-vault-electronics', vault_name: 'Electronics', count: 1 },
    { vault_id: 'look-vault-archive', vault_name: 'Supplier archive', count: 1 },
  ])
  const mainRow = db.rows('supply_order' as never).find((r) => r.id === main)!
  mainRow.line_count = model.lines(main).length + 2
  return out
}
