/**
 * supabase/migrations/0507_version_output_delete.sql on real Postgres (PGlite), applied after
 * 0501-0506 to the 5.0 baseline as the migration runner applies them: it stamps 507; a drawing PDF
 * or an export is deleted only through its delete function, by an administrator or the user who
 * generated it (with explorer edit), inside the file's vault; a drawing PDF of a version in an
 * open review is kept.
 */
import type { PGlite } from '@electric-sql/pglite'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { actAs, actAsOwner, bootBaseline, MIGRATIONS, readSql, seed } from './testing/schemaDb'

const ORG_A = '00000000-0000-0000-0000-00000000000a'
const ADMIN = '00000000-0000-0000-0000-000000000001'
const ALICE = '00000000-0000-0000-0000-000000000002' // vault VA1, explorer edit, generated the outputs
const BOB = '00000000-0000-0000-0000-000000000003' // vault VA1, explorer edit
const CAROL = '00000000-0000-0000-0000-000000000004' // explorer edit, no vault
const EDITORS = '30000000-0000-0000-0000-000000000001'
const VA1 = '40000000-0000-0000-0000-000000000001'
const VA2 = '40000000-0000-0000-0000-000000000002'
const F1 = '50000000-0000-0000-0000-000000000001' // a drawing in VA1
const V1 = '51000000-0000-0000-0000-000000000001' // F1 v1
const V2 = '51000000-0000-0000-0000-000000000002' // F1 v2, in an open review
const PDF1 = '60000000-0000-0000-0000-000000000001'
const PDF2 = '60000000-0000-0000-0000-000000000002'
const STEP1 = '61000000-0000-0000-0000-000000000001'
const STEP2 = '61000000-0000-0000-0000-000000000002'
const R1 = '70000000-0000-0000-0000-000000000001'
const H = (n: number) => String(n).repeat(64)

const MIGRATION_FILES = [
  '0501_server_backups.sql',
  '0502_security_hardening.sql',
  '0503_vault_object_issues.sql',
  '0504_inspection_tables.sql',
  '0505_version_outputs.sql',
  '0506_inspection_report_types.sql',
  '0507_version_output_delete.sql',
]

let db: PGlite

