/**
 * supabase/migrations/0505_version_outputs.sql on real Postgres (PGlite), applied after 0501-0504
 * to the 5.0 baseline as the migration runner applies them: it stamps 505; version outputs follow
 * their file's vault, are written only through file_version_output_record() (explorer edit, the
 * vault, content the caller may claim, replacement by an administrator only); their content is
 * readable exactly through a readable row; check_release_residue() refuses a client write policy
 * on the table; inspection reports carry a sequence; server backups export the table.
 */
import type { PGlite } from '@electric-sql/pglite'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { BACKUP_TABLES } from '../../../api/src/backup/source'
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
const VA2 = '40000000-0000-0000-0000-000000000002'
const F1 = '50000000-0000-0000-0000-000000000001' // a part in VA1
const FS = '50000000-0000-0000-0000-000000000003' // a part in VA2, which Alice cannot see
const V1 = '51000000-0000-0000-0000-000000000001' // F1 v1
const H_F1 = '1'.repeat(64)
const H_STEP = '2'.repeat(64) // Alice's upload
const H_STEP_2 = '3'.repeat(64) // Alice's second upload
const H_ADMIN_STEP = '4'.repeat(64) // the administrator's upload
const H_SECRET = '9'.repeat(64) // FS's content

const MIGRATION_FILES = [
  '0501_server_backups.sql',
  '0502_security_hardening.sql',
  '0503_vault_object_issues.sql',
  '0504_inspection_tables.sql',
  '0505_version_outputs.sql',
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

interface RecordResult {
  recorded: boolean
  replaced: boolean
  storage_hash: string
  id: string
}

async function record(
  hash: string,
  options: { configuration?: string | null; kind?: string; name?: string } = {},
): Promise<RecordResult> {
  const r = await db.query<{ r: RecordResult }>(
    `SELECT file_version_output_record($1, $2, $3, $4, 100, $5, true) AS r`,
    [V1, options.kind ?? 'step', options.configuration ?? null, hash, options.name ?? 'one.step'],
  )
  return r.rows[0].r
}

const recordSql = `SELECT file_version_output_record($1, 'step', NULL, $2, 100, 'one.step', true)`
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
    INSERT INTO file (id, org_id, vault_id, file_path, file_name, extension, content_hash, version, created_by) VALUES
      ('${F1}', '${ORG_A}', '${VA1}', 'a1/one.sldprt', 'one.sldprt', '.sldprt', '${H_F1}', 1, '${ADMIN}'),
      ('${FS}', '${ORG_A}', '${VA2}', 'a2/secret.sldprt', 'secret.sldprt', '.sldprt', '${H_SECRET}', 1, '${ADMIN}');
    INSERT INTO file_version (id, file_id, version, revision, content_hash, created_by, created_at) VALUES
      ('${V1}', '${F1}', 1, 'A', '${H_F1}', '${ADMIN}', '2020-01-01');
    INSERT INTO storage.objects (bucket_id, name, owner, owner_id) VALUES
      ('vault', '${objectName(H_STEP)}', '${ALICE}', '${ALICE}'),
      ('vault', '${objectName(H_STEP_2)}', '${ALICE}', '${ALICE}'),
      ('vault', '${objectName(H_ADMIN_STEP)}', '${ADMIN}', '${ADMIN}'),
      ('vault', '${objectName(H_SECRET)}', '${ADMIN}', '${ADMIN}');
    `,
  )
}, 240_000)

afterAll(async () => {
  await db?.close()
})

describe('supabase/migrations/0505_version_outputs.sql', () => {
  it('follows the runner contract and stamps 505', async () => {
    const sql = readSql(resolve(MIGRATIONS, '0505_version_outputs.sql'))
    expect(sql).not.toMatch(/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/im)
    expect(sql).toContain('LANGUAGE sql IMMUTABLE AS $$ SELECT 505 $$;')
    await actAsOwner(db)
    const r = await db.query<{ v: { stamped: boolean; version: number; problems: unknown[] } }>(
      'SELECT verify_and_stamp_schema() AS v',
    )
    expect(r.rows[0].v.problems).toEqual([])
    expect(r.rows[0].v).toMatchObject({ stamped: true, version: 505 })
  }, 600_000)

  it('redefines check_release_residue() changing only its two table lists', () => {
    const pick = (sql: string) => {
      const m = sql.match(/CREATE OR REPLACE FUNCTION check_release_residue\(\)[\s\S]*?\n\$\$;/)
      if (!m) throw new Error('check_release_residue not found')
      return m[0]
    }
    const base = pick(readSql(resolve(MIGRATIONS, '../core.sql')))
    const ours = pick(readSql(resolve(MIGRATIONS, '0505_version_outputs.sql')))
    expect(ours).toBe(
      base
        .replace(
          "'inspection_characteristic_version', 'file_eco', 'file_deviation')",
          "'inspection_characteristic_version', 'file_eco', 'file_deviation',\n                           'inspection_report', 'file_version_output')",
        )
        .replace(
          "                           'drawing_pdf_render')",
          "                           'drawing_pdf_render', 'file_version_output')",
        ),
    )
    expect(ours).not.toBe(base)
  })

  it('exports the table in server backups, on top of the 0504 list', async () => {
    const tables = (file: string) =>
      [...readSql(resolve(MIGRATIONS, file)).matchAll(/WHEN '([a-z_]+)' THEN '/g)]
        .map((m) => m[1])
        .sort()
    expect(tables('0505_version_outputs.sql')).toEqual(
      [...tables('0504_inspection_tables.sql'), 'file_version_output'].sort(),
    )
    // The API's backup worker exports everything 0505 knows (supplyOrders513.test.ts holds it to
    // the latest definition exactly).
    expect(
      tables('0505_version_outputs.sql').filter((t) => !(BACKUP_TABLES as readonly string[]).includes(t)),
    ).toEqual([])
    await actAsOwner(db)
    await db.exec('SET ROLE service_role')
    const r = await db.query<{ p: { missing: boolean } }>(
      `SELECT backup_list_org_rows($1, 'file_version_output', NULL, 10) AS p`,
      [ORG_A],
    )
    expect(r.rows[0].p.missing).toBe(false)
    await actAsOwner(db)
  })

  it('gives inspection reports a positive sequence', async () => {
    await actAsOwner(db)
    const col = await db.query<{ data_type: string; is_nullable: string }>(
      `SELECT data_type, is_nullable FROM information_schema.columns
        WHERE table_name = 'inspection_report' AND column_name = 'sequence'`,
    )
    expect(col.rows).toEqual([{ data_type: 'integer', is_nullable: 'YES' }])
    const check = await db.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'inspection_report_sequence_check'`,
    )
    expect(check.rows[0].def).toMatch(/sequence >= 1/)
  })
})

