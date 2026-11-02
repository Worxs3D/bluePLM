/**
 * supabase/migrations/0504_inspection_tables.sql on real Postgres (PGlite), applied after 0501-0503
 * to the 5.0 baseline as the migration runner applies them: it stamps 504; file_checkin() copies
 * tolerance_source into the snapshot; templates are read by members and written by administrators
 * only; reports follow their file's vault, need explorer edit to write, and carry the actor the
 * database sets; report and template content is readable exactly through a readable row; server
 * backups export both tables.
 */
import type { PGlite } from '@electric-sql/pglite'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { actAs, actAsOwner, bootBaseline, MIGRATIONS, readSql, seed } from './testing/schemaDb'

const ORG_A = '00000000-0000-0000-0000-00000000000a'
const ORG_B = '00000000-0000-0000-0000-00000000000b'
const ADMIN = '00000000-0000-0000-0000-000000000001'
const ALICE = '00000000-0000-0000-0000-000000000002' // vault VA1, explorer edit
const CAROL = '00000000-0000-0000-0000-000000000003' // explorer edit, no vault
const DAVE = '00000000-0000-0000-0000-000000000004' // vault VA1, no explorer edit
const OTHER_ADMIN = '00000000-0000-0000-0000-000000000005' // admin of org B
const EDITORS = '30000000-0000-0000-0000-000000000001'
const VA1 = '40000000-0000-0000-0000-000000000001'
const F1 = '50000000-0000-0000-0000-000000000001' // a drawing in VA1
const F2 = '50000000-0000-0000-0000-000000000002' // another drawing in VA1
const V1 = '51000000-0000-0000-0000-000000000001' // F1 v1
const V2 = '51000000-0000-0000-0000-000000000002' // F2 v1
const H_F1 = '1'.repeat(64)
const H_F1_NEW = '2'.repeat(64)
const H_F2 = '3'.repeat(64)
const H_REPORT = '4'.repeat(64)
const H_RETURNED = '5'.repeat(64)
const H_PDF = '6'.repeat(64)
const H_TEMPLATE = '7'.repeat(64)
const H_TEMPLATE_2 = '8'.repeat(64)
const H_SECRET = '9'.repeat(64) // a file in VA2, which Alice cannot see
const VA2 = '40000000-0000-0000-0000-000000000002'
const FS = '50000000-0000-0000-0000-000000000003'