async function error(sql: string, params: unknown[] = []): Promise<string | null> {
  try {
    await db.query(sql, params)
    return null
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

async function exists(table: string, id: string): Promise<boolean> {
  await actAsOwner(db)
  const r = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} WHERE id = $1`, [id])
  return r.rows[0].n === 1
}

beforeAll(async () => {
  db = await bootBaseline()
  await actAsOwner(db)
  for (const m of MIGRATION_FILES) await db.exec(readSql(resolve(MIGRATIONS, m)))
  const user = (id: string, email: string, role: string) => `('${id}', '${email}', '${ORG_A}', '${role}')`
  await seed(
    db,
    `
    INSERT INTO organization (id, name, slug) VALUES ('${ORG_A}', 'A', 'org-a');
    INSERT INTO app_user (id, email, org_id, role) VALUES
      ${user(ADMIN, 'admin@a.test', 'admin')},
      ${user(ALICE, 'alice@a.test', 'engineer')},
      ${user(BOB, 'bob@a.test', 'engineer')},
      ${user(CAROL, 'carol@a.test', 'engineer')};
    INSERT INTO team (id, org_id, name) VALUES ('${EDITORS}', '${ORG_A}', 'Editors');
    INSERT INTO team_member (team_id, user_id) VALUES ('${EDITORS}', '${ALICE}'), ('${EDITORS}', '${BOB}'), ('${EDITORS}', '${CAROL}');
    INSERT INTO team_permission (team_id, resource, actions) VALUES ('${EDITORS}', 'module:explorer', '{view,create,edit,delete}');
    INSERT INTO vault (id, org_id, name, slug) VALUES ('${VA1}', '${ORG_A}', 'A1', 'a1'), ('${VA2}', '${ORG_A}', 'A2', 'a2');
    INSERT INTO vault_access (vault_id, user_id) VALUES ('${VA1}', '${ALICE}'), ('${VA1}', '${BOB}');
    INSERT INTO file (id, org_id, vault_id, file_path, file_name, extension, content_hash, version, created_by) VALUES
      ('${F1}', '${ORG_A}', '${VA1}', 'a1/one.slddrw', 'one.slddrw', '.slddrw', '${H(1)}', 2, '${ADMIN}');
    INSERT INTO file_version (id, file_id, version, revision, content_hash, created_by, created_at) VALUES
      ('${V1}', '${F1}', 1, 'A', '${H(1)}', '${ADMIN}', '2020-01-01'),
      ('${V2}', '${F1}', 2, 'A', '${H(2)}', '${ADMIN}', '2020-01-02');
    INSERT INTO drawing_pdf_render (id, org_id, file_id, file_version_id, storage_hash, file_size, generated_by) VALUES
      ('${PDF1}', '${ORG_A}', '${F1}', '${V1}', '${H(3)}', 10, '${ALICE}'),
      ('${PDF2}', '${ORG_A}', '${F1}', '${V2}', '${H(4)}', 10, '${ALICE}');
    INSERT INTO file_version_output (id, org_id, file_id, file_version_id, kind, storage_hash, file_size, file_name, generated_by) VALUES
      ('${STEP1}', '${ORG_A}', '${F1}', '${V1}', 'dxf', '${H(5)}', 10, 'one.dxf', '${ALICE}'),
      ('${STEP2}', '${ORG_A}', '${F1}', '${V2}', 'dxf', '${H(6)}', 10, 'one.dxf', '${ALICE}');
    INSERT INTO review (id, org_id, requested_by, title) VALUES ('${R1}', '${ORG_A}', '${ADMIN}', 'Review');
    INSERT INTO review_item (org_id, review_id, file_id, file_version_id) VALUES ('${ORG_A}', '${R1}', '${F1}', '${V2}');
    `,
  )
}, 240_000)

afterAll(async () => {
  await db?.close()
})

describe('supabase/migrations/0507_version_output_delete.sql', () => {
  it('follows the runner contract and stamps 507', async () => {
    const sql = readSql(resolve(MIGRATIONS, '0507_version_output_delete.sql'))
    expect(sql).not.toMatch(/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/im)
    expect(sql).toContain('LANGUAGE sql IMMUTABLE AS $$ SELECT 507 $$;')
    await actAsOwner(db)
    const r = await db.query<{ v: { stamped: boolean; version: number; problems: unknown[] } }>(
      'SELECT verify_and_stamp_schema() AS v',
    )
    expect(r.rows[0].v.problems).toEqual([])
    expect(r.rows[0].v).toMatchObject({ stamped: true, version: 507 })
  }, 600_000)
})

describe('drawing_pdf_render_delete() and file_version_output_delete()', () => {
  it("refuses a user without the file's vault", async () => {
    await actAs(db, CAROL)
    expect(await error('SELECT drawing_pdf_render_delete($1)', [PDF1])).not.toBeNull()
    expect(await error('SELECT file_version_output_delete($1)', [STEP1])).not.toBeNull()
    expect(await exists('drawing_pdf_render', PDF1)).toBe(true)
    expect(await exists('file_version_output', STEP1)).toBe(true)
  })

  it('refuses a member who did not generate the output', async () => {
    await actAs(db, BOB)
    expect(await error('SELECT drawing_pdf_render_delete($1)', [PDF1])).toMatch(/administrator or the user who generated/)
    expect(await error('SELECT file_version_output_delete($1)', [STEP1])).toMatch(/administrator or the user who generated/)
  })

  it('keeps a drawing PDF of a version in an open review', async () => {
    await actAs(db, ADMIN)
    expect(await error('SELECT drawing_pdf_render_delete($1)', [PDF2])).toMatch(/open review/)
    expect(await exists('drawing_pdf_render', PDF2)).toBe(true)
  })

  it('lets the generator delete their outputs', async () => {
    await actAs(db, ALICE)
    expect(await error('SELECT drawing_pdf_render_delete($1)', [PDF1])).toBeNull()
    expect(await error('SELECT file_version_output_delete($1)', [STEP1])).toBeNull()
    expect(await exists('drawing_pdf_render', PDF1)).toBe(false)
    expect(await exists('file_version_output', STEP1)).toBe(false)
  })

  it('lets an administrator delete any output, and a closed review no longer holds the PDF', async () => {
    await actAs(db, ADMIN)
    expect(await error('SELECT file_version_output_delete($1)', [STEP2])).toBeNull()
    await actAsOwner(db)
    await db.query(`UPDATE review SET status = 'cancelled' WHERE id = $1`, [R1])
    await actAs(db, ADMIN)
    expect(await error('SELECT drawing_pdf_render_delete($1)', [PDF2])).toBeNull()
    expect(await exists('drawing_pdf_render', PDF2)).toBe(false)
  })

  it('reports an output that is gone', async () => {
    await actAs(db, ADMIN)
    expect(await error('SELECT file_version_output_delete($1)', [STEP1])).toMatch(/Output not found/)
  })

  it('still lets clients write neither table directly', async () => {
    await actAsOwner(db)
    await db.query(
      `INSERT INTO drawing_pdf_render (id, org_id, file_id, file_version_id, storage_hash, file_size, generated_by)
       VALUES ($1, $2, $3, $4, $5, 10, $6)`,
      [PDF1, ORG_A, F1, V1, H(3), ALICE],
    )
    await actAs(db, ALICE)
    expect(await error('DELETE FROM file_version_output')).toMatch(/permission denied/)
    // drawing_pdf_render keeps its table grant but has no write policy: nothing is deleted.
    await db.query('DELETE FROM drawing_pdf_render').catch(() => undefined)
    expect(await exists('drawing_pdf_render', PDF1)).toBe(true)
  })
})
