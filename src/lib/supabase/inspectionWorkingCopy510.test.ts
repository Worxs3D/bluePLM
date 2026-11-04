/**
 * supabase/migrations/0510_inspection_working_copy_reports.sql on real Postgres (PGlite), applied
 * after 0501-0509 to the 5.0 baseline as the migration runner applies them: it stamps 510; a report
 * of a checked-out copy is inserted only by the user who has the drawing checked out and names
 * live inspection rows; its version cannot be changed by a client; inspection_report_pin() points
 * it at the version the check-in made, with that version's snapshot rows; release freezes do not
 * apply to it.
 */
import type { PGlite } from '@electric-sql/pglite'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { actAs, actAsOwner, bootBaseline, MIGRATIONS, readSql, seed } from './testing/schemaDb'

const ORG_A = '00000000-0000-0000-0000-00000000000a'
const ADMIN = '00000000-0000-0000-0000-000000000001'
const ALICE = '00000000-0000-0000-0000-000000000002' // has F1 checked out
const BOB = '00000000-0000-0000-0000-000000000003' // explorer edit, no checkout
const EDITORS = '30000000-0000-0000-0000-000000000001'
const VA1 = '40000000-0000-0000-0000-000000000001'
const F1 = '50000000-0000-0000-0000-000000000001'
const V1 = '51000000-0000-0000-0000-000000000001' // F1 v1 (base), by the admin
const V2 = '51000000-0000-0000-0000-000000000002' // F1 v2, Alice's check-in
const L1 = '60000000-0000-0000-0000-000000000001' // live rows of F1
const L2 = '60000000-0000-0000-0000-000000000002'
const S1 = '61000000-0000-0000-0000-000000000001' // v2 snapshot rows
const S2 = '61000000-0000-0000-0000-000000000002'
const RW = '70000000-0000-0000-0000-000000000001'
const H_F = '1'.repeat(64)
const H_REPORT = '2'.repeat(64) // Alice's upload
const H_PINNED = '3'.repeat(64) // Alice's upload
const H_BOB = '4'.repeat(64) // Bob's upload

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

async function insertWorkingCopy(as: string, id: string, ids: string[] | null, hash = H_REPORT): Promise<string | null> {
  await actAs(db, as)
  numberSeq++
  return error(
    `INSERT INTO inspection_report (id, org_id, file_id, file_version_id, report_number, storage_hash, file_size,
       report_type, characteristic_ids, characteristic_count, working_copy)
     VALUES ($1, $2, $3, $4, $5, $6, 10, 'production', $7::uuid[], $8, true)`,
    [id, ORG_A, F1, V1, `WC-${numberSeq}`, hash, ids, ids?.length ?? 0],
  )
}

async function reportRow(id: string): Promise<{ v: string; wc: boolean; ids: string[] | null; hash: string }> {
  await actAsOwner(db)
  const r = await db.query<{ v: string; wc: boolean; ids: string[] | null; hash: string }>(
    'SELECT file_version_id AS v, working_copy AS wc, characteristic_ids AS ids, storage_hash AS hash FROM inspection_report WHERE id = $1',
    [id],
  )
  return r.rows[0]
}

async function pin(as: string, version: string, ids: string[] | null, hash = H_PINNED): Promise<string | null> {
  await actAs(db, as)
  return error('SELECT inspection_report_pin($1, $2, $3::uuid[], $4, 10, $5, NULL, NULL, $6, NULL)', [RW, version, ids, hash, ids?.length ?? 0, 'Dimensional'])
}

