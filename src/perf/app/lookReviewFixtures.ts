/**
 * Fixture data for the ui-look review scenes: a project folder of drawings, parts and an assembly
 * with checked-in versions, a distinct one-sheet PDF per drawing version (generated here, stored in
 * the fake bucket under its real SHA-256), colleagues and teams, a workflow with a review stage, and
 * a gate review. `lookReviewBackend.ts` serves the review RPCs over these rows.
 */
import type { SyntheticVault } from '@/lib/loadPipelineFixtures'
import type { FakeSupabase } from '@/test/fakeSupabase'

export const LOOK_REVIEW_FOLDER = 'P00/Assy-01/Sub-00'

/** The people a run can act as (`__blueplmLook.actAs(key)`); `author` is the perf user. */
export const LOOK_REVIEW_PEOPLE = {
  sam: { id: '00000000-0000-4000-8000-c011ea6e0001', email: 'sam.rivera@example.com', name: 'Sam Rivera' },
  alex: { id: '00000000-0000-4000-8000-c011ea6e0002', email: 'alex.kim@example.com', name: 'Alex Kim' },
  /** The perf backend's second user (PERF_OTHER_USER_ID), already seeded by backend.ts. */
  olive: { id: 'user-other-0002', email: 'olive@example.com', name: 'Olive Other' },
} as const

/** People the review seed adds (the perf user and Olive are seeded by backend.ts). */
const NEW_PEOPLE = ['sam', 'alex'] as const

export const LOOK_REVIEW_TEAMS = {
  mechanical: { id: '00000000-0000-4000-8000-7ea300000001', name: 'Mechanical Review', color: '#3b82f6', members: ['sam', 'alex'] },
  quality: { id: '00000000-0000-4000-8000-7ea300000002', name: 'Quality', color: '#22c55e', members: ['olive'] },
  /** A team with nobody in it: picking it adds no reviewer. */
  electrical: { id: '00000000-0000-4000-8000-7ea300000003', name: 'Electrical', color: '#f97316', members: [] },
} as const

export interface LookReviewFile {
  name: string
  extension: string
  fileType: 'part' | 'assembly' | 'drawing'
  partNumber: string
  description: string
  revision: string
  version: number
  /** Versions with a stored review PDF (drawings only). */
  pdfVersions: number[]
  /** Files this one references, by name (the dependency closure). */
  references: string[]
  /** A reference resolved to the child's latest version, not the one recorded at check-in. */
  approximate?: boolean
  checkedOutBy?: 'me' | 'sam'
}

export const LOOK_REVIEW_FILES: LookReviewFile[] = [
  { name: 'PMP-2000.SLDASM', extension: '.sldasm', fileType: 'assembly', partNumber: 'PMP-2000', description: 'Pump assembly, 24 V', revision: 'B', version: 4, pdfVersions: [], references: ['PMP-2001.SLDPRT', 'PMP-2002.SLDPRT', 'PMP-2003.SLDPRT'] },
  { name: 'PMP-2000.SLDDRW', extension: '.slddrw', fileType: 'drawing', partNumber: 'PMP-2000', description: 'Pump assembly, 24 V', revision: 'B', version: 4, pdfVersions: [2, 3, 4], references: ['PMP-2000.SLDASM'] },
  { name: 'PMP-2001.SLDPRT', extension: '.sldprt', fileType: 'part', partNumber: 'PMP-2001', description: 'Housing, pump, 316 stainless', revision: 'C', version: 5, pdfVersions: [], references: [] },
  { name: 'PMP-2001.SLDDRW', extension: '.slddrw', fileType: 'drawing', partNumber: 'PMP-2001', description: 'Housing, pump, 316 stainless', revision: 'C', version: 3, pdfVersions: [1, 2, 3], references: ['PMP-2001.SLDPRT'] },
  { name: 'PMP-2002.SLDPRT', extension: '.sldprt', fileType: 'part', partNumber: 'PMP-2002', description: 'Impeller, 6-blade, PEEK', revision: 'A', version: 3, pdfVersions: [], references: [] },
  { name: 'PMP-2002.SLDDRW', extension: '.slddrw', fileType: 'drawing', partNumber: 'PMP-2002', description: 'Impeller, 6-blade, PEEK', revision: 'A', version: 2, pdfVersions: [1, 2], references: ['PMP-2002.SLDPRT'], checkedOutBy: 'me' },
  { name: 'PMP-2003.SLDPRT', extension: '.sldprt', fileType: 'part', partNumber: 'PMP-2003', description: 'Carrier, shaft seal, 6061-T6', revision: 'A', version: 2, pdfVersions: [], references: [] },
  { name: 'PMP-2003.SLDDRW', extension: '.slddrw', fileType: 'drawing', partNumber: 'PMP-2003', description: 'Carrier, shaft seal, 6061-T6', revision: 'A', version: 1, pdfVersions: [], references: ['PMP-2003.SLDPRT'], approximate: true },
  { name: 'PMP-2004.SLDDRW', extension: '.slddrw', fileType: 'drawing', partNumber: 'PMP-2004', description: 'Flange, mounting, 6061-T6', revision: 'A', version: 2, pdfVersions: [1, 2], references: [], checkedOutBy: 'sam' },
]

