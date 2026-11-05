/**
 * supabase/migrations/0515_orders_followups.sql on real Postgres (PGlite), applied after 0501-0513
 * to the 5.0 baseline (0514 belongs to another release; the runner tolerates the gap): it stamps
 * 515, and a 4.10 database upgraded through 0500 and the same migrations ends up identical.
 *
 * Covered: output requests (create rules and skips, read RLS, no client writes, claim with explorer
 * edit and vault access, stale re-claim, finish by the claimer only, cancel by the requester or an
 * administrator, done when the output is recorded, pruning); the hidden-line count per vault; the
 * release closure guard on every deletion path (version delete, file purge, vault and organization
 * delete); the RFQ import (mapping, lines, numbering, idempotence, nothing on an empty database).
 *
 * Concurrency (two workers claiming at once, two connections numbering orders at once) needs more
 * than PGlite's one connection: scripts/sql-concurrency.mjs runs it on real Postgres in CI.
 */
import type { PGlite } from '@electric-sql/pglite'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { checkNaming } from '../../../scripts/rename-5.0/namingRules.mjs'
import { inventory } from '../../../scripts/rename-5.0/schemaInventory.mjs'
import {
  actAs,
  actAsOwner,
  bootBaseline,
  bootLegacy,
  compareSnapshots,
  MIGRATIONS,
  readSql,
  seed,
  snapshot,
  type Snapshot,
} from './testing/schemaDb'

const ORG_A = '00000000-0000-0000-0000-00000000000a'
const ORG_B = '00000000-0000-0000-0000-00000000000b'
const ORG_C = '00000000-0000-0000-0000-00000000000c'
const ADMIN = '00000000-0000-0000-0000-000000000001'
const ALICE = '00000000-0000-0000-0000-000000000002' // VA1, explorer edit
const BOB = '00000000-0000-0000-0000-000000000003' // VA1 and VA2, explorer edit
const CAROL = '00000000-0000-0000-0000-000000000004' // VA1, no explorer edit
const DAVE = '00000000-0000-0000-0000-000000000005' // VA1; left out when the orders module is restricted
const OTHER = '00000000-0000-0000-0000-000000000006' // admin of org B
const LONER = '00000000-0000-0000-0000-000000000007' // no organization
const EDITORS = '30000000-0000-0000-0000-000000000001'
const VA1 = '40000000-0000-0000-0000-000000000001'
const VA2 = '40000000-0000-0000-0000-000000000002'
const VA3 = '40000000-0000-0000-0000-000000000003'
const VB = '40000000-0000-0000-0000-000000000004'
const VC = '40000000-0000-0000-0000-000000000005'
const SUP_A = '60000000-0000-0000-0000-000000000001'
const MISSING = '7fffffff-0000-0000-0000-000000000000'

const fid = (n: number) => `50000000-0000-0000-0000-${n.toString(16).padStart(12, '0')}`
const vid = (n: number) => `51000000-0000-0000-0000-${n.toString(16).padStart(12, '0')}`
const hash = (n: number) => n.toString(16).padStart(64, '0')

// Files: [n, org, vault, path, deleted]
const P1 = fid(1) // bracket.sldprt, VA1
const D1 = fid(2) // bracket.slddrw, VA1 (has a PDF)
const D2 = fid(3) // plate.slddrw, VA1
const S1 = fid(4) // secret.sldprt, VA2
const SD = fid(5) // secret.slddrw, VA2
const X1 = fid(6) // spec.pdf, VA1
const T1 = fid(7) // trashed.sldprt, VA1, in the trash
const NV = fid(8) // novers.sldprt, VA1, no version
const PB = fid(9) // org B
const ASM = fid(10) // top.sldasm, VA1: v1, v2 released
const SUB = fid(11) // sub.sldasm, VA1
const PRT = fid(12) // pin.sldprt, VA1: v1 (in the release), v2 (not)
const XA = fid(13) // cross.sldasm, VA1, released, references XQ in VA2
const XQ = fid(14) // cross-part.sldprt, VA2
const V3A = fid(15) // self.sldasm, VA3, released, references V3P in VA3
const V3P = fid(16) // self-part.sldprt, VA3
const CA = fid(17) // org C, released assembly
const CP = fid(18) // org C, its part
const RA = fid(19) // hidden-top.sldasm, VA2, released, references RP in VA1
const RP = fid(20) // shared.sldprt, VA1

const P1V1 = vid(1)
const P1V2 = vid(2)
const D1V1 = vid(3)
const D2V1 = vid(4)
const S1V1 = vid(5)
const SDV1 = vid(6)
const X1V1 = vid(7)
const T1V1 = vid(8)
const PBV1 = vid(9)
const ASMV1 = vid(10)
const ASMV2 = vid(11)
const SUBV1 = vid(12)
const PRTV1 = vid(13)
const PRTV2 = vid(14)
const XAV1 = vid(15)
const XQV1 = vid(16)
const V3AV1 = vid(17)
const V3PV1 = vid(18)
const CAV1 = vid(19)
const CPV1 = vid(20)
const RAV1 = vid(21)
const RPV1 = vid(22)

const RFQ1 = '70000000-0000-0000-0000-000000000001'
const RFQ2 = '70000000-0000-0000-0000-000000000002'
const RFQ3 = '70000000-0000-0000-0000-000000000003'
const RFQ4 = '70000000-0000-0000-0000-000000000004'

const MIGRATION = '0515_orders_followups.sql'
const BEFORE = [
  '0501_server_backups.sql',
  '0502_security_hardening.sql',
  '0503_vault_object_issues.sql',
  '0504_inspection_tables.sql',
  '0505_version_outputs.sql',
  '0506_inspection_report_types.sql',
  '0507_version_output_delete.sql',
  '0508_inspection_report_lineage.sql',
  '0509_release_versions.sql',
  '0510_inspection_working_copy_reports.sql',
  '0511_inspection_template_folder.sql',
  '0512_comment_resolve.sql',
  '0513_supply_orders.sql',
]

type Json = Record<string, unknown>
interface RequestRow {
  id: string
  file_version_id: string
  kind: string
  configuration: string | null
  status: string
  vault_id: string
  requested_by: string | null
  claimed_by: string | null
  claimed_at: string | null
  finished_at: string | null
  error: string | null
  order_id: string | null
}
interface CreateResult {
  ok: boolean
  created: number
  existing: number
  skipped: Array<{ file_version_id: unknown; kind: string; reason: string }>
  requests: RequestRow[]
}

let db: PGlite
let freshSnap: Snapshot

async function rpc<T = Json>(user: string, expr: string, params: unknown[] = []): Promise<T> {
  await actAs(db, user)
  const r = await db.query<{ r: T }>(`SELECT ${expr} AS r`, params)
  return r.rows[0].r
}

async function rows<T>(user: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
  if (user) await actAs(db, user)
  else await actAsOwner(db)
  return (await db.query<T>(sql, params)).rows
}

