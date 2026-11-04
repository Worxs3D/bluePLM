/**
 * supabase/migrations/0513_supply_orders.sql on real Postgres (PGlite), applied after 0501-0512 to
 * the 5.0 baseline as the migration runner applies them: it stamps 513, and a 4.10 database
 * upgraded through 0500 and the same migrations ends up identical. Orders are written only through
 * the supply_order_* functions (members with the orders module; pinning needs the file's vault);
 * lines are read only with their vaults while line_count counts them all; lines change in draft
 * only; transitions follow the contract; sending records the outputs from the real output rows
 * (MISSING_OUTPUTS otherwise) and keeps them downloadable; duplicate skips lines the caller cannot
 * read; delete is for draft or cancelled orders, by the creator or an administrator. Server
 * backups export both tables.
 *
 * Numbering under concurrency: PGlite has one connection, so two transactions cannot race here.
 * What is checked is the mechanism: numbers follow the organization's sequence under
 * pg_advisory_xact_lock (pinned by the release manifest) and UNIQUE (org_id, sequence) refuses a
 * second row with the same number.
 */
import type { PGlite } from '@electric-sql/pglite'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { BACKUP_TABLES } from '../../../api/src/backup/source'
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
const ADMIN = '00000000-0000-0000-0000-000000000001'
const ALICE = '00000000-0000-0000-0000-000000000002' // vault VA1
const BOB = '00000000-0000-0000-0000-000000000003' // vaults VA1 and VA2
const CAROL = '00000000-0000-0000-0000-000000000004' // no vault
const DAVE = '00000000-0000-0000-0000-000000000005' // vault VA1; left out when the module is restricted
const OTHER = '00000000-0000-0000-0000-000000000006' // admin of org B
const LONER = '00000000-0000-0000-0000-000000000007' // signed in, no organization
const VA1 = '40000000-0000-0000-0000-000000000001'
const VA2 = '40000000-0000-0000-0000-000000000002'
const VB = '40000000-0000-0000-0000-000000000003'
const P1 = '50000000-0000-0000-0000-000000000001' // bracket.sldprt, VA1
const D1 = '50000000-0000-0000-0000-000000000002' // bracket.slddrw, VA1
const A1 = '50000000-0000-0000-0000-000000000003' // frame.sldasm, VA1
const P3 = '50000000-0000-0000-0000-000000000004' // spacer.sldprt, VA1 (purged later)
const S1 = '50000000-0000-0000-0000-000000000005' // secret.sldprt, VA2
const SD = '50000000-0000-0000-0000-000000000006' // secret.slddrw, VA2
const PB = '50000000-0000-0000-0000-000000000007' // org B
const SD2 = '50000000-0000-0000-0000-000000000008' // other.slddrw, VA2
const P1V1 = '51000000-0000-0000-0000-000000000001'
const P1V2 = '51000000-0000-0000-0000-000000000002'
const D1V1 = '51000000-0000-0000-0000-000000000003'
const A1V1 = '51000000-0000-0000-0000-000000000004'
const P3V1 = '51000000-0000-0000-0000-000000000005'
const S1V1 = '51000000-0000-0000-0000-000000000006'
const SDV1 = '51000000-0000-0000-0000-000000000007'
const PBV1 = '51000000-0000-0000-0000-000000000008'
const SD2V1 = '51000000-0000-0000-0000-000000000009'
const SUP_A = '60000000-0000-0000-0000-000000000001'
const SUP_B = '60000000-0000-0000-0000-000000000002'
const MISSING = '7fffffff-0000-0000-0000-000000000000'
const H_P1V1 = '1'.repeat(64)
const H_P1V2 = '2'.repeat(64)
const H_D1 = '3'.repeat(64)
const H_A1 = '4'.repeat(64)
const H_P3 = '5'.repeat(64)
const H_S1 = '6'.repeat(64)
const H_SD = '7'.repeat(64)
const H_PB = '8'.repeat(64)
const H_STEP = 'a'.repeat(64) // P1 v2 STEP (active configuration)
const H_STL = 'b'.repeat(64) // P1 v2 STL, configuration Long
const H_PDF = 'c'.repeat(64) // D1 v1 drawing PDF
const H_DXF = 'd'.repeat(64) // D1 v1 DXF
const H_DSTEP = 'e'.repeat(64) // D1 v1 STEP (the model its views show)
const H_IGES = 'f'.repeat(64) // P1 v2 IGES (saved configuration only)
const H_SDPDF = '0'.repeat(64) // SD v1 drawing PDF (added late)

const MIGRATION = '0513_supply_orders.sql'
const MIGRATION_FILES = [
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
  MIGRATION,
]

type Json = Record<string, unknown>
interface OrderRow {
  id: string
  order_number: string
  sequence: number
  status: string
  title: string
  supplier_name: string | null
  line_count: number
  [key: string]: unknown
}
interface LineRow {
  id: string
  file_id: string | null
  file_version_id: string | null
  configuration: string | null
  quantity: number
  output_kinds: string[]
  version: number | null
  revision: string | null
  drawing_version_id: string | null
  drawing_file_name: string | null
  drawing_version: number | null
  sent_outputs: Array<{ kind: string; storage_hash: string; file_size: number; file_name: string }> | null
  missing_kinds: string[] | null
  [key: string]: unknown
}

let db: PGlite
let freshSnap: Snapshot

const objectName = (hash: string) => `${ORG_A}/${hash.slice(0, 2)}/${hash}`

/** Run one SQL expression as a user and return its value. */
async function rpc<T = Json>(user: string, expr: string, params: unknown[] = []): Promise<T> {
  await actAs(db, user)
  const r = await db.query<{ r: T }>(`SELECT ${expr} AS r`, params)
  return r.rows[0].r
}

/** The refusal's HINT (else its message), or null when the statement succeeded. */
async function refusal(user: string, sql: string, params: unknown[] = []): Promise<string | null> {
  await actAs(db, user)
  try {
    await db.query(sql, params)
    return null
  } catch (e) {
    const err = e as { hint?: string; message?: string }
    return err.hint ?? err.message ?? String(e)
  }
}

async function failure(user: string, sql: string, params: unknown[] = []): Promise<{ hint?: string; detail?: string }> {
  await actAs(db, user)
  try {
    await db.query(sql, params)
  } catch (e) {
    return e as { hint?: string; detail?: string }
  }
  throw new Error('expected a refusal')
}

