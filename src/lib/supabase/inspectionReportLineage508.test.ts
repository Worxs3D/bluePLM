/**
 * supabase/migrations/0508_inspection_report_lineage.sql on real Postgres (PGlite), applied after
 * 0501-0507 to the 5.0 baseline as the migration runner applies them: it stamps 508; a report may
 * name the report of the same drawing it replaces, never another drawing's or itself; the link is
 * fixed once issued and is cleared only when the replaced report is deleted.
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
const W1 = '51000000-0000-0000-0000-000000000003' // F2 v1
const R1 = '70000000-0000-0000-0000-000000000001' // F1, replaces nothing
const R2 = '70000000-0000-0000-0000-000000000002' // F1, replaces R1
const R3 = '70000000-0000-0000-0000-000000000003' // F1, replaces nothing
const RW = '70000000-0000-0000-0000-000000000009' // F2
const H_F = '1'.repeat(64)
const H_REPORT = '2'.repeat(64) // Alice's upload

const MIGRATION_FILES = [
  '0501_server_backups.sql',
  '0502_security_hardening.sql',
  '0503_vault_object_issues.sql',
  '0504_inspection_tables.sql',
  '0505_version_outputs.sql',
  '0506_inspection_report_types.sql',
  '0507_version_output_delete.sql',
  '0508_inspection_report_lineage.sql',
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

/** Insert a report as Alice; returns the error text or null. */
async function insertReport(
  id: string,
  supersedes: string | null,
  file = F1,
  version = V1,
): Promise<string | null> {
  await actAs(db, ALICE)
  numberSeq++
  return error(
    `INSERT INTO inspection_report (id, org_id, file_id, file_version_id, report_number, storage_hash, file_size, supersedes_report_id)
     VALUES ($1, $2, $3, $4, $5, $6, 10, $7)`,
    [id, ORG_A, file, version, `R-${numberSeq}`, H_REPORT, supersedes],
  )
}

async function supersedesOf(id: string): Promise<string | null> {
  await actAsOwner(db)
  const r = await db.query<{ s: string | null }>(
    'SELECT supersedes_report_id AS s FROM inspection_report WHERE id = $1',
    [id],
  )
  return r.rows[0].s
}

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
      ('${F1}', '${ORG_A}', '${VA1}', 'a1/one.slddrw', 'one.slddrw', '.slddrw', '${H_F}', 1, '${ADMIN}'),
      ('${F2}', '${ORG_A}', '${VA1}', 'a1/two.slddrw', 'two.slddrw', '.slddrw', '${H_F}', 1, '${ADMIN}');
    INSERT INTO file_version (id, file_id, version, revision, content_hash, created_by, created_at) VALUES
      ('${V1}', '${F1}', 1, 'A', '${H_F}', '${ADMIN}', '2020-01-01'),
      ('${W1}', '${F2}', 1, 'A', '${H_F}', '${ADMIN}', '2020-01-01');
    INSERT INTO storage.objects (bucket_id, name, owner, owner_id) VALUES
      ('vault', '${objectName(H_REPORT)}', '${ALICE}', '${ALICE}');
    `,
  )
}, 240_000)

afterAll(async () => {
  await db?.close()
})

describe('supabase/migrations/0508_inspection_report_lineage.sql', () => {
  it('follows the runner contract and stamps 508', async () => {
    const sql = readSql(resolve(MIGRATIONS, '0508_inspection_report_lineage.sql'))
    expect(sql).not.toMatch(/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/im)
    expect(sql).toContain('LANGUAGE sql IMMUTABLE AS $$ SELECT 508 $$;')
    // No client-facing policy or function: the vault rule and backups are unchanged.
    expect(sql).not.toMatch(/CREATE POLICY/)
    expect(sql).not.toMatch(/schema_function_inventory/)
    await actAsOwner(db)
    const r = await db.query<{ v: { stamped: boolean; version: number; problems: unknown[] } }>(
      'SELECT verify_and_stamp_schema() AS v',
    )
    expect(r.rows[0].v.problems).toEqual([])
    expect(r.rows[0].v).toMatchObject({ stamped: true, version: 508 })
  }, 600_000)
})

describe('inspection_report.supersedes_report_id', () => {
  it('accepts a report that replaces nothing and one that replaces a report of the same drawing', async () => {
    expect(await insertReport(R1, null)).toBeNull()
    expect(await insertReport(R2, R1)).toBeNull()
    expect(await supersedesOf(R1)).toBeNull()
    expect(await supersedesOf(R2)).toBe(R1)
  })

  it("refuses another drawing's report and the report itself", async () => {
    expect(await insertReport(RW, null, F2, W1)).toBeNull()
    expect(await insertReport('70000000-0000-0000-0000-000000000010', RW)).toMatch(/not a report of this drawing/)
    const self = '70000000-0000-0000-0000-000000000011'
    expect(await insertReport(self, self)).toMatch(/cannot replace itself/)
  })

  it('cannot be repointed or cleared after insert', async () => {
    expect(await insertReport(R3, null)).toBeNull()
    await actAs(db, ALICE)
    expect(await error('UPDATE inspection_report SET supersedes_report_id = $1 WHERE id = $2', [R3, R2])).toBeNull()
    expect(await supersedesOf(R2)).toBe(R1)
    await actAs(db, ALICE)
    expect(await error('UPDATE inspection_report SET supersedes_report_id = NULL WHERE id = $1', [R2])).toBeNull()
    expect(await supersedesOf(R2)).toBe(R1)
    await actAs(db, ALICE)
    expect(await error('UPDATE inspection_report SET supersedes_report_id = $1 WHERE id = $2', [R1, R3])).toBeNull()
    expect(await supersedesOf(R3)).toBeNull()
  })

  it('is cleared when the replaced report is deleted', async () => {
    await actAs(db, ALICE)
    expect(await error('DELETE FROM inspection_report WHERE id = $1', [R1])).toBeNull()
    await actAsOwner(db)
    const gone = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM inspection_report WHERE id = $1', [R1])
    expect(gone.rows[0].n).toBe(0)
    expect(await supersedesOf(R2)).toBeNull()
  })
})
