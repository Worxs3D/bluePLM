/**
 * supabase/migrations/0506_inspection_report_types.sql on real Postgres (PGlite), applied after
 * 0501-0505 to the 5.0 baseline as the migration runner applies them: it stamps 506; a report's
 * type columns are consistent with its type, fixed once issued, and its FAI baseline is an earlier
 * version of its own drawing; its characteristics are distinct snapshot rows of that drawing;
 * results on a typed report must be in the 5.6 format; a template is the default for each type it
 * claims, one per type per organization, and archiving or narrowing it ends the defaults it can no
 * longer hold; reports from before 506 (no type) stay valid.
 */
import type { PGlite } from '@electric-sql/pglite'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { actAs, actAsOwner, bootBaseline, MIGRATIONS, readSql, seed } from './testing/schemaDb'

const ORG_A = '00000000-0000-0000-0000-00000000000a'
const ADMIN = '00000000-0000-0000-0000-000000000001'
const ALICE = '00000000-0000-0000-0000-000000000002' // vault VA1, explorer edit
const EDITORS = '30000000-0000-0000-0000-000000000001'
const VA1 = '40000000-0000-0000-0000-000000000001'
const F1 = '50000000-0000-0000-0000-000000000001' // a drawing
const F2 = '50000000-0000-0000-0000-000000000002' // another drawing
const V1 = '51000000-0000-0000-0000-000000000001' // F1 v1
const V2 = '51000000-0000-0000-0000-000000000002' // F1 v2
const W1 = '51000000-0000-0000-0000-000000000003' // F2 v1
const C1 = '52000000-0000-0000-0000-000000000001'
const C2 = '52000000-0000-0000-0000-000000000002'
const CW = '52000000-0000-0000-0000-000000000009' // a snapshot row of the other drawing
const H_F = '1'.repeat(64)
const H_REPORT = '2'.repeat(64) // Alice's upload
const H_TEMPLATE = '3'.repeat(64) // the administrator's upload
const T1 = '60000000-0000-0000-0000-000000000001'
const T2 = '60000000-0000-0000-0000-000000000002'

const MIGRATION_FILES = [
  '0501_server_backups.sql',
  '0502_security_hardening.sql',
  '0503_vault_object_issues.sql',
  '0504_inspection_tables.sql',
  '0505_version_outputs.sql',
  '0506_inspection_report_types.sql',
]

let db: PGlite
let numberSeq = 0