async function count(user: string | null, sql: string, params: unknown[] = []): Promise<number> {
  if (user) await actAs(db, user)
  else await actAsOwner(db)
  const r = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM (${sql}) x`, params)
  return r.rows[0].n
}

async function createOrder(user: string, title: string): Promise<OrderRow> {
  const r = await rpc<{ ok: boolean; order: OrderRow }>(user, 'supply_order_create($1)', [title])
  expect(r.ok).toBe(true)
  return r.order
}

async function addLines(user: string, orderId: string, lines: Json[]) {
  return rpc<{ ok: boolean; added: number; updated: number; skipped: Array<{ file_version_id: unknown; reason: string }> }>(
    user,
    'supply_order_add_lines($1, $2::jsonb)',
    [orderId, JSON.stringify(lines)],
  )
}

async function order(id: string): Promise<OrderRow> {
  await actAsOwner(db)
  const r = await db.query<OrderRow>('SELECT * FROM supply_order WHERE id = $1', [id])
  return r.rows[0]
}

async function lines(orderId: string): Promise<LineRow[]> {
  await actAsOwner(db)
  const r = await db.query<LineRow>('SELECT * FROM supply_order_line WHERE order_id = $1 ORDER BY position', [orderId])
  return r.rows
}

async function lineOf(orderId: string, fileId: string, configuration: string | null = null): Promise<LineRow> {
  const found = (await lines(orderId)).find((l) => l.file_id === fileId && l.configuration === configuration)
  if (!found) throw new Error(`no line for ${fileId} ${configuration}`)
  return found
}

beforeAll(async () => {
  db = await bootBaseline()
  await actAsOwner(db)
  for (const m of MIGRATION_FILES) await db.exec(readSql(resolve(MIGRATIONS, m)))
  freshSnap = await snapshot(db)
  const user = (id: string, email: string, org: string | null, role: string) =>
    `('${id}', '${email}', ${org ? `'${org}'` : 'NULL'}, '${role}')`
  const file = (id: string, vault: string, path: string, ext: string, hash: string, org = ORG_A) =>
    `('${id}', '${org}', '${vault}', '${path}', '${path.split('/').pop()}', '${ext}', '${hash}', 1, '${ADMIN}')`
  const version = (id: string, fileId: string, n: number, rev: string, hash: string, pn: string) =>
    `('${id}', '${fileId}', ${n}, '${rev}', '${hash}', ${100 + n}, '${pn}', 'Desc ${pn}', '${ADMIN}')`
  await seed(
    db,
    `
    INSERT INTO organization (id, name, slug) VALUES ('${ORG_A}', 'A', 'org-a'), ('${ORG_B}', 'B', 'org-b');
    INSERT INTO app_user (id, email, org_id, role) VALUES
      ${user(ADMIN, 'admin@a.test', ORG_A, 'admin')},
      ${user(ALICE, 'alice@a.test', ORG_A, 'engineer')},
      ${user(BOB, 'bob@a.test', ORG_A, 'engineer')},
      ${user(CAROL, 'carol@a.test', ORG_A, 'engineer')},
      ${user(DAVE, 'dave@a.test', ORG_A, 'engineer')},
      ${user(OTHER, 'other@b.test', ORG_B, 'admin')},
      ${user(LONER, 'loner@c.test', null, 'viewer')};
    INSERT INTO vault (id, org_id, name, slug) VALUES
      ('${VA1}', '${ORG_A}', 'A1', 'a1'), ('${VA2}', '${ORG_A}', 'A2', 'a2'), ('${VB}', '${ORG_B}', 'B', 'b');
    INSERT INTO vault_access (vault_id, user_id) VALUES
      ('${VA1}', '${ALICE}'), ('${VA1}', '${BOB}'), ('${VA2}', '${BOB}'), ('${VA1}', '${DAVE}');
    INSERT INTO file (id, org_id, vault_id, file_path, file_name, extension, content_hash, version, created_by) VALUES
      ${file(P1, VA1, 'a1/bracket.sldprt', '.sldprt', H_P1V2)},
      ${file(D1, VA1, 'a1/bracket.slddrw', '.slddrw', H_D1)},
      ${file(A1, VA1, 'a1/frame.sldasm', '.sldasm', H_A1)},
      ${file(P3, VA1, 'a1/spacer.sldprt', '.sldprt', H_P3)},
      ${file(S1, VA2, 'a2/secret.sldprt', '.sldprt', H_S1)},
      ${file(SD, VA2, 'a2/secret.slddrw', '.SLDDRW', H_SD)},
      ${file(SD2, VA2, 'a2/other.slddrw', '.slddrw', H_SD)},
      ${file(PB, VB, 'b/b.sldprt', '.sldprt', H_PB, ORG_B)};
    INSERT INTO file_version (id, file_id, version, revision, content_hash, file_size, part_number, description, created_by) VALUES
      ${version(P1V1, P1, 1, 'A', H_P1V1, 'BR-1')},
      ${version(P1V2, P1, 2, 'B', H_P1V2, 'BR-1')},
      ${version(D1V1, D1, 1, 'A', H_D1, 'BR-1')},
      ${version(A1V1, A1, 1, 'A', H_A1, 'FR-1')},
      ${version(P3V1, P3, 1, 'A', H_P3, 'SP-1')},
      ${version(S1V1, S1, 1, 'A', H_S1, 'SE-1')},
      ${version(SDV1, SD, 1, 'A', H_SD, 'SE-1')},
      ${version(SD2V1, SD2, 1, 'A', H_SD, 'SE-2')},
      ${version(PBV1, PB, 1, 'A', H_PB, 'B-1')};
    INSERT INTO file_version_output (org_id, file_id, file_version_id, kind, configuration, storage_hash, file_size, file_name) VALUES
      ('${ORG_A}', '${P1}', '${P1V2}', 'step', NULL, '${H_STEP}', 11, 'bracket.step'),
      ('${ORG_A}', '${P1}', '${P1V2}', 'stl', 'Long', '${H_STL}', 12, 'bracket-Long.stl'),
      ('${ORG_A}', '${P1}', '${P1V2}', 'iges', NULL, '${H_IGES}', 14, 'bracket.igs'),
      ('${ORG_A}', '${D1}', '${D1V1}', 'dxf', NULL, '${H_DXF}', 15, 'bracket.dxf'),
      ('${ORG_A}', '${D1}', '${D1V1}', 'step', NULL, '${H_DSTEP}', 16, 'bracket-drawing.step');
    INSERT INTO drawing_pdf_render (org_id, file_id, file_version_id, storage_hash, file_size) VALUES
      ('${ORG_A}', '${D1}', '${D1V1}', '${H_PDF}', 13);
    INSERT INTO supplier (id, org_id, name) VALUES ('${SUP_A}', '${ORG_A}', 'Acme'), ('${SUP_B}', '${ORG_B}', 'Bolt');
    INSERT INTO storage.objects (bucket_id, name, owner, owner_id) VALUES
      ('vault', '${objectName(H_STEP)}', '${ADMIN}', '${ADMIN}'),
      ('vault', '${objectName(H_PDF)}', '${ADMIN}', '${ADMIN}');
    `,
  )
}, 300_000)

afterAll(async () => {
  await db?.close()
})

// ---------------------------------------------------------------------------
// The migration
// ---------------------------------------------------------------------------

describe('supabase/migrations/0513_supply_orders.sql', () => {
  const pick = (file: string, name: string) => {
    const sql = readSql(resolve(MIGRATIONS, file))
    const m = sql.match(new RegExp(`CREATE OR REPLACE FUNCTION ${name}\\([\\s\\S]*?\\n\\$\\$;`))
    if (!m) throw new Error(`${name} not found in ${file}`)
    return m[0]
  }

  it('follows the runner contract and stamps 513', async () => {
    const sql = readSql(resolve(MIGRATIONS, MIGRATION))
    expect(sql).not.toMatch(/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/im)
    expect(sql).not.toMatch(/^-- blueplm:no-transaction/)
    expect(sql).toContain('LANGUAGE sql IMMUTABLE AS $$ SELECT 513 $$;')
    await actAsOwner(db)
    const r = await db.query<{ v: { stamped: boolean; version: number; problems: unknown[] } }>(
      'SELECT verify_and_stamp_schema() AS v',
    )
    expect(r.rows[0].v.problems).toEqual([])
    expect(r.rows[0].v).toMatchObject({ stamped: true, version: 513 })
  }, 600_000)

  it('follows the naming rules', () => {
    const inv = inventory([{ file: MIGRATION, text: readSql(resolve(MIGRATIONS, MIGRATION)) }])
    expect(inv.tables.has('supply_order_line')).toBe(true)
    expect(checkNaming(inv).map((v) => `${v.kind} ${v.name}: ${v.rule}`)).toEqual([])
  })

  it('redefines check_release_residue() changing only its two table lists', () => {
    const base = pick('0505_version_outputs.sql', 'check_release_residue')
    expect(pick(MIGRATION, 'check_release_residue')).toBe(
      base
        .replace(
          "'inspection_report', 'file_version_output')",
          "'inspection_report', 'file_version_output', 'supply_order_line')",
        )
        .replace(
          "'drawing_pdf_render', 'file_version_output')",
          "'drawing_pdf_render', 'file_version_output',\n                           'supply_order', 'supply_order_line')",
        ),
    )
  })

  it('redefines can_read_vault_object() adding only the sent order lines', () => {
    const base = pick('0505_version_outputs.sql', 'can_read_vault_object')
    const ours = pick(MIGRATION, 'can_read_vault_object')
    expect(ours).not.toBe(base)
    expect(ours.replace(/ {8}OR EXISTS \(SELECT 1 FROM supply_order_line l[\s\S]*?\(SELECT id FROM visible\)\)\)\n/, '')).toBe(base)
  })

  it('exports both tables in server backups, and the API lists exactly the latest definition', async () => {
    const tables = (file: string) =>
      [...readSql(resolve(MIGRATIONS, file)).matchAll(/WHEN '([a-z_]+)' THEN '/g)].map((m) => m[1]).sort()
    expect(tables(MIGRATION)).toEqual(
      [...tables('0505_version_outputs.sql'), 'supply_order', 'supply_order_line', 'supply_order_number_counter'].sort(),
    )
    expect([...BACKUP_TABLES].sort()).toEqual(tables(MIGRATION))
    // Restore order: an order after its supplier, a line after its order and file.
    const at = (t: string) => (BACKUP_TABLES as readonly string[]).indexOf(t)
    expect(at('supply_order')).toBeGreaterThan(at('supplier'))
    expect(at('supply_order_line')).toBeGreaterThan(at('supply_order'))
    expect(at('supply_order_line')).toBeGreaterThan(at('file_version'))
    expect(at('supply_order_number_counter')).toBeGreaterThan(at('supply_order'))
    await actAsOwner(db)
    await db.exec('SET ROLE service_role')
    for (const t of ['supply_order', 'supply_order_line', 'supply_order_number_counter']) {
      const r = await db.query<{ p: { missing: boolean } }>(`SELECT backup_list_org_rows($1, $2, NULL, 10) AS p`, [ORG_A, t])
      expect(r.rows[0].p.missing).toBe(false)
    }
    await actAsOwner(db)
  })

  it('gives clients SELECT only, anon nothing, and publishes both tables', async () => {
    await actAsOwner(db)
    const r = await db.query<{ t: string; anon: boolean; sel: boolean; ins: boolean; upd: boolean; del: boolean; pub: boolean }>(
      `SELECT t,
              has_table_privilege('anon', t, 'SELECT') AS anon,
              has_table_privilege('authenticated', t, 'SELECT') AS sel,
              has_table_privilege('authenticated', t, 'INSERT') AS ins,
              has_table_privilege('authenticated', t, 'UPDATE') AS upd,
              has_table_privilege('authenticated', t, 'DELETE') AS del,
              EXISTS (SELECT 1 FROM pg_publication_tables p WHERE p.pubname = 'supabase_realtime' AND p.tablename = t) AS pub
         FROM unnest(ARRAY['supply_order', 'supply_order_line']) t ORDER BY t`,
    )
    for (const row of r.rows) expect(row).toMatchObject({ anon: false, sel: true, ins: false, upd: false, del: false, pub: true })
    const fns = await db.query<{ sig: string; anon: boolean; auth: boolean; definer: boolean }>(
      `SELECT p.oid::regprocedure::text AS sig, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth, p.prosecdef AS definer
         FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'supply_order%' ORDER BY 1`,
    )
    const rpcs = fns.rows.filter((f) => f.auth).map((f) => f.sig)
    expect(rpcs).toEqual([
      'supply_order_add_lines(uuid,jsonb)',
      'supply_order_create(text,text,uuid,text,date,text)',
      'supply_order_delete(uuid)',
      'supply_order_duplicate(uuid,text)',
      'supply_order_remove_lines(uuid,uuid[])',
      'supply_order_set_status(uuid,text,boolean)',
      'supply_order_update(uuid,jsonb)',
      'supply_order_update_line(uuid,jsonb)',
    ])
    for (const f of fns.rows) {
      expect(f.anon).toBe(false)
      // Only the RPCs run as the owner; the helpers are reachable only through them.
      expect(f.definer).toBe(f.auth)
    }
  })

  it('check_release_residue() refuses a client write policy, or a line read policy without the vault rule', async () => {
    await actAsOwner(db)
    const residue = async () =>
      (
        await db.query<{ residue: string }>(
          `SELECT residue FROM check_release_residue() WHERE identity LIKE '%supply_order%' ORDER BY residue`,
        )
      ).rows.map((r) => r.residue)
    expect(await residue()).toEqual([])
    await db.exec(
      `CREATE POLICY "leftover write" ON supply_order FOR UPDATE TO authenticated USING (true);
       CREATE POLICY "leftover read" ON supply_order_line FOR SELECT TO authenticated USING (true);`,
    )
    expect(await residue()).toEqual(['file_policy_ignores_vault_access', 'review_client_write_policy'])
    await db.exec(`DROP POLICY "leftover write" ON supply_order; DROP POLICY "leftover read" ON supply_order_line;`)
    expect(await residue()).toEqual([])
  })
})

describe('a 4.10 database upgraded through 0500 and 0501-0513', () => {
  let upgraded: PGlite

  beforeAll(async () => {
    upgraded = await bootLegacy()
    await actAsOwner(upgraded)
    for (const m of ['0500_from_4x.sql', ...MIGRATION_FILES]) {
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
})

// ---------------------------------------------------------------------------
// The functions, in one order's life
// ---------------------------------------------------------------------------

let ORDER1 = ''

describe('supply_order_create()', () => {
  it('numbers orders per organization with the default prefix, and stamps the creator', async () => {
    const first = await createOrder(ALICE, '  Brackets  ')
    ORDER1 = first.id
    expect(first).toMatchObject({
      order_number: 'ORD-0001', sequence: 1, status: 'draft', purpose: 'purchase', title: 'Brackets',
      line_count: 0, created_by: ALICE, updated_by: ALICE, org_id: ORG_A,
    })
    const second = await rpc<{ order: OrderRow }>(ALICE, `supply_order_create(p_title => $1, p_purpose => 'quote', p_supplier_id => $2::uuid)`, [
      'Quote',
      SUP_A,
    ])
    expect(second.order).toMatchObject({ order_number: 'ORD-0002', sequence: 2, purpose: 'quote', supplier_id: SUP_A, supplier_name: 'Acme' })
    const named = await rpc<{ order: OrderRow }>(BOB, `supply_order_create(p_title => 'Named', p_supplier_id => $1::uuid, p_supplier_name => 'Acme East')`, [SUP_A])
    expect(named.order.supplier_name).toBe('Acme East')
  })

  it("takes the organization's prefix, and never truncates a long sequence", async () => {
    await actAsOwner(db)
    await db.query(`UPDATE organization SET settings = settings || '{"orders": {"number_prefix": "PO-"}}'::jsonb WHERE id = $1`, [ORG_B])
    await db.query(
      `INSERT INTO supply_order (org_id, sequence, order_number, title) VALUES ($1, 9999, 'PO-9999', 'Old')`,
      [ORG_B],
    )
    expect((await createOrder(OTHER, 'Next')).order_number).toBe('PO-10000')
    // The unique key is the backstop behind the advisory lock.
    await actAsOwner(db)
    let message = ''
    try {
      await db.query(`INSERT INTO supply_order (org_id, sequence, order_number, title) VALUES ($1, 1, 'ORD-0001', 'Twin')`, [ORG_A])
    } catch (e) {
      message = (e as Error).message
    }
    expect(message).toMatch(/supply_order_org_id_sequence_key/)
  })

  it('never hands out a deleted order\'s number again, and keeps the counter from clients', async () => {
    const a = await createOrder(BOB, 'Newest')
    await rpc(BOB, 'supply_order_delete($1)', [a.id])
    const b = await createOrder(BOB, 'After the delete')
    expect(b.sequence).toBe(a.sequence + 1)
    await actAsOwner(db)
    const c = await db.query<{ last_sequence: number }>(
      'SELECT last_sequence FROM supply_order_number_counter WHERE org_id = $1',
      [ORG_A],
    )
    expect(c.rows).toEqual([{ last_sequence: b.sequence }])
    await rpc(BOB, 'supply_order_delete($1)', [b.id])
    for (const user of [ALICE, ADMIN]) {
      expect(await refusal(user, 'SELECT * FROM supply_order_number_counter')).toMatch(/permission denied/)
      expect(await refusal(user, 'UPDATE supply_order_number_counter SET last_sequence = 0')).toMatch(/permission denied/)
    }
  })

  it('refuses a bad title, purpose or supplier', async () => {
    expect(await refusal(ALICE, `SELECT supply_order_create('   ')`)).toBe('BAD_PATCH')
    expect(await refusal(ALICE, `SELECT supply_order_create(NULL)`)).toBe('BAD_PATCH')
    expect(await refusal(ALICE, `SELECT supply_order_create('x', 'gift')`)).toBe('BAD_PATCH')
    expect(await refusal(ALICE, `SELECT supply_order_create(p_title => 'x', p_supplier_id => $1::uuid)`, [SUP_B])).toBe('BAD_PATCH')
    expect(await refusal(ALICE, `SELECT supply_order_create($1)`, ['x'.repeat(201)])).toBe('BAD_PATCH')
  })

  it('refuses someone outside an organization, and anon cannot call it', async () => {
    expect(await refusal(LONER, `SELECT supply_order_create('x')`)).toBe('NOT_MEMBER')
    await actAsOwner(db)
    await db.exec('SET ROLE anon')
    let message = ''
    try {
      await db.query(`SELECT supply_order_create('x')`)
    } catch (e) {
      message = (e as Error).message
    }
    expect(message).toMatch(/permission denied/)
    await actAsOwner(db)
  })

  it('needs the orders module once an administrator restricts it', async () => {
    await actAsOwner(db)
    await db.query(`INSERT INTO module_access (org_id, module_id, user_id) VALUES ($1, 'orders', $2)`, [ORG_A, ALICE])
    try {
      expect(await refusal(DAVE, `SELECT supply_order_create('x')`)).toBe('NO_MODULE_ACCESS')
      expect(await refusal(DAVE, `SELECT supply_order_set_status($1, 'cancelled')`, [ORDER1])).toBe('NO_MODULE_ACCESS')
      expect(await count(DAVE, 'SELECT id FROM supply_order')).toBe(0)
      expect(await count(ALICE, 'SELECT id FROM supply_order')).toBeGreaterThan(0)
      expect(await count(ADMIN, 'SELECT id FROM supply_order')).toBeGreaterThan(0)
    } finally {
      await actAsOwner(db)
      await db.query(`DELETE FROM module_access WHERE org_id = $1 AND module_id = 'orders'`, [ORG_A])
    }
    expect(await count(DAVE, 'SELECT id FROM supply_order')).toBeGreaterThan(0)
  })
})

describe('supply_order_add_lines()', () => {
  it('pins versions with default kinds and snapshots, and skips what the caller may not pin', async () => {
    const r = await addLines(ALICE, ORDER1, [
      { file_version_id: P1V1 },
      { file_version_id: D1V1 },
      { file_version_id: S1V1 },
      { file_version_id: MISSING },
      { file_version_id: PBV1 },
      { file_version_id: A1V1, drawing_version_id: P1V1 },
      { file_version_id: 'not-a-uuid' },
    ])
    expect(r).toMatchObject({ ok: true, added: 2, updated: 0 })
    expect(r.skipped).toEqual([
      { file_version_id: S1V1, reason: 'NO_VAULT_ACCESS' },
      { file_version_id: MISSING, reason: 'NOT_FOUND' },
      { file_version_id: PBV1, reason: 'NOT_FOUND' },
      { file_version_id: A1V1, reason: 'NOT_A_DRAWING' },
      { file_version_id: 'not-a-uuid', reason: 'NOT_FOUND' },
    ])
    expect(await lineOf(ORDER1, P1)).toMatchObject({
      file_version_id: P1V1, output_kinds: ['step'], quantity: 1, file_name: 'bracket.sldprt', part_number: 'BR-1',
      description: 'Desc BR-1', revision: 'A', version: 1, vault_id: VA1, drawing_version_id: null, added_by: ALICE,
      sent_outputs: null, missing_kinds: null,
    })
    // A drawing on its own line sends its PDF and has no drawing pin.
    expect(await lineOf(ORDER1, D1)).toMatchObject({ output_kinds: ['pdf'], drawing_version_id: null, drawing_file_id: null })
    expect((await order(ORDER1)).line_count).toBe(2)
  })

  it('re-pins an existing file and configuration, keeping its quantity and kinds unless given', async () => {
    await rpc(ALICE, `supply_order_update_line($1, '{"quantity": 4}'::jsonb)`, [(await lineOf(ORDER1, P1)).id])
    const r = await addLines(ALICE, ORDER1, [{ file_version_id: P1V2, drawing_version_id: D1V1 }])
    expect(r).toMatchObject({ added: 0, updated: 1, skipped: [] })
    expect(await lineOf(ORDER1, P1)).toMatchObject({
      file_version_id: P1V2, version: 2, revision: 'B', quantity: 4, output_kinds: ['step'],
      drawing_file_id: D1, drawing_version_id: D1V1, drawing_file_name: 'bracket.slddrw', drawing_version: 1,
      drawing_vault_id: VA1,
    })
  })

  it('keeps one line per configuration, and orders the kinds it is given', async () => {
    const r = await addLines(ALICE, ORDER1, [
      { file_version_id: P1V2, configuration: 'Long', quantity: 3, output_kinds: ['stl', 'step', 'stl'] },
      { file_version_id: A1V1, drawing_version_id: D1V1 },
    ])
    expect(r).toMatchObject({ added: 2, updated: 0 })
    expect(await lineOf(ORDER1, P1, 'Long')).toMatchObject({ quantity: 3, output_kinds: ['step', 'stl'] })
    // A model with a drawing sends the PDF and the STEP by default.
    expect(await lineOf(ORDER1, A1)).toMatchObject({ output_kinds: ['pdf', 'step'], drawing_version_id: D1V1 })
  })

  it('refuses a bad kind, quantity or element as a whole', async () => {
    const before = (await order(ORDER1)).line_count
    const call = `SELECT supply_order_add_lines($1, $2::jsonb)`
    expect(await refusal(ALICE, call, [ORDER1, JSON.stringify([{ file_version_id: P3V1 }, { file_version_id: P1V1, output_kinds: ['png'] }])])).toBe('BAD_KIND')
    expect(await refusal(ALICE, call, [ORDER1, JSON.stringify([{ file_version_id: P3V1, output_kinds: 'step' }])])).toBe('BAD_KIND')
    expect(await refusal(ALICE, call, [ORDER1, JSON.stringify([{ file_version_id: P3V1, quantity: 0 }])])).toBe('BAD_QUANTITY')
    expect(await refusal(ALICE, call, [ORDER1, JSON.stringify([{ file_version_id: P3V1, quantity: 1.5 }])])).toBe('BAD_QUANTITY')
    expect(await refusal(ALICE, call, [ORDER1, JSON.stringify([{ file_version_id: P3V1, colour: 'red' }])])).toBe('BAD_PATCH')
    expect(await refusal(ALICE, call, [ORDER1, JSON.stringify({ file_version_id: P3V1 })])).toBe('BAD_PATCH')
    expect(await refusal(ALICE, call, [MISSING, JSON.stringify([])])).toBe('NOT_FOUND')
    expect(await refusal(OTHER, call, [ORDER1, JSON.stringify([])])).toBe('NOT_FOUND')
    expect((await order(ORDER1)).line_count).toBe(before)
  })

  it('pins a line in another vault for a member who can read it', async () => {
    const r = await addLines(BOB, ORDER1, [{ file_version_id: S1V1, drawing_version_id: SDV1 }])
    expect(r).toMatchObject({ added: 1, skipped: [] })
    // The drawing's extension is matched without regard to case.
    expect(await lineOf(ORDER1, S1)).toMatchObject({ vault_id: VA2, drawing_vault_id: VA2, output_kinds: ['pdf', 'step'] })
    expect((await order(ORDER1)).line_count).toBe(5)
  })
})

describe('reading orders and lines', () => {
  it('hides a line in an unreadable vault while line_count still counts it', async () => {
    expect(await count(ALICE, `SELECT id FROM supply_order_line WHERE order_id = $1`, [ORDER1])).toBe(4)
    expect(await count(BOB, `SELECT id FROM supply_order_line WHERE order_id = $1`, [ORDER1])).toBe(5)
    expect(await count(ADMIN, `SELECT id FROM supply_order_line WHERE order_id = $1`, [ORDER1])).toBe(5)
    expect(await count(CAROL, `SELECT id FROM supply_order_line WHERE order_id = $1`, [ORDER1])).toBe(0)
    for (const reader of [ALICE, CAROL]) {
      await actAs(db, reader)
      const r = await db.query<{ line_count: number }>('SELECT line_count FROM supply_order WHERE id = $1', [ORDER1])
      expect(r.rows).toEqual([{ line_count: 5 }])
    }
  })

  it('hides a line whose drawing is in an unreadable vault', async () => {
    const asm = (await lineOf(ORDER1, A1)).id
    await rpc(BOB, `supply_order_update_line($1, $2::jsonb)`, [asm, JSON.stringify({ drawing_version_id: SDV1 })])
    expect(await count(ALICE, `SELECT id FROM supply_order_line WHERE order_id = $1`, [ORDER1])).toBe(3)
    expect(await refusal(ALICE, `SELECT supply_order_update_line($1, '{"quantity": 2}'::jsonb)`, [asm])).toBe('NOT_FOUND')
    await rpc(BOB, `supply_order_update_line($1, $2::jsonb)`, [asm, JSON.stringify({ drawing_version_id: D1V1 })])
    expect(await count(ALICE, `SELECT id FROM supply_order_line WHERE order_id = $1`, [ORDER1])).toBe(4)
  })

  it('shows another organization nothing', async () => {
    expect(await count(OTHER, `SELECT id FROM supply_order WHERE org_id = $1`, [ORG_A])).toBe(0)
    expect(await count(OTHER, `SELECT id FROM supply_order_line`)).toBe(0)
  })

  it('takes no client writes', async () => {
    expect(await refusal(ALICE, `UPDATE supply_order SET status = 'closed' WHERE id = $1`, [ORDER1])).toMatch(/permission denied/)
    expect(await refusal(ALICE, `DELETE FROM supply_order_line`)).toMatch(/permission denied/)
    expect(
      await refusal(ALICE, `INSERT INTO supply_order (org_id, sequence, order_number, title) VALUES ($1, 50, 'X', 'X')`, [ORG_A]),
    ).toMatch(/permission denied/)
  })
})

describe('supply_order_update_line()', () => {
  it('changes quantity, kinds, notes and the pinned version of the same file', async () => {
    const id = (await lineOf(ORDER1, P1)).id
    const r = await rpc<{ ok: boolean; line: LineRow }>(ALICE, `supply_order_update_line($1, $2::jsonb)`, [
      id,
      JSON.stringify({ quantity: 5, output_kinds: ['source', 'pdf', 'step'], notes: ' anodize ', file_version_id: P1V1 }),
    ])
    expect(r.line).toMatchObject({ quantity: 5, output_kinds: ['pdf', 'step', 'source'], notes: 'anodize', version: 1, revision: 'A' })
    await rpc(ALICE, `supply_order_update_line($1, $2::jsonb)`, [id, JSON.stringify({ file_version_id: P1V2 })])
    expect(await lineOf(ORDER1, P1)).toMatchObject({ file_version_id: P1V2, version: 2, drawing_version_id: D1V1 })
  })

  it('refuses another file, a non-drawing drawing pin, and bad values', async () => {
    const p1 = (await lineOf(ORDER1, P1)).id
    const d1 = (await lineOf(ORDER1, D1)).id
    const call = `SELECT supply_order_update_line($1, $2::jsonb)`
    expect(await refusal(ALICE, call, [p1, JSON.stringify({ file_version_id: D1V1 })])).toBe('BAD_PATCH')
    expect(await refusal(ALICE, call, [p1, JSON.stringify({ drawing_version_id: P1V1 })])).toBe('BAD_PATCH')
    expect(await refusal(ALICE, call, [p1, JSON.stringify({ drawing_version_id: SDV1 })])).toBe('NO_VAULT_ACCESS')
    expect(await refusal(ALICE, call, [d1, JSON.stringify({ drawing_version_id: D1V1 })])).toBe('BAD_PATCH')
    expect(await refusal(ALICE, call, [p1, JSON.stringify({ quantity: -1 })])).toBe('BAD_QUANTITY')
    expect(await refusal(ALICE, call, [p1, JSON.stringify({ output_kinds: ['PDF'] })])).toBe('BAD_KIND')
    expect(await refusal(ALICE, call, [p1, JSON.stringify({ position: 9 })])).toBe('BAD_PATCH')
    expect(await refusal(ALICE, call, [MISSING, JSON.stringify({})])).toBe('NOT_FOUND')
    expect(await refusal(ALICE, call, [(await lineOf(ORDER1, S1)).id, JSON.stringify({ quantity: 2 })])).toBe('NOT_FOUND')
  })
})

describe('supply_order_update()', () => {
  it('changes the header and refuses an unknown key or a bad value', async () => {
    const r = await rpc<{ order: OrderRow }>(ALICE, `supply_order_update($1, $2::jsonb)`, [
      ORDER1,
      JSON.stringify({ title: 'Brackets, batch 1', due_date: '2026-12-01', supplier_id: SUP_A, notes: 'Rush' }),
    ])
    expect(r.order).toMatchObject({ title: 'Brackets, batch 1', due_date: '2026-12-01', supplier_id: SUP_A, supplier_name: 'Acme', notes: 'Rush' })
    const cleared = await rpc<{ order: OrderRow }>(ALICE, `supply_order_update($1, '{"supplier_id": null}'::jsonb)`, [ORDER1])
    expect(cleared.order).toMatchObject({ supplier_id: null, supplier_name: 'Acme' })
    const call = `SELECT supply_order_update($1, $2::jsonb)`
    expect(await refusal(ALICE, call, [ORDER1, JSON.stringify({ status: 'sent' })])).toBe('BAD_PATCH')
    expect(await refusal(ALICE, call, [ORDER1, JSON.stringify({ due_date: 'soon' })])).toBe('BAD_PATCH')
    expect(await refusal(ALICE, call, [ORDER1, JSON.stringify({ purpose: 'gift' })])).toBe('BAD_PATCH')
    expect(await refusal(ALICE, call, [ORDER1, JSON.stringify({ supplier_id: SUP_B })])).toBe('BAD_PATCH')
    expect(await refusal(ALICE, call, [ORDER1, JSON.stringify({ title: '' })])).toBe('BAD_PATCH')
    expect(await refusal(ALICE, call, [ORDER1, '[]'])).toBe('BAD_PATCH')
  })
})

describe('supply_order_remove_lines()', () => {
  it('removes only lines the caller can read', async () => {
    const o = await createOrder(ALICE, 'Removals')
    await addLines(ALICE, o.id, [{ file_version_id: P1V1 }])
    await addLines(BOB, o.id, [{ file_version_id: S1V1 }])
    const ids = (await lines(o.id)).map((l) => l.id)
    const r = await rpc<{ removed: number }>(ALICE, `supply_order_remove_lines($1, $2::uuid[])`, [o.id, `{${ids.join(',')}}`])
    expect(r.removed).toBe(1)
    expect((await lines(o.id)).map((l) => l.file_id)).toEqual([S1])
    expect((await order(o.id)).line_count).toBe(1)
  })
})

describe('supply_order_set_status()', () => {
  const setStatus = `SELECT supply_order_set_status($1, $2, $3)`

  it('refuses an empty order and transitions the contract does not allow', async () => {
    const empty = await createOrder(ALICE, 'Empty')
    expect(await refusal(ALICE, setStatus, [empty.id, 'sent', true])).toBe('EMPTY_ORDER')
    expect(await refusal(ALICE, setStatus, [ORDER1, 'closed', false])).toBe('BAD_TRANSITION')
    expect(await refusal(ALICE, setStatus, [ORDER1, 'received', false])).toBe('BAD_TRANSITION')
    expect(await refusal(ALICE, setStatus, [ORDER1, 'draft', false])).toBe('BAD_TRANSITION')
    expect(await refusal(ALICE, setStatus, [ORDER1, 'shipped', false])).toBe('BAD_TRANSITION')
    expect(await refusal(ALICE, setStatus, [MISSING, 'sent', false])).toBe('NOT_FOUND')
  })

  it('refuses MISSING_OUTPUTS with the missing kinds per line, and records nothing', async () => {
    const e = await failure(ALICE, setStatus, [ORDER1, 'sent', false])
    expect(e.hint).toBe('MISSING_OUTPUTS')
    const missing = JSON.parse(e.detail ?? '[]') as Array<{ line_id: string; kinds: string[] }>
    const byLine = Object.fromEntries(missing.map((m) => [m.line_id, m.kinds]))
    expect(byLine).toEqual({
      [(await lineOf(ORDER1, P1, 'Long')).id]: ['step'],
      [(await lineOf(ORDER1, A1)).id]: ['step'],
      [(await lineOf(ORDER1, S1)).id]: ['pdf', 'step'],
    })
    expect((await order(ORDER1)).status).toBe('draft')
    expect((await lines(ORDER1)).every((l) => l.sent_outputs === null)).toBe(true)
  })

  it('sends anyway when told to, recording the outputs from the real rows', async () => {
    const r = await rpc<{ ok: boolean; order: OrderRow; missing: Array<{ line_id: string; kinds: string[] }> }>(
      ALICE,
      'supply_order_set_status($1, $2, $3)',
      [ORDER1, 'sent', true],
    )
    expect(r.order).toMatchObject({ status: 'sent', sent_by: ALICE })
    expect(r.order.sent_at).not.toBeNull()
    expect(r.missing).toHaveLength(3)
    expect(await lineOf(ORDER1, P1)).toMatchObject({
      sent_outputs: [
        { kind: 'pdf', storage_hash: H_PDF, file_size: 13, file_name: 'bracket.pdf' },
        { kind: 'step', storage_hash: H_STEP, file_size: 11, file_name: 'bracket.step' },
        { kind: 'source', storage_hash: H_P1V2, file_size: 102, file_name: 'bracket.sldprt' },
      ],
      missing_kinds: [],
    })
    expect(await lineOf(ORDER1, D1)).toMatchObject({
      sent_outputs: [{ kind: 'pdf', storage_hash: H_PDF, file_size: 13, file_name: 'bracket.pdf' }],
    })
    expect(await lineOf(ORDER1, P1, 'Long')).toMatchObject({
      sent_outputs: [{ kind: 'stl', storage_hash: H_STL, file_size: 12, file_name: 'bracket-Long.stl' }],
      missing_kinds: ['step'],
    })
    expect(await lineOf(ORDER1, S1)).toMatchObject({ sent_outputs: [], missing_kinds: ['pdf', 'step'] })
  })

  it('freezes the lines of a sent order but not its header', async () => {
    const p1 = (await lineOf(ORDER1, P1)).id
    expect(await refusal(ALICE, `SELECT supply_order_add_lines($1, $2::jsonb)`, [ORDER1, JSON.stringify([{ file_version_id: P3V1 }])])).toBe('NOT_DRAFT')
    expect(await refusal(ALICE, `SELECT supply_order_update_line($1, '{"quantity": 9}'::jsonb)`, [p1])).toBe('NOT_DRAFT')
    expect(await refusal(ALICE, `SELECT supply_order_remove_lines($1, $2::uuid[])`, [ORDER1, `{${p1}}`])).toBe('NOT_DRAFT')
    const r = await rpc<{ order: OrderRow }>(ALICE, `supply_order_update($1, '{"notes": "Sent by mail"}'::jsonb)`, [ORDER1])
    expect(r.order.notes).toBe('Sent by mail')
  })

  it('keeps a sent output downloadable for readers of the line after its output row is gone', async () => {
    await actAsOwner(db)
    await db.query(`DELETE FROM file_version_output WHERE storage_hash = $1`, [H_STEP])
    const step = `SELECT id FROM storage.objects WHERE name = $1`
    expect(await count(ALICE, step, [objectName(H_STEP)])).toBe(1)
    expect(await count(CAROL, step, [objectName(H_STEP)])).toBe(0)
    expect(await count(OTHER, step, [objectName(H_STEP)])).toBe(0)
    // The way in follows the orders module, as the line's read policy does.
    await actAsOwner(db)
    await db.query(`INSERT INTO module_access (org_id, module_id, user_id) VALUES ($1, 'orders', $2)`, [ORG_A, BOB])
    try {
      expect(await count(ALICE, step, [objectName(H_STEP)])).toBe(0)
    } finally {
      await actAsOwner(db)
      await db.query(`DELETE FROM module_access WHERE org_id = $1 AND module_id = 'orders'`, [ORG_A])
    }
    expect(await count(ALICE, step, [objectName(H_STEP)])).toBe(1)
  })

  it('reopens a sent order, clearing what sending recorded, and records again from the rows of now', async () => {
    const reopened = await rpc<{ order: OrderRow }>(ALICE, 'supply_order_set_status($1, $2)', [ORDER1, 'draft'])
    expect(reopened.order).toMatchObject({ status: 'draft', sent_at: null, sent_by: null })
    expect((await lines(ORDER1)).every((l) => l.sent_outputs === null && l.missing_kinds === null)).toBe(true)
    // Nothing names the deleted STEP now.
    expect(await count(ALICE, `SELECT id FROM storage.objects WHERE name = $1`, [objectName(H_STEP)])).toBe(0)
    await rpc(ALICE, 'supply_order_set_status($1, $2, $3)', [ORDER1, 'sent', true])
    expect((await lineOf(ORDER1, P1)).missing_kinds).toEqual(['step'])
  })

  it('goes on to received and closed, and a closed order is frozen', async () => {
    expect((await rpc<{ order: OrderRow }>(BOB, 'supply_order_set_status($1, $2)', [ORDER1, 'received'])).order).toMatchObject({ status: 'received' })
    const closed = await rpc<{ order: OrderRow }>(BOB, 'supply_order_set_status($1, $2)', [ORDER1, 'closed'])
    expect(closed.order.status).toBe('closed')
    expect(closed.order.received_at).not.toBeNull()
    expect(closed.order.closed_at).not.toBeNull()
    expect(await refusal(ALICE, `SELECT supply_order_update($1, '{"title": "x"}'::jsonb)`, [ORDER1])).toBe('FROZEN')
    for (const s of ['draft', 'cancelled', 'sent']) expect(await refusal(ALICE, setStatus, [ORDER1, s, true])).toBe('BAD_TRANSITION')
  })

  it('cancels from draft, sent or received, and a cancelled order goes back to draft', async () => {
    const o = await createOrder(ALICE, 'To cancel')
    await addLines(ALICE, o.id, [{ file_version_id: P1V2 }])
    await rpc(ALICE, 'supply_order_set_status($1, $2, $3)', [o.id, 'sent', true])
    const cancelled = await rpc<{ order: OrderRow }>(ALICE, 'supply_order_set_status($1, $2)', [o.id, 'cancelled'])
    expect(cancelled.order).toMatchObject({ status: 'cancelled' })
    expect(cancelled.order.cancelled_at).not.toBeNull()
    expect(await refusal(ALICE, `SELECT supply_order_update($1, '{"title": "x"}'::jsonb)`, [o.id])).toBe('FROZEN')
    expect(await refusal(ALICE, setStatus, [o.id, 'received', false])).toBe('BAD_TRANSITION')
    const back = await rpc<{ order: OrderRow }>(ALICE, 'supply_order_set_status($1, $2)', [o.id, 'draft'])
    expect(back.order).toMatchObject({ status: 'draft', cancelled_at: null, sent_at: null })
    expect((await lines(o.id))[0].sent_outputs).toBeNull()
  })
})

describe('where each sent kind comes from (src/lib/orders/outputs.ts lineKindSource)', () => {
  it("takes DXF from the drawing, IGES from the saved configuration and a drawing line's STEP from the drawing", async () => {
    const o = await createOrder(ALICE, 'Kinds')
    await addLines(ALICE, o.id, [
      { file_version_id: P1V2, configuration: 'Long', drawing_version_id: D1V1, output_kinds: ['pdf', 'dxf', 'step', 'iges', 'stl', 'source'] },
      { file_version_id: D1V1, output_kinds: ['pdf', 'dxf', 'step', 'iges', 'stl', 'source'] },
    ])
    const r = await rpc<{ missing: Array<{ line_id: string; kinds: string[] }> }>(ALICE, 'supply_order_set_status($1, $2, $3)', [o.id, 'sent', true])
    const model = await lineOf(o.id, P1, 'Long')
    const drawing = await lineOf(o.id, D1)
    expect(model).toMatchObject({
      sent_outputs: [
        { kind: 'pdf', storage_hash: H_PDF, file_name: 'bracket.pdf' },
        // IGES exports the saved configuration only, whatever the line's.
        { kind: 'iges', storage_hash: H_IGES, file_name: 'bracket.igs' },
        { kind: 'stl', storage_hash: H_STL, file_name: 'bracket-Long.stl' },
        { kind: 'dxf', storage_hash: H_DXF, file_name: 'bracket.dxf' },
        // The model's own bytes, never the drawing's.
        { kind: 'source', storage_hash: H_P1V2, file_name: 'bracket.sldprt' },
      ],
      // No STEP of configuration Long exists.
      missing_kinds: ['step'],
    })
    expect(drawing).toMatchObject({
      sent_outputs: [
        { kind: 'pdf', storage_hash: H_PDF, file_name: 'bracket.pdf' },
        { kind: 'step', storage_hash: H_DSTEP, file_name: 'bracket-drawing.step' },
        { kind: 'dxf', storage_hash: H_DXF, file_name: 'bracket.dxf' },
        { kind: 'source', storage_hash: H_D1, file_name: 'bracket.slddrw' },
      ],
      // A drawing has no IGES or STL.
      missing_kinds: ['iges', 'stl'],
    })
    expect(Object.fromEntries(r.missing.map((m) => [m.line_id, m.kinds]))).toEqual({
      [model.id]: ['step'],
      [drawing.id]: ['iges', 'stl'],
    })
  })
})

describe('supply_order_duplicate()', () => {
  it('copies the lines and pinned versions the caller can read into a new draft', async () => {
    const r = await rpc<{ ok: boolean; order: OrderRow; skipped: number }>(ALICE, 'supply_order_duplicate($1)', [ORDER1])
    expect(r.order).toMatchObject({ status: 'draft', title: 'Brackets, batch 1', created_by: ALICE, line_count: 4, sent_at: null })
    expect(r.order.order_number).not.toBe((await order(ORDER1)).order_number)
    expect(r.skipped).toBe(1)
    const copy = await lines(r.order.id)
    const source = (await lines(ORDER1)).filter((l) => l.file_id !== S1)
    const shape = (l: LineRow) => [l.file_id, l.file_version_id, l.configuration, l.drawing_version_id, l.quantity, l.output_kinds.join()]
    expect(copy.map(shape)).toEqual(source.map(shape))
    expect(copy.every((l) => l.sent_outputs === null && l.missing_kinds === null)).toBe(true)
    expect(copy.map((l) => l.position)).toEqual([1, 2, 3, 4])

    const all = await rpc<{ order: OrderRow; skipped: number }>(BOB, `supply_order_duplicate($1, 'Batch 2')`, [ORDER1])
    expect(all).toMatchObject({ skipped: 0, order: { title: 'Batch 2', line_count: 5 } })
    expect(await refusal(OTHER, 'SELECT supply_order_duplicate($1)', [ORDER1])).toBe('NOT_FOUND')
  })
})

describe('files in the trash', () => {
  it('are not re-pinned by update_line, nor copied by duplicate (a trashed drawing either)', async () => {
    const o = await createOrder(ALICE, 'Trash')
    await addLines(ALICE, o.id, [{ file_version_id: P1V2 }, { file_version_id: A1V1, drawing_version_id: D1V1 }])
    const p1 = (await lineOf(o.id, P1)).id
    await actAsOwner(db)
    await db.query('UPDATE file SET deleted_at = now() WHERE id IN ($1, $2)', [P1, D1])
    try {
      expect(await refusal(ALICE, `SELECT supply_order_update_line($1, $2::jsonb)`, [p1, JSON.stringify({ file_version_id: P1V1 })])).toBe(
        'NOT_FOUND',
      )
      const dup = await rpc<{ order: OrderRow; skipped: number }>(ALICE, 'supply_order_duplicate($1)', [o.id])
      expect(dup).toMatchObject({ skipped: 2, order: { line_count: 0 } })
    } finally {
      await actAsOwner(db)
      await db.query('UPDATE file SET deleted_at = NULL WHERE id IN ($1, $2)', [P1, D1])
    }
    const dup = await rpc<{ order: OrderRow; skipped: number }>(ALICE, 'supply_order_duplicate($1)', [o.id])
    expect(dup).toMatchObject({ skipped: 0, order: { line_count: 2 } })
  })
})

describe('supply_order_delete()', () => {
  it('deletes a draft or cancelled order for its creator or an administrator only', async () => {
    expect(await refusal(ADMIN, 'SELECT supply_order_delete($1)', [ORDER1])).toBe('NOT_ALLOWED')
    const draft = await createOrder(ALICE, 'Scratch')
    await addLines(ALICE, draft.id, [{ file_version_id: P1V1 }])
    expect(await refusal(BOB, 'SELECT supply_order_delete($1)', [draft.id])).toBe('NOT_ALLOWED')
    expect(await rpc(ALICE, 'supply_order_delete($1)', [draft.id])).toEqual({ ok: true })
    expect(await count(null, 'SELECT id FROM supply_order_line WHERE order_id = $1', [draft.id])).toBe(0)
    // Other clients hear of it through a tombstone.
    expect(
      await count(BOB, `SELECT id FROM realtime_tombstone WHERE table_name = 'supply_order' AND row_id = $1`, [draft.id]),
    ).toBe(1)

    const bobs = await createOrder(BOB, 'Bob scratch')
    await rpc(BOB, 'supply_order_set_status($1, $2)', [bobs.id, 'cancelled'])
    expect(await rpc(ADMIN, 'supply_order_delete($1)', [bobs.id])).toEqual({ ok: true })
    expect(await refusal(ALICE, 'SELECT supply_order_delete($1)', [MISSING])).toBe('NOT_FOUND')
  })
})

describe('when files and vaults go', () => {
  it('keeps a sent line readable from its snapshot after its file is purged', async () => {
    const o = await createOrder(ALICE, 'Spacers')
    await addLines(ALICE, o.id, [{ file_version_id: P3V1, quantity: 7 }])
    await rpc(ALICE, 'supply_order_set_status($1, $2, $3)', [o.id, 'sent', true])
    await actAsOwner(db)
    await db.query('DELETE FROM file WHERE id = $1', [P3])
    const [line] = await lines(o.id)
    expect(line).toMatchObject({
      file_id: null, file_version_id: null, file_name: 'spacer.sldprt', part_number: 'SP-1', version: 1, quantity: 7,
      missing_kinds: ['step'],
    })
    expect(await count(ALICE, 'SELECT id FROM supply_order_line WHERE order_id = $1', [o.id])).toBe(1)
    // A purged line cannot be pinned again.
    const dup = await rpc<{ order: OrderRow; skipped: number }>(ALICE, 'supply_order_duplicate($1)', [o.id])
    expect(dup).toMatchObject({ skipped: 1, order: { line_count: 0 } })
  })

  it('a purged drawing leaves a line that had one, never a drawing-less line', async () => {
    const o = await createOrder(BOB, 'Purged drawing')
    await addLines(BOB, o.id, [{ file_version_id: A1V1, drawing_version_id: SDV1 }])
    await actAsOwner(db)
    await db.query('DELETE FROM file WHERE id = $1', [SD])
    const [line] = await lines(o.id)
    expect(line).toMatchObject({ drawing_file_id: null, drawing_version_id: null, drawing_vault_id: VA2, drawing_file_name: 'secret.slddrw' })
    // Still needs the drawing's vault to read, and its PDF is missing rather than not asked for.
    expect(await count(ALICE, 'SELECT id FROM supply_order_line WHERE order_id = $1', [o.id])).toBe(0)
    const sent = await rpc<{ missing: Array<{ kinds: string[] }> }>(BOB, 'supply_order_set_status($1, $2, $3)', [o.id, 'sent', true])
    expect(sent.missing.map((m) => m.kinds)).toEqual([['pdf', 'step']])
  })

  it("keeps a deleted vault's lines unreadable to everyone and still counted", async () => {
    // A line in VA1 whose drawing is in VA2, sent with the drawing's PDF.
    const o = await createOrder(BOB, 'Cross vault')
    await addLines(BOB, o.id, [{ file_version_id: P1V2, configuration: 'Cross', drawing_version_id: SD2V1 }])
    await actAsOwner(db)
    await db.query(
      `INSERT INTO drawing_pdf_render (org_id, file_id, file_version_id, storage_hash, file_size) VALUES ($1, $2, $3, $4, 17)`,
      [ORG_A, SD2, SD2V1, H_SDPDF],
    )
    await db.query(`INSERT INTO storage.objects (bucket_id, name, owner, owner_id) VALUES ('vault', $1, $2::uuid, $2::text)`, [objectName(H_SDPDF), ADMIN])
    await rpc(BOB, 'supply_order_set_status($1, $2, $3)', [o.id, 'sent', true])
    expect((await lines(o.id))[0].sent_outputs).toEqual([{ kind: 'pdf', storage_hash: H_SDPDF, file_size: 17, file_name: 'other.pdf' }])
    const pdf = `SELECT id FROM storage.objects WHERE name = $1`
    expect(await count(ALICE, pdf, [objectName(H_SDPDF)])).toBe(0)

    await actAsOwner(db)
    await db.query('DELETE FROM vault WHERE id = $1', [VA2])
    // Nobody reads a line of a vault that no longer exists: not the line, not its PDF.
    for (const reader of [ALICE, BOB, ADMIN]) {
      expect(await count(reader, 'SELECT id FROM supply_order_line WHERE order_id = $1', [o.id])).toBe(0)
      expect(await count(reader, `SELECT id FROM supply_order_line WHERE order_id = $1 AND vault_id = $2`, [ORDER1, VA2])).toBe(0)
    }
    expect(await count(ALICE, pdf, [objectName(H_SDPDF)])).toBe(0)
    expect(await count(BOB, pdf, [objectName(H_SDPDF)])).toBe(0)
    expect((await lines(o.id))[0]).toMatchObject({ vault_id: VA1, drawing_vault_id: VA2 })
    expect((await order(ORDER1)).line_count).toBe(5)
    expect((await order(o.id)).line_count).toBe(1)
  })
})