const MIGRATION_FILES = [
  '0501_server_backups.sql',
  '0502_security_hardening.sql',
  '0503_vault_object_issues.sql',
  '0504_inspection_tables.sql',
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

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const r = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM (${sql}) x`, params)
  return r.rows[0].n
}

const objectName = (hash: string) => `${ORG_A}/${hash.slice(0, 2)}/${hash}`

beforeAll(async () => {
  db = await bootBaseline()
  await actAsOwner(db)
  for (const m of MIGRATION_FILES) await db.exec(readSql(resolve(MIGRATIONS, m)))
  const user = (id: string, email: string, org: string, role: string) =>
    `('${id}', '${email}', '${org}', '${role}')`
  await seed(
    db,
    `
    INSERT INTO organization (id, name, slug) VALUES ('${ORG_A}', 'A', 'org-a'), ('${ORG_B}', 'B', 'org-b');
    INSERT INTO app_user (id, email, org_id, role) VALUES
      ${user(ADMIN, 'admin@a.test', ORG_A, 'admin')},
      ${user(ALICE, 'alice@a.test', ORG_A, 'engineer')},
      ${user(CAROL, 'carol@a.test', ORG_A, 'engineer')},
      ${user(DAVE, 'dave@a.test', ORG_A, 'engineer')},
      ${user(OTHER_ADMIN, 'other@b.test', ORG_B, 'admin')};
    INSERT INTO team (id, org_id, name) VALUES ('${EDITORS}', '${ORG_A}', 'Editors');
    INSERT INTO team_member (team_id, user_id) VALUES ('${EDITORS}', '${ALICE}'), ('${EDITORS}', '${CAROL}');
    INSERT INTO team_permission (team_id, resource, actions) VALUES ('${EDITORS}', 'module:explorer', '{view,create,edit,delete}');
    INSERT INTO vault (id, org_id, name, slug) VALUES ('${VA1}', '${ORG_A}', 'A1', 'a1'), ('${VA2}', '${ORG_A}', 'A2', 'a2');
    INSERT INTO vault_access (vault_id, user_id) VALUES ('${VA1}', '${ALICE}'), ('${VA1}', '${DAVE}');
    INSERT INTO file (id, org_id, vault_id, file_path, file_name, extension, content_hash, version, created_by,
                      checked_out_by, checked_out_at) VALUES
      ('${F1}', '${ORG_A}', '${VA1}', 'a1/one.slddrw', 'one.slddrw', '.slddrw', '${H_F1}', 1, '${ADMIN}', '${ALICE}', now() - interval '1 minute'),
      ('${F2}', '${ORG_A}', '${VA1}', 'a1/two.slddrw', 'two.slddrw', '.slddrw', '${H_F2}', 1, '${ADMIN}', NULL, NULL),
      ('${FS}', '${ORG_A}', '${VA2}', 'a2/secret.sldprt', 'secret.sldprt', '.sldprt', '${H_SECRET}', 1, '${ADMIN}', NULL, NULL);
    INSERT INTO drawing_pdf_render (org_id, file_id, file_version_id, storage_hash, file_size)
      VALUES ('${ORG_A}', '${F2}', '${V2}', '${H_PDF}', 1);
    INSERT INTO file_version (id, file_id, version, revision, content_hash, created_by, created_at) VALUES
      ('${V1}', '${F1}', 1, 'A', '${H_F1}', '${ADMIN}', '2020-01-01'),
      ('${V2}', '${F2}', 1, 'A', '${H_F2}', '${ADMIN}', '2020-01-01');
    INSERT INTO inspection_characteristic (org_id, file_id, sort_order, balloon_number, nominal_value, plus_tolerance, minus_tolerance, tolerance_source)
      VALUES ('${ORG_A}', '${F1}', 0, '1', '10.00', '0.1', '0.1', 'general'),
             ('${ORG_A}', '${F1}', 1, '2', '5.00', '0.05', '0.05', 'drawing');
    INSERT INTO storage.objects (bucket_id, name, owner, owner_id) VALUES
      ('vault', '${objectName(H_REPORT)}', '${ALICE}', '${ALICE}'),
      ('vault', '${objectName(H_SECRET)}', '${ADMIN}', '${ADMIN}'),
      ('vault', '${objectName(H_RETURNED)}', '${ALICE}', '${ALICE}'),
      ('vault', '${objectName(H_PDF)}', '${ADMIN}', '${ADMIN}'),
      ('vault', '${objectName(H_TEMPLATE)}', '${ADMIN}', '${ADMIN}');
    `,
  )
}, 240_000)

afterAll(async () => {
  await db?.close()
})

describe('supabase/migrations/0504_inspection_tables.sql', () => {
  it('follows the runner contract and stamps 504', async () => {
    const sql = readSql(resolve(MIGRATIONS, '0504_inspection_tables.sql'))
    expect(sql).not.toMatch(/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/im)
    expect(sql).toContain('LANGUAGE sql IMMUTABLE AS $$ SELECT 504 $$;')
    await actAsOwner(db)
    const r = await db.query<{ v: { stamped: boolean; version: number; problems: unknown[] } }>(
      'SELECT verify_and_stamp_schema() AS v',
    )
    expect(r.rows[0].v.problems).toEqual([])
    expect(r.rows[0].v).toMatchObject({ stamped: true, version: 504 })
  }, 600_000)

  it('redefines file_checkin() changing only the snapshot columns', () => {
    const pick = (sql: string) => {
      const m = sql.match(/CREATE OR REPLACE FUNCTION file_checkin\([\s\S]*?\n\$\$;/)
      if (!m) throw new Error('file_checkin not found')
      return m[0]
    }
    const base = pick(readSql(resolve(MIGRATIONS, '../modules/10-source-files.sql')))
    const ours = pick(readSql(resolve(MIGRATIONS, '0504_inspection_tables.sql')))
    expect(ours).toBe(
      base.replace(
        /source_key, source_sheet, source_view\n/g,
        'source_key, source_sheet, source_view, tolerance_source\n',
      ),
    )
    expect(ours).not.toBe(base)
  })

  it('exports both tables in server backups, on top of 0501 list', async () => {
    const tables = (file: string) =>
      [...readSql(resolve(MIGRATIONS, file)).matchAll(/WHEN '([a-z_]+)' THEN '/g)]
        .map((m) => m[1])
        .sort()
    expect(tables('0504_inspection_tables.sql')).toEqual(
      [...tables('0501_server_backups.sql'), 'inspection_report', 'inspection_template'].sort(),
    )
    await actAsOwner(db)
    await db.exec('SET ROLE service_role')
    for (const t of ['inspection_report', 'inspection_template']) {
      const r = await db.query<{ p: { missing: boolean } }>(
        `SELECT backup_list_org_rows($1, $2, NULL, 10) AS p`,
        [ORG_A, t],
      )
      expect(r.rows[0].p.missing).toBe(false)
    }
    await actAsOwner(db)
  })

  it('accepts only drawing or general as a tolerance source', async () => {
    await actAsOwner(db)
    expect(
      await error(
        `UPDATE inspection_characteristic SET tolerance_source = 'guess' WHERE file_id = $1`,
        [F1],
      ),
    ).toMatch(/tolerance_source_check/)
  })

  it('copies tolerance_source into the snapshot at check-in', async () => {
    await actAs(db, ALICE)
    const r = await db.query<{ r: { success: boolean; new_version: number; error?: string } }>(
      `SELECT file_checkin($1, $2, 10) AS r`,
      [F1, H_F1_NEW],
    )
    expect(r.rows[0].r).toMatchObject({ success: true, new_version: 2 })
    const snap = await db.query<{ balloon_number: string; tolerance_source: string | null }>(
      `SELECT s.balloon_number, s.tolerance_source FROM inspection_characteristic_version s
         JOIN file_version v ON v.id = s.file_version_id WHERE v.file_id = $1 AND v.version = 2 ORDER BY s.sort_order`,
      [F1],
    )
    expect(snap.rows).toEqual([
      { balloon_number: '1', tolerance_source: 'general' },
      { balloon_number: '2', tolerance_source: 'drawing' },
    ])
  })
})

describe('inspection_template', () => {
  let first: string

  it('lets only administrators write, and stamps the administrator', async () => {
    await actAs(db, ALICE)
    expect(
      await error(
        `INSERT INTO inspection_template (org_id, name, storage_hash, file_size) VALUES ($1, 'Mine', $2, 1)`,
        [ORG_A, H_TEMPLATE],
      ),
    ).toMatch(/row-level security|not uploaded by you/)
    // Even with content she uploaded herself, RLS refuses a non-administrator.
    expect(
      await error(
        `INSERT INTO inspection_template (org_id, name, storage_hash, file_size) VALUES ($1, 'Mine', $2, 1)`,
        [ORG_A, H_REPORT],
      ),
    ).toMatch(/row-level security/)

    await actAs(db, ADMIN)
    const r = await db.query<{ id: string; created_by: string; updated_by: string }>(
      `INSERT INTO inspection_template (org_id, name, storage_hash, file_size, is_default, created_by, updated_by)
       VALUES ($1, 'Standard', $2, 100, true, $3, $3) RETURNING id, created_by, updated_by`,
      [ORG_A, H_TEMPLATE, ALICE],
    )
    expect(r.rows[0]).toMatchObject({ created_by: ADMIN, updated_by: ADMIN })
    first = r.rows[0].id

    await actAs(db, ALICE)
    expect(
      (await db.query(`UPDATE inspection_template SET name = 'Hijacked' WHERE id = $1`, [first]))
        .affectedRows ?? 0,
    ).toBe(0)
    expect(
      (await db.query(`DELETE FROM inspection_template WHERE id = $1`, [first])).affectedRows ?? 0,
    ).toBe(0)
  })

  it('is read by members of the organization only', async () => {
    await actAs(db, CAROL)
    expect(await count(`SELECT id FROM inspection_template`)).toBe(1)
    await actAs(db, OTHER_ADMIN)
    expect(await count(`SELECT id FROM inspection_template`)).toBe(0)
  })

  it('keeps one default, unique live names, and no archived default', async () => {
    await actAs(db, ADMIN)
    const second = await db.query<{ id: string }>(
      `INSERT INTO inspection_template (org_id, name, storage_hash, file_size, is_default)
       VALUES ($1, 'Supplier', $2, 100, true) RETURNING id`,
      [ORG_A, H_TEMPLATE_2],
    )
    const defaults = await db.query<{ id: string }>(
      `SELECT id FROM inspection_template WHERE is_default`,
    )
    expect(defaults.rows.map((d) => d.id)).toEqual([second.rows[0].id])

    expect(
      await error(
        `INSERT INTO inspection_template (org_id, name, storage_hash, file_size) VALUES ($1, ' standard ', $2, 1)`,
        [ORG_A, H_TEMPLATE],
      ),
    ).toMatch(/inspection_template_org_id_name_key/)
    expect(
      await error(`UPDATE inspection_template SET archived_at = now() WHERE id = $1`, [
        second.rows[0].id,
      ]),
    ).toMatch(/inspection_template_is_default_check/)

    // An archived template frees its name.
    await db.query(`UPDATE inspection_template SET archived_at = now() WHERE id = $1`, [first])
    await db.query(
      `INSERT INTO inspection_template (org_id, name, storage_hash, file_size) VALUES ($1, 'Standard', $2, 1)`,
      [ORG_A, H_TEMPLATE],
    )
  })
})

describe('inspection_report', () => {
  let report: string
  const insert = `INSERT INTO inspection_report (org_id, file_id, file_version_id, storage_hash, file_size, drawing_pdf_hash, created_by, updated_by)
                  VALUES ($1, $2, $3, $4, 10, $5, $6, $6) RETURNING id, created_by, updated_by`

  it('stamps the creator from the session, whatever the client sends', async () => {
    await actAs(db, ALICE)
    const r = await db.query<{ id: string; created_by: string; updated_by: string }>(insert, [
      ORG_A,
      F2,
      V2,
      H_REPORT,
      H_PDF,
      CAROL,
    ])
    expect(r.rows[0]).toMatchObject({ created_by: ALICE, updated_by: ALICE })
    report = r.rows[0].id
  })

  it('refuses a version of another file', async () => {
    await actAs(db, ALICE)
    expect(await error(insert, [ORG_A, F2, V1, H_REPORT, H_PDF, ALICE])).toMatch(
      /does not belong to this file/,
    )
  })

  it('needs explorer edit and the vault to write', async () => {
    await actAs(db, DAVE)
    expect(await error(insert, [ORG_A, F2, V2, H_REPORT, H_PDF, DAVE])).toMatch(
      /row-level security/,
    )
    await actAs(db, CAROL)
    expect(await error(insert, [ORG_A, F2, V2, H_REPORT, H_PDF, CAROL])).toMatch(
      /row-level security|does not belong/,
    )
  })

  it("refuses to name another vault's content, on insert and on update", async () => {
    await actAs(db, ALICE)
    // Alice cannot read the secret before, and must not be able to make it readable.
    expect(
      await count(`SELECT id FROM storage.objects WHERE name = $1`, [objectName(H_SECRET)]),
    ).toBe(0)
    expect(await error(insert, [ORG_A, F2, V2, H_SECRET, H_PDF, ALICE])).toMatch(
      /not uploaded by you/,
    )
    expect(await error(insert, [ORG_A, F2, V2, H_REPORT, H_SECRET, ALICE])).toMatch(
      /not the stored PDF of this drawing version/,
    )
    for (const column of ['storage_hash', 'returned_hash']) {
      expect(
        await error(`UPDATE inspection_report SET ${column} = $2 WHERE id = $1`, [
          report,
          H_SECRET,
        ]),
      ).toMatch(/not uploaded by you/)
    }
    expect(
      await error(`UPDATE inspection_report SET drawing_pdf_hash = $2 WHERE id = $1`, [
        report,
        H_SECRET,
      ]),
    ).toMatch(/not the stored PDF/)
    expect(
      await count(`SELECT id FROM storage.objects WHERE name = $1`, [objectName(H_SECRET)]),
    ).toBe(0)
    // A template is an administrator's, who reads every object anyway; nobody else may write one.
    await actAs(db, CAROL)
    expect(
      await count(`SELECT id FROM storage.objects WHERE name = $1`, [objectName(H_SECRET)]),
    ).toBe(0)
  })

  it('uses a report number once per drawing', async () => {
    await actAs(db, ALICE)
    const numbered = `INSERT INTO inspection_report (org_id, file_id, file_version_id, storage_hash, file_size, report_number)
                      VALUES ($1, $2, $3, $4, 10, 'IR-0001') RETURNING id`
    const r = await db.query<{ id: string }>(numbered, [ORG_A, F2, V2, H_REPORT])
    expect(await error(numbered, [ORG_A, F2, V2, H_REPORT])).toMatch(
      /inspection_report_file_id_report_number_key/,
    )
    await db.query(`DELETE FROM inspection_report WHERE id = $1`, [r.rows[0].id])
  })

  it('keeps what the report is about and stamps the returned workbook', async () => {
    await actAs(db, ALICE)
    await db.query(
      `UPDATE inspection_report SET file_id = $2, file_version_id = $3, created_by = $4, returned_hash = $5, status = 'returned',
              returned_by = $4 WHERE id = $1`,
      [report, F1, V1, CAROL, H_RETURNED],
    )
    const r = await db.query<Record<string, string | null>>(
      `SELECT file_id, file_version_id, created_by, updated_by, returned_by, returned_at IS NOT NULL AS has_returned_at, status
         FROM inspection_report WHERE id = $1`,
      [report],
    )
    expect(r.rows[0]).toMatchObject({
      file_id: F2,
      file_version_id: V2,
      created_by: ALICE,
      updated_by: ALICE,
      returned_by: ALICE,
      has_returned_at: true,
      status: 'returned',
    })
  })

  it('is read only with the vault, and so is its content', async () => {
    await actAs(db, ALICE)
    expect(await count(`SELECT id FROM inspection_report`)).toBe(1)
    for (const h of [H_REPORT, H_RETURNED, H_PDF]) {
      expect(await count(`SELECT id FROM storage.objects WHERE name = $1`, [objectName(h)])).toBe(1)
    }
    await actAs(db, CAROL)
    expect(await count(`SELECT id FROM inspection_report`)).toBe(0)
    for (const h of [H_REPORT, H_RETURNED, H_PDF]) {
      expect(await count(`SELECT id FROM storage.objects WHERE name = $1`, [objectName(h)])).toBe(0)
    }
    // A template's workbook is the organization's.
    expect(
      await count(`SELECT id FROM storage.objects WHERE name = $1`, [objectName(H_TEMPLATE)]),
    ).toBe(1)
    await actAs(db, OTHER_ADMIN)
    expect(await count(`SELECT id FROM inspection_report`)).toBe(0)
  })

  it('is deleted only by its creator or an administrator', async () => {
    await actAs(db, DAVE)
    expect(
      (await db.query(`DELETE FROM inspection_report WHERE id = $1`, [report])).affectedRows ?? 0,
    ).toBe(0)
    await actAs(db, ALICE)
    expect(
      (await db.query(`DELETE FROM inspection_report WHERE id = $1`, [report])).affectedRows,
    ).toBe(1)
  })

  it('names the vault rule in every read policy', async () => {
    await actAsOwner(db)
    const r = await db.query<{ policyname: string }>(
      `SELECT policyname FROM pg_policies WHERE tablename = 'inspection_report' AND cmd IN ('SELECT', 'ALL')
          AND COALESCE(qual, '') NOT LIKE '%my_accessible_vault_ids()%'`,
    )
    expect(r.rows).toEqual([])
    const anon = await db.query<{ ok: boolean }>(
      `SELECT has_table_privilege('anon', 'inspection_report', 'SELECT') OR has_table_privilege('anon', 'inspection_template', 'SELECT') AS ok`,
    )
    expect(anon.rows[0].ok).toBe(false)
  })
})
