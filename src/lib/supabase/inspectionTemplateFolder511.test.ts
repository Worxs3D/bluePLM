/**
 * supabase/migrations/0511_inspection_template_folder.sql on real Postgres (PGlite), applied after
 * 0501-0510 to the 5.0 baseline as the migration runner applies them: it stamps 511; the templates
 * folder's checked-in .xlsx files become organization templates through
 * inspection_template_sync_folder(), which follows new versions, moves and removals; a member
 * without the folder's vault changes nothing; and clients cannot write what the folder owns.
 */
import type { PGlite } from '@electric-sql/pglite'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { actAs, actAsOwner, bootBaseline, MIGRATIONS, readSql, seed } from './testing/schemaDb'

const ORG_A = '00000000-0000-0000-0000-00000000000a'
const ADMIN = '00000000-0000-0000-0000-000000000001'
const ALICE = '00000000-0000-0000-0000-000000000002' // vault VA1
const CAROL = '00000000-0000-0000-0000-000000000004' // no vault
const VA1 = '40000000-0000-0000-0000-000000000001'
const F_FAI = '50000000-0000-0000-0000-000000000001' // _templates/Inspection/FAI.xlsx, v1 and v2
const F_PROD = '50000000-0000-0000-0000-000000000002' // _templates/Inspection/Lot/Production.xlsx
const F_DRW = '50000000-0000-0000-0000-000000000003' // a drawing in the folder (ignored)
const F_OUT = '50000000-0000-0000-0000-000000000004' // an .xlsx outside the folder (ignored)
const F_LOCK = '50000000-0000-0000-0000-000000000005' // an Excel lock file (ignored)
const T_UPLOADED = '60000000-0000-0000-0000-000000000001' // an uploaded template named FAI
const H = (n: number) => n.toString(16).repeat(64).slice(0, 64)

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
]

interface SyncResult {
  configured: boolean
  skipped: string | null
  created: number
  updated: number
  restored: number
  archived: number
}

interface TemplateRow {
  id: string
  name: string
  storage_hash: string
  revision: number
  source_file_id: string | null
  source_path: string | null
  source_version: number | null
  archived_at: string | null
  is_default: boolean
}

let db: PGlite