/** The synthetic vault rows the review files take over (clear of the inspection scenes' rows). */
const FIRST_ROW = 40

export const LOOK_REVIEW_FILE_IDS: Record<string, string> = Object.fromEntries(
  LOOK_REVIEW_FILES.map((f, i) => [f.name, `00000000-0000-4000-8000-4e7100000${String(i).padStart(3, '0')}`]),
)

export function lookReviewVersionId(fileName: string, n: number): string {
  const index = LOOK_REVIEW_FILES.findIndex((f) => f.name === fileName)
  return `00000000-0000-4000-8000-4e72${String(index).padStart(4, '0')}${String(n).padStart(4, '0')}`
}

export const LOOK_WORKFLOW = {
  states: [
    { id: '00000000-0000-4000-8000-5a7e00000001', name: 'In Work', color: '#eab308', isReviewStage: false, reviewApprovedStateId: null, checkoutRequired: false },
    { id: '00000000-0000-4000-8000-5a7e00000002', name: 'In Review', color: '#a855f7', isReviewStage: true, reviewApprovedStateId: '00000000-0000-4000-8000-5a7e00000003', checkoutRequired: false },
    { id: '00000000-0000-4000-8000-5a7e00000003', name: 'Released', color: '#22c55e', isReviewStage: false, reviewApprovedStateId: null, checkoutRequired: false, releasesVersion: true },
  ],
  transitions: [
    { id: '00000000-0000-4000-8000-7a2500000001', name: 'Submit for review', fromStateId: '00000000-0000-4000-8000-5a7e00000001', toStateId: '00000000-0000-4000-8000-5a7e00000002', blockingGate: false },
    { id: '00000000-0000-4000-8000-7a2500000002', name: 'Release', fromStateId: '00000000-0000-4000-8000-5a7e00000002', toStateId: '00000000-0000-4000-8000-5a7e00000003', blockingGate: false },
    { id: '00000000-0000-4000-8000-7a2500000003', name: 'Send back', fromStateId: '00000000-0000-4000-8000-5a7e00000002', toStateId: '00000000-0000-4000-8000-5a7e00000001', blockingGate: false },
  ],
}

const WIN = (p: string) => p.replace(/\//g, '\\')

export function lookReviewPath(root: string, name: string): string {
  return `${root}\\${WIN(`${LOOK_REVIEW_FOLDER}/${name}`)}`
}

const hash = (seed: string) => {
  let out = ''
  let state = [...seed].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 11)
  while (out.length < 64) {
    state = (state * 1103515245 + 12345) >>> 0
    out += state.toString(16).padStart(8, '0')
  }
  return out.slice(0, 64)
}

export const lookReviewContentHash = (name: string, n: number) => hash(`review-${name}-${n}`)