async function error(sql: string, params: unknown[] = []): Promise<string | null> {
  try {
    await db.query(sql, params)
    return null
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

/** Insert a report as Alice with the given extra columns; returns the error text or null. */
async function insertReport(columns: Record<string, unknown>, version = V2, file = F1): Promise<string | null> {
  await actAs(db, ALICE)
  numberSeq++
  const base: Record<string, unknown> = {
    org_id: ORG_A,
    file_id: file,
    file_version_id: version,
    report_number: `R-${numberSeq}`,
    storage_hash: H_REPORT,
    file_size: 10,
    characteristic_count: 2,
    ...columns,
  }
  const keys = Object.keys(base)
  const values = keys.map((k) => {
    const v = base[k]
    return typeof v === 'object' && v !== null ? JSON.stringify(v) : v
  })
  return error(
    `INSERT INTO inspection_report (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')})`,
    values,
  )
}

const BOTH = `{${C1},${C2}}`

beforeAll(async () => {
  db = await bootBaseline()
  await actAsOwner(db)
  for (const m of MIGRATION_FILES) await db.exec(readSql(resolve(MIGRATIONS, m)))
  const objectName = (hash: string) => `${ORG_A}/${hash.slice(0, 2)}/${hash}`
  await seed(
    db,
    `
    INSERT INTO organization (id, name, slug) VALUES ('${ORG_A}', 'A', 'org-a');
    INSERT INTO app_user (id, email, org_id, role) VALUES
      ('${ADMIN}', 'admin@a.test', '${ORG_A}', 'admin'),
      ('${ALICE}', 'alice@a.test', '${ORG_A}', 'engineer');
    INSERT INTO team (id, org_id, name) VALUES ('${EDITORS}', '${ORG_A}', 'Editors');
    INSERT INTO team_member (team_id, user_id) VALUES ('${EDITORS}', '${ALICE}');
    INSERT INTO team_permission (team_id, resource, actions) VALUES ('${EDITORS}', 'module:explorer', '{view,create,edit,delete}');
    INSERT INTO vault (id, org_id, name, slug) VALUES ('${VA1}', '${ORG_A}', 'A1', 'a1');
    INSERT INTO vault_access (vault_id, user_id) VALUES ('${VA1}', '${ALICE}');
    INSERT INTO file (id, org_id, vault_id, file_path, file_name, extension, content_hash, version, created_by) VALUES
      ('${F1}', '${ORG_A}', '${VA1}', 'a1/one.slddrw', 'one.slddrw', '.slddrw', '${H_F}', 2, '${ADMIN}'),
      ('${F2}', '${ORG_A}', '${VA1}', 'a1/two.slddrw', 'two.slddrw', '.slddrw', '${H_F}', 1, '${ADMIN}');
    INSERT INTO file_version (id, file_id, version, revision, content_hash, created_by, created_at) VALUES
      ('${V1}', '${F1}', 1, 'A', '${H_F}', '${ADMIN}', '2020-01-01'),
      ('${V2}', '${F1}', 2, 'B', '${H_F}', '${ADMIN}', '2020-02-01'),
      ('${W1}', '${F2}', 1, 'A', '${H_F}', '${ADMIN}', '2020-01-01');
    INSERT INTO inspection_characteristic_version (id, file_version_id, org_id, balloon_number) VALUES
      ('${C1}', '${V2}', '${ORG_A}', '1'), ('${C2}', '${V2}', '${ORG_A}', '2'), ('${CW}', '${W1}', '${ORG_A}', '1');
    INSERT INTO storage.objects (bucket_id, name, owner, owner_id) VALUES
      ('vault', '${objectName(H_REPORT)}', '${ALICE}', '${ALICE}'),
      ('vault', '${objectName(H_TEMPLATE)}', '${ADMIN}', '${ADMIN}');
    `,
  )
}, 240_000)

afterAll(async () => {
  await db?.close()
})

describe('supabase/migrations/0506_inspection_report_types.sql', () => {
  it('follows the runner contract and stamps 506', async () => {
    const sql = readSql(resolve(MIGRATIONS, '0506_inspection_report_types.sql'))
    expect(sql).not.toMatch(/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/im)
    expect(sql).toContain('LANGUAGE sql IMMUTABLE AS $$ SELECT 506 $$;')
    // No client-facing policy or function: the vault rule and backups are unchanged.
    expect(sql).not.toMatch(/CREATE POLICY/)
    expect(sql).not.toMatch(/schema_function_inventory/)
    await actAsOwner(db)
    const r = await db.query<{ v: { stamped: boolean; version: number; problems: unknown[] } }>(
      'SELECT verify_and_stamp_schema() AS v',
    )
    expect(r.rows[0].v.problems).toEqual([])
    expect(r.rows[0].v).toMatchObject({ stamped: true, version: 506 })
  }, 600_000)

  it('keeps reports without a type valid (5.5.0 writes none of the new columns)', async () => {
    expect(await insertReport({})).toBeNull()
  })
})

describe('inspection_report type columns', () => {
  it('records a full FAI, a partial FAI and the other types with their own fields', async () => {
    expect(await insertReport({ report_type: 'fai', fai_scope: 'full', fai_reason: 'new_part' })).toBeNull()
    expect(
      await insertReport({
        report_type: 'fai',
        fai_scope: 'partial',
        fai_reason: 'design_change',
        fai_baseline_version_id: V1,
        characteristic_ids: BOTH,
      }),
    ).toBeNull()
    expect(
      await insertReport({ report_type: 'production', lot_number: 'L-7', lot_size: 40, sampling: { plan: 'fixed', n: 5 } }),
    ).toBeNull()
    expect(
      await insertReport({
        report_type: 'receiving',
        lot_size: 12,
        sampling: { plan: '100' },
        po_number: 'PO-1',
        supplier_name: 'Acme',
      }),
    ).toBeNull()
    expect(
      await insertReport({ report_type: 'reinspection', ncr_reference: 'NCR-9', characteristic_ids: BOTH }),
    ).toBeNull()
  })

  it('refuses fields that do not belong to the type', async () => {
    const refused = [
      { report_type: 'fai' }, // no scope
      { report_type: 'production', fai_scope: 'full' },
      { report_type: 'fai', fai_scope: 'partial', fai_baseline_version_id: V1 }, // a partial FAI names its characteristics
      { lot_number: 'L-1' }, // legacy report with a lot
      { report_type: 'fai', fai_scope: 'full', lot_size: 3 },
      { report_type: 'production', po_number: 'PO-1' },
      { report_type: 'production', ncr_reference: 'NCR-1' },
      { report_type: 'reinspection', ncr_reference: 'NCR-1' }, // no characteristics
      { report_type: 'production', characteristic_ids: `{${C1}}` }, // 1 id, count 2
      { report_type: 'production', lot_size: 4, sampling: { plan: 'fixed', n: 5 } }, // sample > lot
      { report_type: 'production', sampling: { plan: 'z14' } }, // no Z1.4 tables shipped
      { report_type: 'production', sampling: { plan: 'fixed' } }, // fixed without n
      { report_type: 'production', sampling: { plan: 'fixed', n: 2.5 } },
      { report_type: 'production', lot_number: '  ' },
      { report_type: 'special' },
      { report_type: 'fai', fai_scope: 'full', fai_reason: 'because' },
    ]
    const accepted: string[] = []
    for (const columns of refused) {
      const message = await insertReport(columns)
      if (!message || !/violates check constraint/.test(message)) accepted.push(`${JSON.stringify(columns)}: ${message}`)
    }
    expect(accepted).toEqual([])
  })

  it('needs a baseline for a partial FAI, and distinct characteristics of this drawing', async () => {
    expect(await insertReport({ report_type: 'fai', fai_scope: 'partial', characteristic_ids: BOTH })).toMatch(
      /needs the version of the FAI it builds on/,
    )
    const reinspect = { report_type: 'reinspection', ncr_reference: 'NCR-2' }
    expect(await insertReport({ ...reinspect, characteristic_ids: `{${C1},${C1}}` })).toMatch(/listed twice/)
    expect(await insertReport({ ...reinspect, characteristic_ids: `{${C1},${CW}}` })).toMatch(
      /not inspection rows of this drawing/,
    )
    expect(
      await insertReport({ ...reinspect, characteristic_ids: `{${C1},52000000-0000-0000-0000-0000000000ff}` }),
    ).toMatch(/not inspection rows of this drawing/)
  })

  it('takes results on a typed report only in the 5.6 format (a 5.5.0 import is refused)', async () => {
    await actAs(db, ALICE)
    const typed = (await db.query<{ id: string }>(`SELECT id FROM inspection_report WHERE report_type = 'receiving' LIMIT 1`)).rows[0].id
    const legacy = (await db.query<{ id: string }>(`SELECT id FROM inspection_report WHERE report_type IS NULL LIMIT 1`)).rows[0].id
    const v1 = JSON.stringify({ format: 'blueplm-inspection-results/1', rows: [] })
    const v2 = JSON.stringify({ format: 'blueplm-inspection-results/2', rows: [] })
    expect(await error(`UPDATE inspection_report SET results = $2, status = 'returned' WHERE id = $1`, [typed, v1])).toMatch(
      /need BluePLM 5.6/,
    )
    expect(await error(`UPDATE inspection_report SET results = $2, status = 'returned' WHERE id = $1`, [typed, v2])).toBeNull()
    // A status change alone keeps working on the 5.6 results.
    expect(await error(`UPDATE inspection_report SET status = 'accepted' WHERE id = $1`, [typed])).toBeNull()
    // Reports from before types take either format.
    expect(await error(`UPDATE inspection_report SET results = $2 WHERE id = $1`, [legacy, v1])).toBeNull()
  })

  it('needs the FAI baseline to be an earlier version of the same drawing', async () => {
    const partial = { report_type: 'fai', fai_scope: 'partial', characteristic_ids: BOTH }
    // Another drawing's version.
    expect(await insertReport({ ...partial, fai_baseline_version_id: W1 })).toMatch(/not an earlier version/)
    // A later version than the report's own.
    expect(await insertReport({ ...partial, fai_baseline_version_id: V2 }, V1)).toMatch(/not an earlier version/)
  })

  it('keeps the type columns once issued, while status and results still change', async () => {
    await actAs(db, ALICE)
    const r = await db.query<{ id: string }>(
      `SELECT id FROM inspection_report WHERE report_type = 'production' LIMIT 1`,
    )
    const id = r.rows[0].id
    await db.query(
      `UPDATE inspection_report SET status = 'sent', report_type = 'fai', fai_scope = 'full', lot_number = 'X',
              lot_size = 99, sampling = '{"plan":"100"}', characteristic_ids = NULL WHERE id = $1`,
      [id],
    )
    const after = await db.query<Record<string, unknown>>(
      `SELECT status, report_type, fai_scope, lot_number, lot_size, sampling FROM inspection_report WHERE id = $1`,
      [id],
    )
    expect(after.rows[0]).toEqual({
      status: 'sent',
      report_type: 'production',
      fai_scope: null,
      lot_number: 'L-7',
      lot_size: 40,
      sampling: { plan: 'fixed', n: 5 },
    })
  })

  it('lets the baseline go away with its version only: a client can neither clear nor repoint it', async () => {
    await actAs(db, ALICE)
    const r = await db.query<{ id: string }>(
      `SELECT id FROM inspection_report WHERE fai_baseline_version_id = $1`,
      [V1],
    )
    const id = r.rows[0].id
    const baseline = async () =>
      (await db.query<{ b: string | null }>(`SELECT fai_baseline_version_id AS b FROM inspection_report WHERE id = $1`, [id]))
        .rows[0].b
    await db.query(`UPDATE inspection_report SET fai_baseline_version_id = $2 WHERE id = $1`, [id, V2])
    expect(await baseline()).toBe(V1)
    await db.query(`UPDATE inspection_report SET fai_baseline_version_id = NULL WHERE id = $1`, [id])
    expect(await baseline()).toBe(V1)
    // The version is deleted: ON DELETE SET NULL clears it.
    await actAsOwner(db)
    await db.query(`DELETE FROM file_version WHERE id = $1`, [V1])
    await actAs(db, ALICE)
    expect(await baseline()).toBeNull()
  })
})

describe('inspection_template report types and defaults', () => {
  async function defaults(): Promise<Record<string, string[]>> {
    const r = await db.query<{ id: string; default_for: string[] }>(
      `SELECT id, default_for FROM inspection_template ORDER BY id`,
    )
    return Object.fromEntries(r.rows.map((row) => [row.id, row.default_for]))
  }

  it('starts with no types (serves any) and no type defaults', async () => {
    await actAs(db, ADMIN)
    await db.query(
      `INSERT INTO inspection_template (id, org_id, name, storage_hash, file_size) VALUES
         ($1, $3, 'General', $4, 1), ($2, $3, 'FAI', $4, 1)`,
      [T1, T2, ORG_A, H_TEMPLATE],
    )
    const r = await db.query<{ report_types: string[]; default_for: string[] }>(
      `SELECT report_types, default_for FROM inspection_template WHERE id = $1`,
      [T1],
    )
    expect(r.rows[0]).toEqual({ report_types: [], default_for: [] })
  })

  it('keeps one default per type: claiming a type takes it from the other template', async () => {
    await actAs(db, ADMIN)
    await db.query(`UPDATE inspection_template SET default_for = '{production,fai,fai}' WHERE id = $1`, [T1])
    expect(await defaults()).toEqual({ [T1]: ['fai', 'production'], [T2]: [] })
    await db.query(
      `UPDATE inspection_template SET report_types = '{fai}', default_for = '{fai}' WHERE id = $1`,
      [T2],
    )
    expect(await defaults()).toEqual({ [T1]: ['production'], [T2]: ['fai'] })
  })

  it('is the default only for types it serves, and never while archived', async () => {
    await actAs(db, ADMIN)
    // Claiming a type it does not serve keeps only what it serves.
    await db.query(`UPDATE inspection_template SET default_for = '{production,fai}' WHERE id = $1`, [T2])
    expect(await defaults()).toEqual({ [T1]: ['production'], [T2]: ['fai'] })
    // Narrowing its types drops the defaults it no longer serves.
    await db.query(`UPDATE inspection_template SET report_types = '{production}' WHERE id = $1`, [T1])
    expect(await defaults()).toEqual({ [T1]: ['production'], [T2]: ['fai'] })
    await db.query(`UPDATE inspection_template SET report_types = '{receiving}' WHERE id = $1`, [T1])
    expect(await defaults()).toEqual({ [T1]: [], [T2]: ['fai'] })
    // Archiving (as 5.5.0 does: archived_at and is_default only) ends its defaults.
    expect(
      await error(`UPDATE inspection_template SET is_default = false, archived_at = now() WHERE id = $1`, [T2]),
    ).toBeNull()
    expect(await defaults()).toEqual({ [T1]: [], [T2]: [] })
    await db.query(`UPDATE inspection_template SET archived_at = NULL, default_for = '{fai}' WHERE id = $1`, [T2])
    // A direct write that skips the trigger's cleanup is still held by the check.
    await actAsOwner(db)
    await db.exec('ALTER TABLE inspection_template DISABLE TRIGGER trg_inspection_template_defaults')
    expect(await error(`UPDATE inspection_template SET archived_at = now() WHERE id = $1`, [T2])).toMatch(
      /violates check constraint/,
    )
    await db.exec('ALTER TABLE inspection_template ENABLE TRIGGER trg_inspection_template_defaults')
    await actAs(db, ADMIN)
    expect(await error(`UPDATE inspection_template SET report_types = '{special}' WHERE id = $1`, [T1])).toMatch(
      /violates check constraint/,
    )
  })

  it('leaves template defaults to administrators (the 0504 policies)', async () => {
    await actAs(db, ALICE)
    await db.query(`UPDATE inspection_template SET default_for = '{production}' WHERE id = $1`, [T2])
    await actAs(db, ADMIN)
    expect(await defaults()).toEqual({ [T1]: [], [T2]: ['fai'] })
  })
})