beforeAll(async () => {
  db = await bootBaseline()
  await actAsOwner(db)
  for (const m of MIGRATION_FILES) await db.exec(readSql(resolve(MIGRATIONS, m)))
  const object = (hash: string, owner: string) =>
    `('vault', '${ORG_A}/${hash.slice(0, 2)}/${hash}', '${owner}', '${owner}')`
  await seed(
    db,
    `
    INSERT INTO organization (id, name, slug) VALUES ('${ORG_A}', 'A', 'org-a');
    INSERT INTO app_user (id, email, org_id, role) VALUES
      ('${ADMIN}', 'admin@a.test', '${ORG_A}', 'admin'),
      ('${ALICE}', 'alice@a.test', '${ORG_A}', 'engineer'),
      ('${BOB}', 'bob@a.test', '${ORG_A}', 'engineer');
    INSERT INTO team (id, org_id, name) VALUES ('${EDITORS}', '${ORG_A}', 'Editors');
    INSERT INTO team_member (team_id, user_id) VALUES ('${EDITORS}', '${ALICE}'), ('${EDITORS}', '${BOB}');
    INSERT INTO team_permission (team_id, resource, actions) VALUES ('${EDITORS}', 'module:explorer', '{view,create,edit,delete}');
    INSERT INTO vault (id, org_id, name, slug) VALUES ('${VA1}', '${ORG_A}', 'A1', 'a1');
    INSERT INTO vault_access (vault_id, user_id) VALUES ('${VA1}', '${ALICE}'), ('${VA1}', '${BOB}');
    INSERT INTO file (id, org_id, vault_id, file_path, file_name, extension, content_hash, version, created_by, checked_out_by) VALUES
      ('${F1}', '${ORG_A}', '${VA1}', 'a1/one.slddrw', 'one.slddrw', '.slddrw', '${H_F}', 1, '${ADMIN}', '${ALICE}');
    INSERT INTO file_version (id, file_id, version, revision, content_hash, created_by, created_at, released_at) VALUES
      ('${V1}', '${F1}', 1, 'A', '${H_F}', '${ADMIN}', '2020-01-01', '2020-01-02');
    INSERT INTO inspection_characteristic (id, org_id, file_id, sort_order, balloon_number, source_key) VALUES
      ('${L1}', '${ORG_A}', '${F1}', 0, '1', 'k1'),
      ('${L2}', '${ORG_A}', '${F1}', 1, '2', 'k2');
    INSERT INTO storage.objects (bucket_id, name, owner, owner_id) VALUES
      ${object(H_REPORT, ALICE)}, ${object(H_PINNED, ALICE)}, ${object(H_BOB, BOB)};
    `,
  )
}, 240_000)

afterAll(async () => {
  await db?.close()
})

describe('supabase/migrations/0510_inspection_working_copy_reports.sql', () => {
  it('follows the runner contract and stamps 510', async () => {
    const sql = readSql(resolve(MIGRATIONS, '0510_inspection_working_copy_reports.sql'))
    expect(sql).not.toMatch(/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/im)
    expect(sql).toContain('LANGUAGE sql IMMUTABLE AS $$ SELECT 510 $$;')
    expect(sql).not.toMatch(/CREATE POLICY|CREATE TABLE/)
    await actAsOwner(db)
    const r = await db.query<{ v: { stamped: boolean; version: number; problems: unknown[] } }>(
      'SELECT verify_and_stamp_schema() AS v',
    )
    expect(r.rows[0].v.problems).toEqual([])
    expect(r.rows[0].v).toMatchObject({ stamped: true, version: 510 })
  }, 600_000)
})