describe('file_version_output_record()', () => {
  it('needs explorer edit', async () => {
    await actAs(db, DAVE)
    expect(await error(recordSql, [V1, H_STEP])).toMatch(/permission to edit files/)
  })

  it("needs the file's vault", async () => {
    await actAs(db, CAROL)
    expect(await error(recordSql, [V1, H_STEP])).not.toBeNull()
    expect(await count(`SELECT id FROM file_version_output`)).toBe(0)
  })

  it("refuses content the caller neither uploaded nor can read", async () => {
    await actAs(db, ALICE)
    expect(await error(recordSql, [V1, H_SECRET])).toMatch(/not uploaded by you/)
    // The administrator's upload is not Alice's either.
    expect(await error(recordSql, [V1, H_ADMIN_STEP])).toMatch(/not uploaded by you/)
  })

  it('refuses a bad kind, size or file name', async () => {
    await actAs(db, ALICE)
    expect(
      await error(`SELECT file_version_output_record($1, 'pdf', NULL, $2, 100, 'one.pdf')`, [V1, H_STEP]),
    ).toMatch(/Unknown output kind/)
    expect(
      await error(`SELECT file_version_output_record($1, 'step', NULL, $2, 0, 'one.step')`, [V1, H_STEP]),
    ).toMatch(/File size must be positive/)
    expect(
      await error(`SELECT file_version_output_record($1, 'step', NULL, $2, 10, '../one.step')`, [V1, H_STEP]),
    ).toMatch(/plain file name/)
  })

  it('records the first output and stamps the actor; a retry is a no-op', async () => {
    await actAs(db, ALICE)
    expect(await record(H_STEP)).toMatchObject({ recorded: true, replaced: false, storage_hash: H_STEP })
    expect(await record(H_STEP)).toMatchObject({ recorded: false, replaced: false })
    const r = await db.query<{ generated_by: string; kind: string; configuration: string | null; file_id: string }>(
      `SELECT generated_by, kind, configuration, file_id FROM file_version_output`,
    )
    expect(r.rows).toEqual([{ generated_by: ALICE, kind: 'step', configuration: null, file_id: F1 }])
  })

  it('keeps one output per version, kind and configuration', async () => {
    await actAs(db, ALICE)
    // Another configuration and another kind are separate outputs.
    expect(await record(H_STEP_2, { configuration: 'Long' })).toMatchObject({ recorded: true })
    expect(await record(H_STEP_2, { kind: 'stl', name: 'one.stl' })).toMatchObject({ recorded: true })
    expect(await count(`SELECT id FROM file_version_output`)).toBe(3)
  })

  it('replaces a recorded output only for an administrator', async () => {
    await actAs(db, ALICE)
    expect(await error(recordSql, [V1, H_STEP_2])).toMatch(/already recorded/)
    await actAs(db, ADMIN)
    expect(await record(H_ADMIN_STEP)).toMatchObject({ recorded: true, replaced: true })
    const r = await db.query<{ storage_hash: string; generated_by: string }>(
      `SELECT storage_hash, generated_by FROM file_version_output WHERE kind = 'step' AND configuration IS NULL`,
    )
    expect(r.rows).toEqual([{ storage_hash: H_ADMIN_STEP, generated_by: ADMIN }])
  })

  it('is the only writer: clients cannot write the table', async () => {
    await actAs(db, ALICE)
    expect(
      await error(
        `INSERT INTO file_version_output (org_id, file_id, file_version_id, kind, storage_hash, file_size, file_name)
         VALUES ($1, $2, $3, 'iges', $4, 1, 'x.igs')`,
        [ORG_A, F1, V1, H_STEP],
      ),
    ).toMatch(/permission denied/)
    expect(await error(`UPDATE file_version_output SET storage_hash = $1`, [H_SECRET])).toMatch(
      /permission denied/,
    )
    expect(await error(`DELETE FROM file_version_output`)).toMatch(/permission denied/)
  })
})