/** Put the review files into one folder of the synthetic vault (server rows and disk together). */
export function prepareLookReviewVault(vault: SyntheticVault, root: string, userId: string, samId: string): void {
  LOOK_REVIEW_FILES.forEach((f, i) => {
    const row = vault.serverRows[FIRST_ROW + i]
    const relativePath = `${LOOK_REVIEW_FOLDER}/${f.name}`
    const holder = f.checkedOutBy === 'me' ? userId : f.checkedOutBy === 'sam' ? samId : null
    const oldPath = row.file_path
    Object.assign(row, {
      id: LOOK_REVIEW_FILE_IDS[f.name],
      file_path: relativePath,
      file_name: f.name,
      extension: f.extension,
      file_type: f.fileType,
      part_number: f.partNumber,
      description: f.description,
      revision: f.revision,
      version: f.version,
      content_hash: lookReviewContentHash(f.name, f.version),
      state: 'In Review',
      checked_out_by: holder,
      checked_out_at: holder ? '2026-10-30T09:12:00.000Z' : null,
      checked_out_file_path: holder ? relativePath : null,
      checked_out_file_name: holder ? f.name : null,
      custom_properties: { Project: 'Bilge pump', Material: f.description.split(', ').pop() ?? '' },
    })
    const entry = {
      name: f.name,
      relativePath,
      path: `${root}\\${WIN(relativePath)}`,
      extension: f.extension,
    }
    const local = vault.localEntries.find((e) => !e.isDirectory && e.relativePath === oldPath)
    if (local) Object.assign(local, entry)
    else {
      vault.localEntries.push({
        ...entry,
        isDirectory: false,
        size: 210_000 + i * 6_271,
        modifiedTime: '2026-10-01T12:00:00.000Z',
        ino: 9_100_000 + i,
      })
    }
  })
}

// ---------------------------------------------------------------------------
// Drawing PDFs: one 17 x 11 in sheet per version, different per version so each hash differs
// ---------------------------------------------------------------------------