describe('inspection_report.working_copy', () => {
  it('is inserted only by the user who has the drawing checked out', async () => {
    expect(await insertWorkingCopy(BOB, '70000000-0000-0000-0000-000000000009', null, H_BOB)).toMatch(/checked out by you/)
  })

  it('names live inspection rows of the drawing, never snapshot rows of another', async () => {
    expect(await insertWorkingCopy(ALICE, '70000000-0000-0000-0000-000000000008', [S1])).toMatch(/not inspection rows/)
    expect(await insertWorkingCopy(ALICE, RW, [L1, L2])).toBeNull()
    expect(await reportRow(RW)).toMatchObject({ v: V1, wc: true, ids: [L1, L2] })
  })

  it('is not frozen by its base version being released, and a client cannot repoint it', async () => {
    await actAs(db, ALICE)
    expect(await error("UPDATE inspection_report SET status = 'sent' WHERE id = $1", [RW])).toBeNull()
    // Content changes and deletes are not frozen by the released base version.
    await actAs(db, ALICE)
    expect(await error('UPDATE inspection_report SET storage_hash = $1 WHERE id = $2', [H_PINNED, RW])).toBeNull()
    const other = '70000000-0000-0000-0000-000000000007'
    expect(await insertWorkingCopy(ALICE, other, null)).toBeNull()
    await actAs(db, ALICE)
    expect(await error('DELETE FROM inspection_report WHERE id = $1', [other])).toBeNull()
    // A recorded report of the released version stays frozen.
    await actAs(db, ALICE)
    numberSeq++
    const frozen = '70000000-0000-0000-0000-000000000006'
    expect(
      await error(
        `INSERT INTO inspection_report (id, org_id, file_id, file_version_id, report_number, storage_hash, file_size)
         VALUES ($1, $2, $3, $4, $5, $6, 10)`,
        [frozen, ORG_A, F1, V1, `R-${numberSeq}`, H_REPORT],
      ),
    ).toBeNull()
    await actAs(db, ALICE)
    expect(await error('DELETE FROM inspection_report WHERE id = $1', [frozen])).toMatch(/released/)
    await actAsOwner(db)
    await db.query(
      `INSERT INTO file_version (id, file_id, version, revision, content_hash, created_by, created_at)
       VALUES ($1, $2, 2, 'A', $3, $4, '2020-02-01')`,
      [V2, F1, H_F, ALICE],
    )
    await actAs(db, ALICE)
    expect(
      await error('UPDATE inspection_report SET file_version_id = $1, working_copy = false WHERE id = $2', [V2, RW]),
    ).toBeNull()
    expect(await reportRow(RW)).toMatchObject({ v: V1, wc: true })
  })
})

describe('inspection_report_pin()', () => {
  it('refuses while the drawing is still checked out and no version was checked in', async () => {
    await actAsOwner(db)
    await db.query('DELETE FROM file_version WHERE id = $1', [V2])
    expect(await pin(ALICE, V1, null)).toMatch(/still checked out/)
  })

  it('refuses another user, the wrong version and rows of another version', async () => {
    await actAsOwner(db)
    await db.query(
      `INSERT INTO file_version (id, file_id, version, revision, content_hash, created_by, created_at)
       VALUES ($1, $2, 2, 'A', $3, $4, '2020-02-01')`,
      [V2, F1, H_F, ALICE],
    )
    await db.query(
      `INSERT INTO inspection_characteristic_version (id, file_version_id, org_id, balloon_number, source_key)
       VALUES ($1, $2, $3, '1', 'k1'), ($4, $2, $3, '2', 'k2')`,
      [S1, V2, ORG_A, S2],
    )
    await db.query('UPDATE file SET checked_out_by = NULL, version = 2 WHERE id = $1', [F1])
    expect(await pin(BOB, V2, [S1, S2], H_BOB)).toMatch(/Only the user who generated/)
    expect(await pin(ALICE, V1, [S1, S2])).toMatch(/another version/)
    expect(await pin(ALICE, V2, [L1, L2])).toMatch(/not inspection rows of this version/)
    expect(await pin(ALICE, V2, [S1, S2], H_BOB)).toMatch(/not uploaded by you/)
    expect(await reportRow(RW)).toMatchObject({ v: V1, wc: true })
  })

  it('points the report at the version its check-in made, once', async () => {
    expect(await pin(ALICE, V2, [S1, S2])).toBeNull()
    expect(await reportRow(RW)).toEqual({ v: V2, wc: false, ids: [S1, S2], hash: H_PINNED })
    expect(await pin(ALICE, V2, [S1, S2])).toMatch(/already a report of a checked-in version/)
  })
})