async function error(sql: string, params: unknown[] = []): Promise<string | null> {
  try {
    await db.query(sql, params)
    return null
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

async function sync(user: string): Promise<SyncResult> {
  await actAs(db, user)
  const r = await db.query<{ r: SyncResult }>('SELECT inspection_template_sync_folder() AS r')
  return r.rows[0].r
}

async function folderTemplates(): Promise<TemplateRow[]> {
  await actAsOwner(db)
  const r = await db.query<TemplateRow>(
    `SELECT id, name, storage_hash, revision, source_file_id, source_path, source_version, archived_at, is_default
       FROM inspection_template WHERE source_path IS NOT NULL ORDER BY source_path`,
  )
  return r.rows
}

async function setFolder(folder: Record<string, unknown> | null): Promise<void> {
  await actAsOwner(db)
  await db.query(
    `UPDATE organization
        SET settings = jsonb_set(COALESCE(settings, '{}'), '{inspection_reports}',
                                 COALESCE(settings -> 'inspection_reports', '{}') || jsonb_build_object('templates_folder', $2::jsonb))
      WHERE id = $1`,
    [ORG_A, folder === null ? 'null' : JSON.stringify(folder)],
  )
}

beforeAll(async () => {
  db = await bootBaseline()
  await actAsOwner(db)
  for (const m of MIGRATION_FILES) await db.exec(readSql(resolve(MIGRATIONS, m)))
  const user = (id: string, email: string, role: string) => `('${id}', '${email}', '${ORG_A}', '${role}')`
  const file = (id: string, path: string, ext: string, hash: string) =>
    `('${id}', '${ORG_A}', '${VA1}', '${path}', '${path.split('/').pop()}', '${ext}', '${hash}', 1, '${ADMIN}')`
  await seed(
    db,
    `
    INSERT INTO organization (id, name, slug) VALUES ('${ORG_A}', 'A', 'org-a');
    INSERT INTO app_user (id, email, org_id, role) VALUES
      ${user(ADMIN, 'admin@a.test', 'admin')},
      ${user(ALICE, 'alice@a.test', 'engineer')},
      ${user(CAROL, 'carol@a.test', 'engineer')};
    INSERT INTO vault (id, org_id, name, slug) VALUES ('${VA1}', '${ORG_A}', 'A1', 'a1');
    INSERT INTO vault_access (vault_id, user_id) VALUES ('${VA1}', '${ALICE}');
    INSERT INTO file (id, org_id, vault_id, file_path, file_name, extension, content_hash, version, created_by) VALUES
      ${file(F_FAI, '_templates/Inspection/FAI.xlsx', '.xlsx', H(2))},
      ${file(F_PROD, '_templates/Inspection/Lot/Production.xlsx', '.XLSX', H(3))},
      ${file(F_DRW, '_templates/Inspection/Bracket.slddrw', '.slddrw', H(4))},
      ${file(F_OUT, '_templates/InspectionOld/Other.xlsx', '.xlsx', H(5))},
      ${file(F_LOCK, '_templates/Inspection/~$FAI.xlsx', '.xlsx', H(6))};
    INSERT INTO file_version (file_id, version, revision, content_hash, file_size, created_by) VALUES
      ('${F_FAI}', 1, 'A', '${H(1)}', 100, '${ADMIN}'),
      ('${F_FAI}', 2, 'A', '${H(2)}', 200, '${ADMIN}'),
      ('${F_PROD}', 1, 'A', '${H(3)}', 300, '${ADMIN}'),
      ('${F_DRW}', 1, 'A', '${H(4)}', 400, '${ADMIN}'),
      ('${F_OUT}', 1, 'A', '${H(5)}', 500, '${ADMIN}'),
      ('${F_LOCK}', 1, 'A', '${H(6)}', 600, '${ADMIN}');
    INSERT INTO inspection_template (id, org_id, name, storage_hash, file_size) VALUES
      ('${T_UPLOADED}', '${ORG_A}', 'FAI', '${H(7)}', 10);
    `,
  )
}, 240_000)

afterAll(async () => {
  await db?.close()
})

describe('supabase/migrations/0511_inspection_template_folder.sql', () => {
  it('follows the runner contract and stamps 511', async () => {
    const sql = readSql(resolve(MIGRATIONS, '0511_inspection_template_folder.sql'))
    expect(sql).not.toMatch(/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/im)
    expect(sql).toContain('LANGUAGE sql IMMUTABLE AS $$ SELECT 511 $$;')
    await actAsOwner(db)
    const r = await db.query<{ v: { stamped: boolean; version: number; problems: unknown[] } }>(
      'SELECT verify_and_stamp_schema() AS v',
    )
    expect(r.rows[0].v.problems).toEqual([])
    expect(r.rows[0].v).toMatchObject({ stamped: true, version: 511 })
  }, 600_000)
})

describe('inspection_template_sync_folder()', () => {
  it('does nothing while no folder is set', async () => {
    expect(await sync(ALICE)).toMatchObject({ configured: false, skipped: 'NOT_CONFIGURED', created: 0 })
    expect(await folderTemplates()).toEqual([])
  })

  it("changes nothing for a member without the folder's vault", async () => {
    await setFolder({ vault_id: VA1, path: '\\_templates\\Inspection\\' })
    expect(await sync(CAROL)).toMatchObject({ configured: true, skipped: 'NO_VAULT_ACCESS', created: 0 })
    expect(await folderTemplates()).toEqual([])
  })

  it("adds the folder's checked-in workbooks at their latest version, with free names", async () => {
    expect(await sync(ALICE)).toMatchObject({ configured: true, skipped: null, created: 2, updated: 0, archived: 0 })
    const rows = await folderTemplates()
    expect(rows.map((r) => [r.name, r.source_file_id, r.storage_hash, r.source_version, r.revision])).toEqual([
      ['FAI (2)', F_FAI, H(2), 2, 1],
      ['Production', F_PROD, H(3), 1, 1],
    ])
  })

  it('is idempotent', async () => {
    expect(await sync(ALICE)).toMatchObject({ created: 0, updated: 0, restored: 0, archived: 0 })
  })

  it('replaces the workbook when a newer version is checked in', async () => {
    await actAsOwner(db)
    await db.query(
      `INSERT INTO file_version (file_id, version, revision, content_hash, file_size, created_by) VALUES ($1, 3, 'A', $2, 250, $3)`,
      [F_FAI, H(8), ADMIN],
    )
    expect(await sync(ALICE)).toMatchObject({ created: 0, updated: 1 })
    const fai = (await folderTemplates()).find((r) => r.source_file_id === F_FAI)
    expect(fai).toMatchObject({ storage_hash: H(8), source_version: 3, revision: 2 })
  })

  it('lets an administrator rename and type a folder template, but not replace or archive it', async () => {
    const fai = (await folderTemplates()).find((r) => r.source_file_id === F_FAI)!
    await actAs(db, ADMIN)
    expect(await error(`UPDATE inspection_template SET name = 'First article', report_types = '{fai}', is_default = true WHERE id = $1`, [fai.id])).toBeNull()
    expect(await error(`UPDATE inspection_template SET storage_hash = $2 WHERE id = $1`, [fai.id, H(7)])).toMatch(/templates folder/)
    expect(await error(`UPDATE inspection_template SET archived_at = now(), is_default = false WHERE id = $1`, [fai.id])).toMatch(/templates folder/)
    expect(await error(`UPDATE inspection_template SET source_path = 'x' WHERE id = $1`, [T_UPLOADED])).toMatch(/folder sync/)
    expect(
      await error(
        `INSERT INTO inspection_template (org_id, name, storage_hash, file_size, source_path) VALUES ($1, 'Sneaky', $2, 1, 'x')`,
        [ORG_A, H(7)],
      ),
    ).toMatch(/folder sync/)
    // An uploaded template is still replaced and archived as before.
    expect(await error(`UPDATE inspection_template SET storage_hash = $2, revision = 2 WHERE id = $1`, [T_UPLOADED, H(8)])).toBeNull()
  })

  it('archives a template whose file leaves the folder and restores it when it comes back', async () => {
    await actAsOwner(db)
    await db.query(`UPDATE file SET file_path = '_archive/FAI.xlsx' WHERE id = $1`, [F_FAI])
    expect(await sync(ALICE)).toMatchObject({ archived: 1 })
    let fai = (await folderTemplates()).find((r) => r.source_file_id === F_FAI)!
    expect(fai.archived_at).not.toBeNull()
    expect(fai.is_default).toBe(false)

    await actAsOwner(db)
    await db.query(`UPDATE file SET file_path = '_templates/Inspection/FAI.xlsx' WHERE id = $1`, [F_FAI])
    expect(await sync(ALICE)).toMatchObject({ restored: 1, archived: 0 })
    fai = (await folderTemplates()).find((r) => r.source_file_id === F_FAI)!
    expect(fai.archived_at).toBeNull()
    expect(fai.name).toBe('First article')
  })

  it('archives a template whose file is deleted, and every folder template once the folder is cleared', async () => {
    await actAsOwner(db)
    await db.query(`UPDATE file SET deleted_at = now() WHERE id = $1`, [F_PROD])
    expect(await sync(ALICE)).toMatchObject({ archived: 1 })
    await setFolder(null)
    expect(await sync(ALICE)).toMatchObject({ skipped: 'NOT_CONFIGURED', archived: 1 })
    expect((await folderTemplates()).every((r) => r.archived_at !== null)).toBe(true)
  })
})