/** The refusal's HINT (else its message), or null when the statement succeeded. */
async function refusal(user: string | null, sql: string, params: unknown[] = []): Promise<string | null> {
  if (user) await actAs(db, user)
  else await actAsOwner(db)
  try {
    await db.query(sql, params)
    return null
  } catch (e) {
    const err = e as { hint?: string; message?: string }
    return err.hint ?? err.message ?? String(e)
  }
}

/** The refusal's message and HINT, or null when the statement succeeded. */
async function refusalOf(user: string, sql: string, params: unknown[] = []): Promise<{ hint?: string; message: string } | null> {
  await actAs(db, user)
  try {
    await db.query(sql, params)
    return null
  } catch (e) {
    const err = e as { hint?: string; message: string }
    return { hint: err.hint, message: err.message }
  }
}

async function request(user: string, items: Json[]): Promise<CreateResult> {
  return rpc<CreateResult>(user, 'version_output_request_create($1::jsonb)', [JSON.stringify(items)])
}

async function requestRow(id: string): Promise<RequestRow> {
  return (await rows<RequestRow>(null, 'SELECT * FROM version_output_request WHERE id = $1', [id]))[0]
}

async function openRequest(fv: string, kind: string, configuration: string | null = null): Promise<RequestRow | undefined> {
  return (
    await rows<RequestRow>(
      null,
      `SELECT * FROM version_output_request WHERE file_version_id = $1 AND kind = $2
          AND COALESCE(configuration, '') = COALESCE($3, '') AND status IN ('pending', 'claimed')`,
      [fv, kind, configuration],
    )
  )[0]
}

function seedSql(): string {
  const file = (id: string, org: string, vault: string, path: string, n: number, deleted = false) =>
    `('${id}', '${org}', '${vault}', '${path}', '${path.split('/').pop()}', '.${path.split('.').pop()}', '${hash(n)}', 1, '${ADMIN}', ${deleted ? 'NOW()' : 'NULL'})`
  const version = (id: string, fileId: string, n: number, h: number, released = false) =>
    `('${id}', '${fileId}', ${n}, 'A', '${hash(h)}', ${100 + h}, 'PN-${h}', 'Desc ${h}', '${ADMIN}', ${released ? `'2026-06-01'` : 'NULL'})`
  const edge = (org: string, parentV: string, parentF: string, childF: string, childV: string, path: string, exact: boolean) =>
    `('${org}', '${parentV}', '${parentF}', '${childF}', '${childV}', '${path}', ${exact})`
  return `
    INSERT INTO organization (id, name, slug) VALUES
      ('${ORG_A}', 'A', 'org-a'), ('${ORG_B}', 'B', 'org-b'), ('${ORG_C}', 'C', 'org-c');
    INSERT INTO app_user (id, email, org_id, role) VALUES
      ('${ADMIN}', 'admin@a.test', '${ORG_A}', 'admin'),
      ('${ALICE}', 'alice@a.test', '${ORG_A}', 'engineer'),
      ('${BOB}', 'bob@a.test', '${ORG_A}', 'engineer'),
      ('${CAROL}', 'carol@a.test', '${ORG_A}', 'engineer'),
      ('${DAVE}', 'dave@a.test', '${ORG_A}', 'engineer'),
      ('${OTHER}', 'other@b.test', '${ORG_B}', 'admin'),
      ('${LONER}', 'loner@c.test', NULL, 'viewer');
    INSERT INTO team (id, org_id, name) VALUES ('${EDITORS}', '${ORG_A}', 'Editors');
    INSERT INTO team_member (team_id, user_id) VALUES ('${EDITORS}', '${ALICE}'), ('${EDITORS}', '${BOB}');
    INSERT INTO team_permission (team_id, resource, actions) VALUES ('${EDITORS}', 'module:explorer', '{view,create,edit,delete}');
    INSERT INTO vault (id, org_id, name, slug, created_at) VALUES
      ('${VA1}', '${ORG_A}', 'A1', 'a1', '2025-01-01'), ('${VA2}', '${ORG_A}', 'A2', 'a2', '2025-02-01'),
      ('${VA3}', '${ORG_A}', 'A3', 'a3', '2025-03-01'), ('${VB}', '${ORG_B}', 'B', 'b', '2025-01-01'),
      ('${VC}', '${ORG_C}', 'C', 'c', '2025-01-01');
    INSERT INTO vault_access (vault_id, user_id) VALUES
      ('${VA1}', '${ALICE}'), ('${VA1}', '${BOB}'), ('${VA2}', '${BOB}'), ('${VA1}', '${CAROL}'), ('${VA1}', '${DAVE}');
    INSERT INTO file (id, org_id, vault_id, file_path, file_name, extension, content_hash, version, created_by, deleted_at) VALUES
      ${file(P1, ORG_A, VA1, 'a1/bracket.sldprt', 1)},
      ${file(D1, ORG_A, VA1, 'a1/bracket.slddrw', 2)},
      ${file(D2, ORG_A, VA1, 'a1/plate.slddrw', 3)},
      ${file(S1, ORG_A, VA2, 'a2/secret.sldprt', 4)},
      ${file(SD, ORG_A, VA2, 'a2/secret.slddrw', 5)},
      ${file(X1, ORG_A, VA1, 'a1/spec.pdf', 6)},
      ${file(T1, ORG_A, VA1, 'a1/trashed.sldprt', 7, true)},
      ${file(NV, ORG_A, VA1, 'a1/novers.sldprt', 8)},
      ${file(PB, ORG_B, VB, 'b/b.sldprt', 9)},
      ${file(ASM, ORG_A, VA1, 'a1/top.sldasm', 10)},
      ${file(SUB, ORG_A, VA1, 'a1/sub.sldasm', 11)},
      ${file(PRT, ORG_A, VA1, 'a1/pin.sldprt', 12)},
      ${file(XA, ORG_A, VA1, 'a1/cross.sldasm', 13)},
      ${file(XQ, ORG_A, VA2, 'a2/cross-part.sldprt', 14)},
      ${file(V3A, ORG_A, VA3, 'a3/self.sldasm', 15)},
      ${file(V3P, ORG_A, VA3, 'a3/self-part.sldprt', 16)},
      ${file(CA, ORG_C, VC, 'c/top.sldasm', 17)},
      ${file(CP, ORG_C, VC, 'c/part.sldprt', 18)},
      ${file(RA, ORG_A, VA2, 'a2/hidden-top.sldasm', 19)},
      ${file(RP, ORG_A, VA1, 'a1/shared.sldprt', 20)};
    INSERT INTO file_version (id, file_id, version, revision, content_hash, file_size, part_number, description, created_by, released_at) VALUES
      ${version(P1V1, P1, 1, 1)}, ${version(P1V2, P1, 2, 2)}, ${version(D1V1, D1, 1, 3)}, ${version(D2V1, D2, 1, 4)},
      ${version(S1V1, S1, 1, 5)}, ${version(SDV1, SD, 1, 6)}, ${version(X1V1, X1, 1, 7)}, ${version(T1V1, T1, 1, 8)},
      ${version(PBV1, PB, 1, 9)}, ${version(ASMV1, ASM, 1, 10)}, ${version(ASMV2, ASM, 2, 11, true)},
      ${version(SUBV1, SUB, 1, 12)}, ${version(PRTV1, PRT, 1, 13)}, ${version(PRTV2, PRT, 2, 14)},
      ${version(XAV1, XA, 1, 15, true)}, ${version(XQV1, XQ, 1, 16)}, ${version(V3AV1, V3A, 1, 17, true)},
      ${version(V3PV1, V3P, 1, 18)}, ${version(CAV1, CA, 1, 19, true)}, ${version(CPV1, CP, 1, 20)},
      ${version(RAV1, RA, 1, 21, true)}, ${version(RPV1, RP, 1, 22)};
    INSERT INTO file_version_reference (org_id, parent_version_id, parent_file_id, child_file_id, child_version_id, child_path, is_exact) VALUES
      ${edge(ORG_A, ASMV2, ASM, SUB, SUBV1, 'a1/sub.sldasm', true)},
      ${edge(ORG_A, SUBV1, SUB, PRT, PRTV1, 'a1/pin.sldprt', false)},
      ${edge(ORG_A, ASMV1, ASM, PRT, PRTV2, 'a1/pin.sldprt', true)},
      ${edge(ORG_A, XAV1, XA, XQ, XQV1, 'a2/cross-part.sldprt', true)},
      ${edge(ORG_A, V3AV1, V3A, V3P, V3PV1, 'a3/self-part.sldprt', true)},
      ${edge(ORG_C, CAV1, CA, CP, CPV1, 'c/part.sldprt', true)},
      ${edge(ORG_A, RAV1, RA, RP, RPV1, 'a1/shared.sldprt', true)};
    INSERT INTO file_version_output (org_id, file_id, file_version_id, kind, configuration, storage_hash, file_size, file_name) VALUES
      ('${ORG_A}', '${P1}', '${P1V2}', 'step', NULL, '${hash(100)}', 11, 'bracket.step');
    INSERT INTO drawing_pdf_render (org_id, file_id, file_version_id, storage_hash, file_size) VALUES
      ('${ORG_A}', '${D1}', '${D1V1}', '${hash(101)}', 13);
    INSERT INTO supplier (id, org_id, name) VALUES ('${SUP_A}', '${ORG_A}', 'Acme');

    -- RFQs (before 0515 imports them)
    INSERT INTO rfq (id, org_id, rfq_number, title, status, due_date, internal_notes, supplier_notes,
                     awarded_supplier_id, created_at, updated_at, created_by) VALUES
      ('${RFQ1}', '${ORG_A}', 'RFQ-0001', 'Brackets', 'quoted', '2026-12-01', 'Target 5 USD', 'Please quote',
       '${SUP_A}', '2026-01-01', '2026-01-05', '${ALICE}'),
      ('${RFQ2}', '${ORG_A}', 'RFQ-0002', '  ', 'draft', NULL, NULL, NULL, NULL, '2026-03-01', '2026-03-01', '${BOB}'),
      ('${RFQ3}', '${ORG_B}', 'RFQ-0001', 'B stuff', 'completed', NULL, NULL, NULL, NULL, '2026-01-01', '2026-02-01', '${OTHER}'),
      ('${RFQ4}', '${ORG_A}', 'RFQ-0003', 'Pins', 'cancelled', NULL, NULL, NULL, NULL, '2026-02-01', '2026-02-02', NULL);
    INSERT INTO rfq_supplier (rfq_id, supplier_id, sent_at) VALUES ('${RFQ1}', '${SUP_A}', '2026-01-02');
    INSERT INTO rfq_item (rfq_id, line_number, file_id, part_number, description, revision, quantity, uom, material, finish, notes, sort_order) VALUES
      ('${RFQ1}', 1, '${P1}', 'PN-X', NULL, 'X', 10, 'each', 'Al 6061', NULL, 'Deburr', 1),
      ('${RFQ1}', 2, NULL, 'BOLT-1', 'M3 bolt', NULL, 0, 'box', NULL, NULL, NULL, 2),
      ('${RFQ1}', 3, '${P1}', NULL, NULL, NULL, 2, NULL, NULL, NULL, NULL, 3),
      ('${RFQ1}', 4, '${NV}', NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, 4),
      ('${RFQ1}', 5, '${D1}', NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, 5),
      ('${RFQ3}', 1, '${PB}', NULL, NULL, NULL, 3, NULL, NULL, NULL, NULL, 1),
      ('${RFQ4}', 1, '${P1}', NULL, NULL, NULL, 4, NULL, NULL, 'Anodized', NULL, 1);
  `
}