describe('file_version_output reading', () => {
  it('is read only with the vault, and so is its content', async () => {
    for (const reader of [ALICE, DAVE]) {
      await actAs(db, reader)
      expect(await count(`SELECT id FROM file_version_output`)).toBe(3)
    }
    // Alice reads the administrator's replacement through the row, not as its uploader.
    await actAs(db, ALICE)
    expect(
      await count(`SELECT id FROM storage.objects WHERE name = $1`, [objectName(H_ADMIN_STEP)]),
    ).toBe(1)
    await actAs(db, DAVE)
    expect(
      await count(`SELECT id FROM storage.objects WHERE name = $1`, [objectName(H_ADMIN_STEP)]),
    ).toBe(1)
    await actAs(db, CAROL)
    expect(await count(`SELECT id FROM file_version_output`)).toBe(0)
    expect(
      await count(`SELECT id FROM storage.objects WHERE name = $1`, [objectName(H_ADMIN_STEP)]),
    ).toBe(0)
    await actAs(db, OTHER_ADMIN)
    expect(await count(`SELECT id FROM file_version_output`)).toBe(0)
  })

  it('names the vault rule in every read policy, and anon reads nothing', async () => {
    await actAsOwner(db)
    const r = await db.query<{ policyname: string }>(
      `SELECT policyname FROM pg_policies WHERE tablename = 'file_version_output' AND cmd IN ('SELECT', 'ALL')
          AND COALESCE(qual, '') NOT LIKE '%my_accessible_vault_ids()%'`,
    )
    expect(r.rows).toEqual([])
    const anon = await db.query<{ ok: boolean }>(
      `SELECT has_table_privilege('anon', 'file_version_output', 'SELECT') AS ok`,
    )
    expect(anon.rows[0].ok).toBe(false)
  })

  it('check_release_residue() refuses a client write policy or a read policy without the vault rule', async () => {
    await actAsOwner(db)
    const residue = async () =>
      (
        await db.query<{ residue: string; identity: string }>(
          `SELECT residue, identity FROM check_release_residue() WHERE identity LIKE '%file_version_output%'`,
        )
      ).rows
    expect(await residue()).toEqual([])
    await db.exec(
      `CREATE POLICY "leftover write" ON file_version_output FOR INSERT TO authenticated WITH CHECK (true);
       CREATE POLICY "leftover read" ON file_version_output FOR SELECT TO authenticated USING (true);`,
    )
    const found = (await residue()).map((r) => r.residue).sort()
    expect(found).toEqual(['file_policy_ignores_vault_access', 'review_client_write_policy'])
    await db.exec(
      `DROP POLICY "leftover write" ON file_version_output; DROP POLICY "leftover read" ON file_version_output;`,
    )
    expect(await residue()).toEqual([])
  })
})