/** A vector drawing sheet: border, views that change per version, a revision note, a title block. */
export function lookReviewPdf(file: LookReviewFile, version: number): Uint8Array {
  const esc = (text: string) => text.replace(/[\\()]/g, (c) => `\\${c}`)
  const ops: string[] = ['0.12 0.12 0.12 RG 0.12 0.12 0.12 rg 1 J 1 j']
  const rect = (x: number, y: number, w: number, h: number, lw = 1.6) => ops.push(`${lw} w ${x} ${792 - y - h} ${w} ${h} re S`)
  const line = (x1: number, y1: number, x2: number, y2: number, lw = 0.8) => ops.push(`${lw} w ${x1} ${792 - y1} m ${x2} ${792 - y2} l S`)
  const circle = (cx: number, cy: number, r: number, lw = 1.6) => {
    const k = 0.5523 * r
    const y = 792 - cy
    ops.push(
      `${lw} w ${cx + r} ${y} m ${cx + r} ${y + k} ${cx + k} ${y + r} ${cx} ${y + r} c ${cx - k} ${y + r} ${cx - r} ${y + k} ${cx - r} ${y} c ` +
        `${cx - r} ${y - k} ${cx - k} ${y - r} ${cx} ${y - r} c ${cx + k} ${y - r} ${cx + r} ${y - k} ${cx + r} ${y} c S`,
    )
  }
  const text = (x: number, y: number, size: number, value: string, bold = false) =>
    ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x} ${792 - y} Td (${esc(value)}) Tj ET`)

  rect(14, 14, 1196, 764, 2.2)
  const grow = (version - 1) * 12
  if (file.fileType === 'drawing' && file.partNumber === 'PMP-2000') {
    rect(120, 120, 380 + grow, 260)
    circle(310, 250, 90)
    circle(310, 250, 40)
    rect(620, 140, 220, 220)
    line(620, 250, 840, 250)
    text(140, 420, 12, 'FRONT VIEW')
    text(640, 400, 12, 'SECTION A-A')
  } else {
    circle(330, 300, 150 + grow / 2)
    circle(330, 300, 60)
    for (let k = 0; k < 6; k++) {
      const a = (Math.PI * 2 * k) / 6
      circle(330 + Math.cos(a) * 110, 300 + Math.sin(a) * 110, 12)
    }
    rect(640, 150, 160, 300)
    text(250, 500, 12, 'FRONT VIEW')
    text(650, 480, 12, 'SIDE VIEW')
  }
  line(120, 90, 500 + grow, 90)
  text(260, 84, 13, `${(152.4 + version * 0.5).toFixed(2)} +/-0.10`)
  text(120, 560, 12, `NOTES: 1. ${version > 1 ? `REVISED IN V${version}: ` : ''}BREAK ALL SHARP EDGES 0.2 MAX.`)
  text(120, 580, 12, '2. SURFACE FINISH 1.6 UNLESS NOTED.')
  rect(830, 640, 370, 130, 1.8)
  line(830, 680, 1200, 680)
  line(830, 725, 1200, 725)
  line(1080, 680, 1080, 770)
  text(842, 668, 17, file.description.toUpperCase().slice(0, 34), true)
  text(842, 698, 9, 'DWG NO.')
  text(842, 716, 17, file.partNumber)
  text(1090, 698, 9, 'REV')
  text(1090, 716, 17, file.revision)
  text(842, 745, 10, `VERSION ${version}  -  SCALE 1:2  -  SHEET 1 OF 1`)
  text(842, 762, 10, 'BILGE PUMP PROJECT')
  const content = ops.join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1224 792] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  ]
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((body, i) => {
    offsets.push(out.length)
    out += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = out.length
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(out)
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Store a drawing version's PDF in the bucket and record its `drawing_pdf_render` row. */
export async function storeLookReviewPdf(db: FakeSupabase, orgId: string, userId: string, file: LookReviewFile, version: number): Promise<void> {
  const bytes = lookReviewPdf(file, version)
  const storageHash = await sha256Hex(bytes)
  db.storeObject(`vault/${orgId}/${storageHash}`, bytes)
  db.seed('drawing_pdf_render', {
    file_id: LOOK_REVIEW_FILE_IDS[file.name],
    file_version_id: lookReviewVersionId(file.name, version),
    org_id: orgId,
    storage_hash: storageHash,
    file_size: bytes.byteLength,
    is_closure_exact: !file.approximate,
    generated_by: userId,
    generated_at: new Date(Date.now() - (10 - version) * 86_400_000).toISOString(),
  })
}

export interface LookReviewSeedIds {
  orgId: string
  vaultId: string
  userId: string
}

const DAY = 86_400_000

/** Colleagues, teams, the review files' `file` and `file_version` rows, and every stored PDF. */
export async function seedLookReviews(db: FakeSupabase, ids: LookReviewSeedIds): Promise<void> {
  const now = Date.now()
  for (const key of NEW_PEOPLE) {
    const p = LOOK_REVIEW_PEOPLE[key]
    db.seed('app_user', { id: p.id, email: p.email, full_name: p.name, role: 'engineer', org_id: ids.orgId })
  }
  for (const t of Object.values(LOOK_REVIEW_TEAMS)) {
    db.seed('team', { id: t.id, org_id: ids.orgId, name: t.name, color: t.color, icon: 'Users', description: `${t.name} team` })
    for (const key of t.members as readonly (keyof typeof LOOK_REVIEW_PEOPLE)[]) db.seed('team_member', { team_id: t.id, user_id: LOOK_REVIEW_PEOPLE[key].id })
  }
  for (const [i, f] of LOOK_REVIEW_FILES.entries()) {
    const holder = f.checkedOutBy === 'me' ? ids.userId : f.checkedOutBy === 'sam' ? LOOK_REVIEW_PEOPLE.sam.id : null
    db.seed('file', {
      id: LOOK_REVIEW_FILE_IDS[f.name],
      org_id: ids.orgId,
      vault_id: ids.vaultId,
      file_name: f.name,
      file_path: `${LOOK_REVIEW_FOLDER}/${f.name}`,
      extension: f.extension,
      file_type: f.fileType,
      part_number: f.partNumber,
      description: f.description,
      revision: f.revision,
      version: f.version,
      content_hash: lookReviewContentHash(f.name, f.version),
      file_size: 210_000 + i * 6_271,
      state: 'In Review',
      checked_out_by: holder,
      created_by: ids.userId,
    })
    for (let n = 1; n <= f.version; n++) {
      db.seed('file_version', {
        id: lookReviewVersionId(f.name, n),
        file_id: LOOK_REVIEW_FILE_IDS[f.name],
        version: n,
        revision: n === 1 && f.revision !== 'A' ? 'A' : f.revision,
        content_hash: lookReviewContentHash(f.name, n),
        file_size: 200_000 + n * 2_900 + i * 6_271,
        created_by: n % 2 === 0 ? LOOK_REVIEW_PEOPLE.sam.id : ids.userId,
        created_at: new Date(now - (f.version - n + 1) * 6 * DAY).toISOString(),
        state: 'In Review',
        part_number: f.partNumber,
        description: f.description,
        comment: n === 1 ? 'Initial check-in' : `Design update ${n}`,
        references_recorded_at: f.references.length ? new Date(now - DAY).toISOString() : null,
      })
    }
    for (const n of f.pdfVersions) await storeLookReviewPdf(db, ids.orgId, ids.userId, f, n)
  }
}