beforeAll(async () => {
  db = await bootBaseline()
  await actAsOwner(db)
  for (const m of BEFORE) await db.exec(readSql(resolve(MIGRATIONS, m)))
  await seed(db, seedSql())
  await actAsOwner(db)
  await db.exec(readSql(resolve(MIGRATIONS, MIGRATION)))
  freshSnap = await snapshot(db)
}, 300_000)

afterAll(async () => {
  await db?.close()
})

// ---------------------------------------------------------------------------
// The migration
// ---------------------------------------------------------------------------

describe('supabase/migrations/0515_orders_followups.sql', () => {
  it('follows the runner contract and stamps 515', async () => {
    const sql = readSql(resolve(MIGRATIONS, MIGRATION))
    expect(sql).not.toMatch(/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/im)
    expect(sql).not.toMatch(/^-- blueplm:no-transaction/)
    expect(sql).toContain('LANGUAGE sql IMMUTABLE AS $$ SELECT 515 $$;')
    await actAsOwner(db)
    const r = await db.query<{ v: { stamped: boolean; version: number; problems: unknown[] } }>(
      'SELECT verify_and_stamp_schema() AS v',
    )
    expect(r.rows[0].v.problems).toEqual([])
    expect(r.rows[0].v).toMatchObject({ stamped: true, version: 515 })
  }, 600_000)

  it('follows the naming rules', () => {
    const inv = inventory([{ file: MIGRATION, text: readSql(resolve(MIGRATIONS, MIGRATION)) }])
    expect(inv.tables.has('version_output_request')).toBe(true)
    expect(checkNaming(inv).map((v) => `${v.kind} ${v.name}: ${v.rule}`)).toEqual([])
  })

  it('leaves the shared functions to the migrations before it', () => {
    const sql = readSql(resolve(MIGRATIONS, MIGRATION))
    for (const fn of ['can_read_vault_object', 'check_release_residue', 'backup_list_org_rows']) {
      expect(sql).not.toMatch(new RegExp(`CREATE OR REPLACE FUNCTION ${fn}\\(`))
    }
  })

  it('registers every function it defines in the manifest', async () => {
    const sql = readSql(resolve(MIGRATIONS, MIGRATION))
    const defined = [...sql.matchAll(/CREATE OR REPLACE FUNCTION (\w+)\(/g)]
      .map((m) => m[1])
      .filter((n) => !n.startsWith('schema_release_'))
      .sort()
    const listed = (
      await rows<{ name: string }>(null, `SELECT split_part(name, '(', 1) AS name FROM schema_manifest_entry WHERE since_version = 515 AND kind = 'function'`)
    )
      .map((r) => r.name)
      .sort()
    expect(listed).toEqual(defined)
  })

  it('gives clients SELECT only, anon nothing, publishes the table, and keeps helpers private', async () => {
    const t = (
      await rows<{ anon: boolean; sel: boolean; ins: boolean; upd: boolean; del: boolean; pub: boolean }>(
        null,
        `SELECT has_table_privilege('anon', 'version_output_request', 'SELECT') AS anon,
                has_table_privilege('authenticated', 'version_output_request', 'SELECT') AS sel,
                has_table_privilege('authenticated', 'version_output_request', 'INSERT') AS ins,
                has_table_privilege('authenticated', 'version_output_request', 'UPDATE') AS upd,
                has_table_privilege('authenticated', 'version_output_request', 'DELETE') AS del,
                EXISTS (SELECT 1 FROM pg_publication_tables p WHERE p.pubname = 'supabase_realtime'
                         AND p.tablename = 'version_output_request') AS pub`,
      )
    )[0]
    expect(t).toEqual({ anon: false, sel: true, ins: false, upd: false, del: false, pub: true })
    const fns = await rows<{ sig: string; anon: boolean; auth: boolean }>(
      null,
      `SELECT p.oid::regprocedure::text AS sig, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth
         FROM pg_proc p
        WHERE p.pronamespace = 'public'::regnamespace
          AND p.proname IN ('version_output_request_create', 'version_output_request_claim', 'version_output_request_finish',
                            'version_output_request_cancel', 'supply_order_count_hidden_lines', 'has_version_output',
                            'trg_output_request_complete', 'trg_file_version_release_closure_guard',
                            'version_output_request_touch', 'version_output_request_release')
        ORDER BY 1`,
    )
    expect(fns.filter((f) => f.auth).map((f) => f.sig)).toEqual([
      'supply_order_count_hidden_lines(uuid)',
      'version_output_request_cancel(uuid[])',
      'version_output_request_claim(integer)',
      'version_output_request_create(jsonb)',
      'version_output_request_finish(uuid,text,text)',
      'version_output_request_release(uuid)',
      'version_output_request_touch(uuid)',
    ])
    for (const f of fns) expect(f.anon).toBe(false)
  })
})

describe('a 4.10 database upgraded through 0500, 0501-0513 and 0515', () => {
  let upgraded: PGlite

  beforeAll(async () => {
    upgraded = await bootLegacy()
    await actAsOwner(upgraded)
    for (const m of ['0500_from_4x.sql', ...BEFORE, MIGRATION]) {
      await upgraded.exec('BEGIN')
      try {
        await upgraded.exec(readSql(resolve(MIGRATIONS, m)))
        await upgraded.exec('COMMIT')
      } catch (e) {
        await upgraded.exec('ROLLBACK')
        throw new Error(`${m}: ${(e as Error).message}`)
      }
    }
  }, 600_000)

  afterAll(async () => {
    await upgraded?.close()
  })

  it('is identical to a fresh baseline with the same migrations', async () => {
    expect(compareSnapshots(freshSnap, await snapshot(upgraded))).toEqual([])
  }, 120_000)

  it('imports nothing when there are no RFQs', async () => {
    const r = await upgraded.query<{ n: number }>('SELECT count(*)::int AS n FROM supply_order')
    expect(r.rows[0].n).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// RFQ import
// ---------------------------------------------------------------------------

describe('RFQs become quote orders', () => {
  interface Imported {
    id: string
    org_id: string
    sequence: number
    order_number: string
    title: string
    purpose: string
    status: string
    supplier_id: string | null
    supplier_name: string | null
    due_date: string | null
    notes: string | null
    line_count: number
    created_by: string | null
    created_at: Date
    sent_at: Date | null
    closed_at: Date | null
    cancelled_at: Date | null
    imported_from_rfq_id: string
  }
  interface Line {
    position: number
    vault_id: string
    file_id: string | null
    file_version_id: string | null
    quantity: number
    output_kinds: string[]
    notes: string | null
    file_name: string
    part_number: string | null
    description: string | null
    revision: string | null
    version: number | null
    sent_outputs: unknown
    missing_kinds: string[] | null
  }
  const imported = async () =>
    rows<Imported>(null, `SELECT * FROM supply_order WHERE imported_from_rfq_id IS NOT NULL ORDER BY org_id, sequence`)
  const linesOf = async (rfq: string) =>
    rows<Line>(
      null,
      `SELECT l.* FROM supply_order_line l JOIN supply_order o ON o.id = l.order_id
        WHERE o.imported_from_rfq_id = $1 ORDER BY l.position`,
      [rfq],
    )

  it('makes one numbered quote order per RFQ, oldest first per organization', async () => {
    const orders = await imported()
    expect(orders.map((o) => [o.imported_from_rfq_id, o.order_number, o.purpose, o.status])).toEqual([
      [RFQ1, 'ORD-0001', 'quote', 'sent'],
      [RFQ4, 'ORD-0002', 'quote', 'cancelled'],
      [RFQ2, 'ORD-0003', 'quote', 'draft'],
      [RFQ3, 'ORD-0001', 'quote', 'closed'],
    ])
    const [q1, q4, q2, q3] = orders
    expect(q1).toMatchObject({
      title: 'RFQ-0001 Brackets',
      supplier_id: SUP_A,
      supplier_name: 'Acme',
      notes: 'Please quote',
      created_by: ALICE,
      line_count: 5,
    })
    expect(String(q1.due_date)).toMatch(/2026-12-01|Dec 01 2026|Tue Dec 01 2026/)
    expect(q1.created_at.toISOString()).toBe('2026-01-01T00:00:00.000Z')
    expect(q1.sent_at?.toISOString()).toBe('2026-01-02T00:00:00.000Z')
    expect(q2).toMatchObject({ title: 'RFQ-0002', line_count: 0, sent_at: null, notes: null })
    expect(q3.closed_at?.toISOString()).toBe('2026-02-01T00:00:00.000Z')
    expect(q4.cancelled_at?.toISOString()).toBe('2026-02-02T00:00:00.000Z')
    expect(q4.created_by).toBeNull()
    // The internal notes stay on the RFQ (an order's notes go to the supplier).
    expect(JSON.stringify(orders)).not.toContain('Target 5 USD')
  })

  it("pins each item to its file's newest version, snapshot from the item", async () => {
    const lines = await linesOf(RFQ1)
    expect(lines.map((l) => [l.position, l.file_id, l.file_version_id, l.vault_id, l.file_name, l.version])).toEqual([
      [1, P1, P1V2, VA1, 'bracket.sldprt', 2],
      [2, null, null, VA1, 'BOLT-1', null], // no file: the vault of the RFQ's first file item
      [3, null, null, VA1, 'bracket.sldprt', null], // a second item of the same file: snapshot only
      [4, null, null, VA1, 'novers.sldprt', null], // a file with no version: snapshot only
      [5, D1, D1V1, VA1, 'bracket.slddrw', 1],
    ])
    expect(lines[0]).toMatchObject({ part_number: 'PN-X', revision: 'X', quantity: 10, notes: 'Deburr\nMaterial: Al 6061' })
    expect(lines[1]).toMatchObject({ part_number: 'BOLT-1', description: 'M3 bolt', quantity: 1, notes: 'Unit: box' })
    expect(lines[4]).toMatchObject({ part_number: 'PN-3', description: 'Desc 3', revision: 'A' })
    // Sent: BluePLM has no record of what went out.
    for (const l of lines) expect(l).toMatchObject({ output_kinds: [], sent_outputs: [], missing_kinds: [] })
  })

  it('gives a draft or cancelled order the default kinds, and another organization its own vaults', async () => {
    const pins = await linesOf(RFQ4)
    expect(pins).toHaveLength(1)
    expect(pins[0]).toMatchObject({ file_id: P1, file_version_id: P1V2, output_kinds: ['step'], sent_outputs: null, notes: 'Finish: Anodized', quantity: 4 })
    const b = await linesOf(RFQ3)
    expect(b.map((l) => [l.file_id, l.vault_id, l.output_kinds])).toEqual([[PB, VB, []]])
  })

  it('is idempotent, and numbering carries on from the imported orders', async () => {
    const sql = readSql(resolve(MIGRATIONS, MIGRATION))
    const block = sql.match(/-- BEGIN RFQ IMPORT\n([\s\S]*?)-- END RFQ IMPORT/)
    expect(block).not.toBeNull()
    await actAsOwner(db)
    await db.exec(block![1])
    expect(await imported()).toHaveLength(4)
    const r = await rpc<{ order: { order_number: string } }>(ALICE, `supply_order_create('After the import')`)
    expect(r.order.order_number).toBe('ORD-0004')
  })
})

// ---------------------------------------------------------------------------
// Output requests
// ---------------------------------------------------------------------------

describe('version_output_request_create()', () => {
  it('requests the kinds a file can have and skips the rest with a reason', async () => {
    const r = await request(CAROL, [
      { file_version_id: P1V1, kind: 'step' },
      { file_version_id: P1V1, kind: 'step', configuration: 'Long' },
      { file_version_id: P1V1, kind: 'iges', configuration: 'Long' }, // iges takes no configuration
      { file_version_id: P1V1, kind: 'step' }, // the same again
      { file_version_id: P1V2, kind: 'step' }, // exists
      { file_version_id: D1V1, kind: 'pdf' }, // exists
      { file_version_id: D1V1, kind: 'dxf' },
      { file_version_id: D1V1, kind: 'step', configuration: 'Long' }, // a drawing's step takes none
      { file_version_id: D1V1, kind: 'stl' }, // a drawing has no stl
      { file_version_id: P1V1, kind: 'pdf' }, // a part has no pdf of its own
      { file_version_id: X1V1, kind: 'step' }, // not a SOLIDWORKS file
      { file_version_id: S1V1, kind: 'step' }, // VA2
      { file_version_id: T1V1, kind: 'step' }, // in the trash
      { file_version_id: PBV1, kind: 'step' }, // another organization
      { file_version_id: MISSING, kind: 'step' },
      { file_version_id: 'not-a-uuid', kind: 'step' },
    ])
    expect(r).toMatchObject({ ok: true, created: 5, existing: 1 })
    expect(r.skipped.map((s) => `${s.file_version_id} ${s.kind} ${s.reason}`)).toEqual([
      `${P1V2} step EXISTS`,
      `${D1V1} pdf EXISTS`,
      `${D1V1} stl BAD_KIND`,
      `${P1V1} pdf BAD_KIND`,
      `${X1V1} step BAD_KIND`,
      `${S1V1} step NO_VAULT_ACCESS`,
      `${T1V1} step NOT_FOUND`,
      `${PBV1} step NOT_FOUND`,
      `${MISSING} step NOT_FOUND`,
      'not-a-uuid step NOT_FOUND',
    ])
    expect(r.requests.map((q) => `${q.file_version_id} ${q.kind} ${q.configuration}`).sort()).toEqual(
      [`${P1V1} step null`, `${P1V1} step Long`, `${P1V1} iges null`, `${D1V1} dxf null`, `${D1V1} step null`].sort(),
    )
    for (const q of r.requests) expect(q).toMatchObject({ status: 'pending', requested_by: CAROL, vault_id: VA1 })
  })

  it('records the order it was made from', async () => {
    const order = await rpc<{ order: { id: string } }>(BOB, `supply_order_create('Context')`)
    const r = await request(BOB, [{ file_version_id: S1V1, kind: 'step', order_id: order.order.id }])
    expect(r.created).toBe(1)
    expect(r.requests[0]).toMatchObject({ order_id: order.order.id, vault_id: VA2 })
  })

  it('refuses a malformed call', async () => {
    const call = (user: string, items: unknown) =>
      refusal(user, 'SELECT version_output_request_create($1::jsonb)', [JSON.stringify(items)])
    expect(await call(ALICE, [{ file_version_id: P1V1, kind: 'png' }])).toBe('BAD_KIND')
    expect(await call(ALICE, [{ file_version_id: P1V1 }])).toBe('BAD_KIND')
    expect(await call(ALICE, [{ file_version_id: P1V1, kind: 'step', extra: 1 }])).toBe('BAD_PATCH')
    expect(await call(ALICE, { file_version_id: P1V1, kind: 'step' })).toBe('BAD_PATCH')
    expect(await call(ALICE, [{ file_version_id: P1V1, kind: 'step', configuration: 7 }])).toBe('BAD_PATCH')
    expect(await call(ALICE, [{ file_version_id: P1V1, kind: 'step', order_id: MISSING }])).toBe('BAD_PATCH')
    expect(await call(ALICE, Array.from({ length: 501 }, () => ({ file_version_id: P1V1, kind: 'step' })))).toBe('BAD_PATCH')
    expect(await call(LONER, [{ file_version_id: P1V1, kind: 'step' }])).toBe('NOT_MEMBER')
    // Nothing was written by the refused calls.
    expect(await openRequest(P1V1, 'step')).toBeDefined()
    expect((await rows(null, `SELECT 1 FROM version_output_request WHERE kind = 'stl'`)).length).toBe(0)
    await actAsOwner(db)
    await db.exec('SET ROLE anon')
    let message = ''
    try {
      await db.query(`SELECT version_output_request_create('[]'::jsonb)`)
    } catch (e) {
      message = (e as Error).message
    }
    await actAsOwner(db)
    expect(message).toMatch(/permission denied/)
  })

  it('is read with the vault and written by nobody but the functions', async () => {
    const seen = async (user: string) =>
      (await rows<{ vault_id: string }>(user, 'SELECT vault_id FROM version_output_request')).map((r) => r.vault_id)
    expect(new Set(await seen(ALICE))).toEqual(new Set([VA1]))
    expect(new Set(await seen(CAROL))).toEqual(new Set([VA1]))
    expect(new Set(await seen(BOB))).toEqual(new Set([VA1, VA2]))
    expect(new Set(await seen(ADMIN))).toEqual(new Set([VA1, VA2]))
    expect(await seen(OTHER)).toEqual([])
    const any = (await openRequest(P1V1, 'step'))!.id
    expect(await refusal(ALICE, `UPDATE version_output_request SET status = 'done' WHERE id = $1`, [any])).toMatch(/permission denied/)
    expect(await refusal(ALICE, `DELETE FROM version_output_request WHERE id = $1`, [any])).toMatch(/permission denied/)
    expect(
      await refusal(
        ALICE,
        `INSERT INTO version_output_request (org_id, vault_id, file_version_id, kind) VALUES ($1, $2, $3, 'stl')`,
        [ORG_A, VA1, P1V1],
      ),
    ).toMatch(/permission denied/)
  })
})

describe('version_output_request_claim() and _finish()', () => {
  it('needs explorer edit', async () => {
    expect(await refusal(CAROL, 'SELECT * FROM version_output_request_claim()')).toBe('NO_EDIT_PERMISSION')
    expect(await refusal(LONER, 'SELECT * FROM version_output_request_claim()')).toBe('NOT_MEMBER')
  })

  it('claims the oldest open requests in readable vaults, and never one twice', async () => {
    const first = await rows<RequestRow>(ALICE, 'SELECT * FROM version_output_request_claim(2)')
    expect(first).toHaveLength(2)
    for (const q of first) expect(q).toMatchObject({ status: 'claimed', claimed_by: ALICE, vault_id: VA1 })
    const rest = await rows<RequestRow>(ALICE, 'SELECT * FROM version_output_request_claim(50)')
    expect(rest).toHaveLength(3)
    expect(rest.map((q) => q.vault_id)).toEqual([VA1, VA1, VA1])
    expect(new Set([...first, ...rest].map((q) => q.id)).size).toBe(5)
    expect(await rows(ALICE, 'SELECT * FROM version_output_request_claim(50)')).toEqual([])
    // Bob reads VA2 too: he gets the VA2 request, and nothing claimed recently.
    const bob = await rows<RequestRow>(BOB, 'SELECT * FROM version_output_request_claim(50)')
    expect(bob.map((q) => [q.file_version_id, q.claimed_by])).toEqual([[S1V1, BOB]])
  })

  it('takes over a claim older than 15 minutes', async () => {
    const stale = (await openRequest(D1V1, 'step'))!
    expect(stale.claimed_by).toBe(ALICE)
    await actAsOwner(db)
    await db.query(`UPDATE version_output_request SET claimed_at = NOW() - INTERVAL '16 minutes' WHERE id = $1`, [stale.id])
    const bob = await rows<RequestRow>(BOB, 'SELECT * FROM version_output_request_claim(50)')
    expect(bob.map((q) => [q.id, q.claimed_by])).toEqual([[stale.id, BOB]])
    // The first claimer can no longer finish it.
    expect(await refusal(ALICE, `SELECT version_output_request_finish($1, 'failed', 'x')`, [stale.id])).toBe('NOT_CLAIMER')
    expect(await refusal(CAROL, `SELECT version_output_request_finish($1, 'failed')`, [stale.id])).toBe('NOT_CLAIMER')
    const r = await rpc<{ changed: boolean; request: RequestRow }>(BOB, `version_output_request_finish($1, 'failed', '  boom  ')`, [stale.id])
    expect(r).toMatchObject({ changed: true, request: { status: 'failed', error: 'boom' } })
    expect((await requestRow(stale.id)).finished_at).not.toBeNull()
    // Finishing again changes nothing.
    expect(await rpc(BOB, `version_output_request_finish($1, 'done')`, [stale.id])).toMatchObject({ changed: false })
  })

  it('finishes done only once the output is recorded, and refuses a bad call', async () => {
    const q = (await openRequest(P1V1, 'iges'))!
    expect(q.claimed_by).toBe(ALICE)
    expect(await refusal(ALICE, `SELECT version_output_request_finish($1, 'done')`, [q.id])).toBe('NO_OUTPUT')
    expect(await refusal(ALICE, `SELECT version_output_request_finish($1, 'claimed')`, [q.id])).toBe('BAD_STATUS')
    expect(await refusal(ALICE, `SELECT version_output_request_finish($1, 'done')`, [MISSING])).toBe('NOT_FOUND')
    expect(await refusal(OTHER, `SELECT version_output_request_finish($1, 'done')`, [q.id])).toBe('NOT_FOUND')
  })

  it('is done as soon as the matching output or drawing PDF is recorded', async () => {
    const step = (await openRequest(P1V1, 'step', 'Long'))!
    await actAsOwner(db)
    await db.query(
      `INSERT INTO file_version_output (org_id, file_id, file_version_id, kind, configuration, storage_hash, file_size, file_name)
       VALUES ($1, $2, $3, 'step', 'Long', $4, 10, 'bracket-Long.step')`,
      [ORG_A, P1, P1V1, hash(200)],
    )
    expect(await requestRow(step.id)).toMatchObject({ status: 'done' })
    expect(await openRequest(P1V1, 'step')).toBeDefined() // the saved configuration is another output
    expect(await rpc(step.claimed_by!, `version_output_request_finish($1, 'done')`, [step.id])).toMatchObject({ changed: false })

    const pdf = await request(ALICE, [{ file_version_id: D2V1, kind: 'pdf' }])
    expect(pdf.created).toBe(1)
    await actAsOwner(db)
    await db.query(`INSERT INTO drawing_pdf_render (org_id, file_id, file_version_id, storage_hash, file_size) VALUES ($1, $2, $3, $4, 10)`, [
      ORG_A,
      D2,
      D2V1,
      hash(201),
    ])
    expect(await requestRow(pdf.requests[0].id)).toMatchObject({ status: 'done' })
    expect((await request(ALICE, [{ file_version_id: D2V1, kind: 'pdf' }])).skipped[0].reason).toBe('EXISTS')

    // A claimer that recorded the output can say done.
    const dxf = (await openRequest(D1V1, 'dxf'))!
    await actAsOwner(db)
    await db.query(`UPDATE version_output_request SET status = 'pending', claimed_by = NULL, claimed_at = NULL WHERE id = $1`, [dxf.id])
    expect((await rows<RequestRow>(BOB, 'SELECT * FROM version_output_request_claim(1)'))[0].id).toBe(dxf.id)
    await actAsOwner(db)
    await db.exec('ALTER TABLE file_version_output DISABLE TRIGGER trg_file_version_output_complete_request')
    await db.query(
      `INSERT INTO file_version_output (org_id, file_id, file_version_id, kind, configuration, storage_hash, file_size, file_name)
       VALUES ($1, $2, $3, 'dxf', NULL, $4, 10, 'bracket.dxf')`,
      [ORG_A, D1, D1V1, hash(202)],
    )
    await db.exec('ALTER TABLE file_version_output ENABLE TRIGGER trg_file_version_output_complete_request')
    expect(await rpc(BOB, `version_output_request_finish($1, 'done')`, [dxf.id])).toMatchObject({ changed: true, request: { status: 'done' } })
  })

  it('lets a failed output be requested again', async () => {
    const failed = await rows<RequestRow>(null, `SELECT * FROM version_output_request WHERE status = 'failed'`)
    expect(failed).toHaveLength(1)
    const again = await request(CAROL, [{ file_version_id: failed[0].file_version_id, kind: failed[0].kind, configuration: failed[0].configuration }])
    expect(again.created).toBe(1)
  })
})

describe('version_output_request_cancel()', () => {
  it('cancels the requester\'s own open requests, or any for an administrator', async () => {
    const mine = (await openRequest(P1V1, 'iges'))!
    expect(mine.requested_by).toBe(CAROL)
    const bobs = (await rows<RequestRow>(null, `SELECT * FROM version_output_request WHERE file_version_id = $1`, [S1V1]))[0]
    expect(bobs.requested_by).toBe(BOB)
    expect(await rpc(ALICE, 'version_output_request_cancel($1::uuid[])', [[mine.id]])).toMatchObject({ cancelled: 0 })
    expect(await rpc(CAROL, 'version_output_request_cancel($1::uuid[])', [[mine.id, bobs.id]])).toMatchObject({ cancelled: 1 })
    expect(await requestRow(mine.id)).toMatchObject({ status: 'cancelled' })
    expect(await rpc(OTHER, 'version_output_request_cancel($1::uuid[])', [[bobs.id]])).toMatchObject({ cancelled: 0 })
    expect(await rpc(ADMIN, 'version_output_request_cancel($1::uuid[])', [[bobs.id]])).toMatchObject({ cancelled: 1 })
    // A finished request stays finished.
    expect(await rpc(ADMIN, 'version_output_request_cancel($1::uuid[])', [[bobs.id]])).toMatchObject({ cancelled: 0 })
  })

  it('prunes finished requests after 30 days', async () => {
    const done = (await rows<RequestRow>(null, `SELECT * FROM version_output_request WHERE status = 'cancelled'`)).map((r) => r.id)
    await actAsOwner(db)
    await db.query(`UPDATE version_output_request SET finished_at = NOW() - INTERVAL '31 days' WHERE id = $1`, [done[0]])
    await request(ALICE, [])
    expect(await rows(null, 'SELECT 1 FROM version_output_request WHERE id = $1', [done[0]])).toEqual([])
    expect((await rows(null, 'SELECT 1 FROM version_output_request WHERE id = $1', [done[1]])).length).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Hidden lines
// ---------------------------------------------------------------------------

describe('version_output_request_touch(), _release() and attempts', () => {
  let q: RequestRow & { attempts: number }
  const claim = async (user: string, limit = 1) =>
    rows<RequestRow & { attempts: number }>(user, 'SELECT * FROM version_output_request_claim($1)', [limit])

  it('claims one at a time and keeps a working claim fresh', async () => {
    const got = await claim(ALICE)
    expect(got).toHaveLength(1)
    q = got[0]
    expect(q).toMatchObject({ file_version_id: D1V1, kind: 'step', status: 'claimed', claimed_by: ALICE, attempts: 1 })
    await actAsOwner(db)
    await db.query(`UPDATE version_output_request SET claimed_at = NOW() - INTERVAL '16 minutes' WHERE id = $1`, [q.id])
    expect(await rpc(ALICE, 'version_output_request_touch($1)', [q.id])).toMatchObject({ changed: true, request: { status: 'claimed' } })
    const fresh = await rows<{ age: number }>(null, `SELECT extract(epoch FROM NOW() - claimed_at)::int AS age FROM version_output_request WHERE id = $1`, [q.id])
    expect(fresh[0].age).toBeLessThan(60)
    expect((await claim(BOB, 50)).map((r) => r.id)).not.toContain(q.id)
    expect(await refusal(BOB, 'SELECT version_output_request_touch($1)', [q.id])).toBe('NOT_CLAIMER')
    expect(await refusal(ALICE, 'SELECT version_output_request_touch($1)', [MISSING])).toBe('NOT_FOUND')
    expect(await refusal(OTHER, 'SELECT version_output_request_touch($1)', [q.id])).toBe('NOT_FOUND')
  })

  it('hands a claim back to pending, keeps the attempts, and fails a fourth claim', async () => {
    expect(await refusal(BOB, 'SELECT version_output_request_release($1)', [q.id])).toBe('NOT_CLAIMER')
    for (const n of [2, 3]) {
      const r = await rpc<{ changed: boolean; request: RequestRow & { attempts: number } }>(ALICE, 'version_output_request_release($1)', [q.id])
      expect(r).toMatchObject({ changed: true, request: { status: 'pending', claimed_by: null, claimed_at: null, attempts: n - 1 } })
      const again = await claim(ALICE)
      expect(again.map((x) => [x.id, x.attempts])).toEqual([[q.id, n]])
    }
    await rpc(ALICE, 'version_output_request_release($1)', [q.id])
    expect(await claim(ALICE, 50)).toEqual([])
    expect(await requestRow(q.id)).toMatchObject({ status: 'failed', error: 'TOO_MANY_ATTEMPTS' })
    expect((await requestRow(q.id)).finished_at).not.toBeNull()
  })

  it('fails a stale claim that used its attempts instead of handing it out', async () => {
    const r = await request(ALICE, [{ file_version_id: P1V1, kind: 'stl', configuration: 'Short' }])
    const id = r.requests[0].id
    await actAsOwner(db)
    await db.query(
      `UPDATE version_output_request SET status = 'claimed', claimed_by = $2, claimed_at = NOW() - INTERVAL '16 minutes', attempts = 3 WHERE id = $1`,
      [id, BOB],
    )
    expect(await claim(ALICE, 50)).toEqual([])
    expect(await requestRow(id)).toMatchObject({ status: 'failed', error: 'TOO_MANY_ATTEMPTS', attempts: 3 })
    // Its former claimer finds it finished.
    expect(await rpc(BOB, 'version_output_request_release($1)', [id])).toMatchObject({ changed: false })
    expect(await rpc(BOB, 'version_output_request_touch($1)', [id])).toMatchObject({ changed: false })
  })
})

describe('supply_order_count_hidden_lines()', () => {
  let orderId = ''

  beforeAll(async () => {
    const order = await rpc<{ order: { id: string } }>(BOB, `supply_order_create('Mixed vaults')`)
    orderId = order.order.id
    const added = await rpc<{ added: number }>(BOB, 'supply_order_add_lines($1, $2::jsonb)', [
      orderId,
      JSON.stringify([
        { file_version_id: P1V1 },
        { file_version_id: S1V1 },
        { file_version_id: P1V2, configuration: 'X', drawing_version_id: SDV1 },
      ]),
    ])
    expect(added.added).toBe(3)
    // A line of a vault that was deleted since.
    await actAsOwner(db)
    await db.query(
      `INSERT INTO supply_order_line (order_id, org_id, position, vault_id, file_name) VALUES ($1, $2, 9, $3, 'gone.sldprt')`,
      [orderId, ORG_A, MISSING],
    )
  })

  it('counts per vault the lines the caller cannot read, with the vault name', async () => {
    const summary = (user: string) => rpc(user, 'supply_order_count_hidden_lines($1)', [orderId])
    const gone = { vault_id: MISSING, vault_name: null, count: 1 }
    expect(await summary(ALICE)).toEqual([{ vault_id: VA2, vault_name: 'A2', count: 2 }, gone])
    expect(await summary(CAROL)).toEqual([{ vault_id: VA2, vault_name: 'A2', count: 2 }, gone])
    expect(await summary(BOB)).toEqual([gone])
    expect(await summary(ADMIN)).toEqual([gone])
  })

  it('refuses another organization, someone outside one, and a member without the orders module', async () => {
    expect(await refusal(OTHER, 'SELECT supply_order_count_hidden_lines($1)', [orderId])).toBe('NOT_FOUND')
    expect(await refusal(ALICE, 'SELECT supply_order_count_hidden_lines($1)', [MISSING])).toBe('NOT_FOUND')
    expect(await refusal(LONER, 'SELECT supply_order_count_hidden_lines($1)', [orderId])).toBe('NOT_MEMBER')
    await actAsOwner(db)
    await db.query(`INSERT INTO module_access (org_id, module_id, user_id) VALUES ($1, 'orders', $2)`, [ORG_A, ALICE])
    try {
      expect(await refusal(DAVE, 'SELECT supply_order_count_hidden_lines($1)', [orderId])).toBe('NO_MODULE_ACCESS')
    } finally {
      await actAsOwner(db)
      await db.query(`DELETE FROM module_access WHERE org_id = $1 AND module_id = 'orders'`, [ORG_A])
    }
  })
})

// ---------------------------------------------------------------------------
// A released version's references are kept
// ---------------------------------------------------------------------------

describe('trg_file_version_release_closure_guard', () => {
  const exists = async (id: string) => (await rows(null, 'SELECT 1 FROM file_version WHERE id = $1', [id])).length === 1

  it('refuses deleting a version a release references, directly or further down', async () => {
    expect(await refusal(ALICE, 'DELETE FROM file_version WHERE id = $1', [SUBV1])).toBe('REFERENCED_BY_RELEASE')
    expect(await refusal(ALICE, 'DELETE FROM file_version WHERE id = $1', [PRTV1])).toBe('REFERENCED_BY_RELEASE')
    expect(await refusal(null, 'DELETE FROM file_version WHERE id = $1', [PRTV1])).toBe('REFERENCED_BY_RELEASE')
    expect(await exists(PRTV1)).toBe(true)
  })

  it('refuses purging the file, but deletes a version only an unreleased version references', async () => {
    expect(await refusal(ADMIN, 'DELETE FROM file WHERE id = $1', [PRT])).toBe('REFERENCED_BY_RELEASE')
    expect(await refusal(ADMIN, 'DELETE FROM file WHERE id = $1', [SUB])).toBe('REFERENCED_BY_RELEASE')
    expect(await exists(PRTV2)).toBe(true)
    expect(await refusal(ALICE, 'DELETE FROM file_version WHERE id = $1', [PRTV2])).toBeNull()
    expect(await exists(PRTV2)).toBe(false)
  })

  it('refuses deleting a vault whose versions a release in another vault references', async () => {
    expect(await refusal(null, 'DELETE FROM vault WHERE id = $1', [VA2])).toBe('REFERENCED_BY_RELEASE')
    expect(await exists(XQV1)).toBe(true)
  })

  it('lets a vault or organization go together with the release that references it', async () => {
    expect(await refusal(null, 'DELETE FROM vault WHERE id = $1', [VA3])).toBeNull()
    expect(await exists(V3PV1)).toBe(false)
    // Deleting an organization with files or vaults fails today on 0502's realtime tombstones
    // (they insert a row naming the organization being deleted), whatever this guard says; with
    // those triggers off, the guard lets the organization's release and references go together.
    expect(await refusal(null, 'DELETE FROM organization WHERE id = $1', [ORG_C])).toMatch(/realtime_tombstone_org_id_fkey/)
    await actAsOwner(db)
    await db.exec(`ALTER TABLE file DISABLE TRIGGER trg_file_realtime_tombstone;
                   ALTER TABLE vault DISABLE TRIGGER trg_vault_realtime_tombstone;`)
    try {
      expect(await refusal(null, 'DELETE FROM organization WHERE id = $1', [ORG_C])).toBeNull()
    } finally {
      await actAsOwner(db)
      await db.exec(`ALTER TABLE file ENABLE TRIGGER trg_file_realtime_tombstone;
                     ALTER TABLE vault ENABLE TRIGGER trg_vault_realtime_tombstone;`)
    }
    expect(await exists(CPV1)).toBe(false)
  })

  it('names a release only to a caller who can read its vault', async () => {
    const alice = await refusalOf(ALICE, 'DELETE FROM file_version WHERE id = $1', [RPV1])
    expect(alice?.hint).toBe('REFERENCED_BY_RELEASE')
    expect(alice?.message).toContain('shared.sldprt')
    expect(alice?.message).not.toContain('hidden-top')
    const bob = await refusalOf(BOB, 'DELETE FROM file_version WHERE id = $1', [RPV1])
    expect(bob?.hint).toBe('REFERENCED_BY_RELEASE')
    expect(bob?.message).toContain('hidden-top.sldasm')
    const admin = await refusalOf(ADMIN, 'DELETE FROM file WHERE id = $1', [RP])
    expect(admin?.message).toContain('hidden-top.sldasm')
  })

  it('stops protecting once the released file is in the trash, as 0509 does for the release itself', async () => {
    await actAsOwner(db)
    await db.query('UPDATE file SET deleted_at = NOW() WHERE id = $1', [ASM])
    expect(await refusal(ALICE, 'DELETE FROM file_version WHERE id = $1', [PRTV1])).toBeNull()
    expect(await refusal(ADMIN, 'DELETE FROM file WHERE id = $1', [SUB])).toBeNull()
    expect(await exists(SUBV1)).toBe(false)
  })
})
