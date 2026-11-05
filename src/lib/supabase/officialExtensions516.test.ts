/**
 * supabase/migrations/0516_official_extensions.sql on real Postgres (PGlite), applied after
 * 0501-0515 to the 5.0 baseline as the migration runner applies them: it stamps 516; every
 * organization reads Reviews, Inspection and Orders as installed until an admin uninstalls one
 * through org_extension_set_installed(); while one is uninstalled a signed-in caller's direct
 * writes to its tables are refused (EXTENSION_NOT_INSTALLED) and its module is closed, but
 * housekeeping from other triggers and server callers still write; and the drawing release gate
 * applies only with Reviews.
 */
import type { PGlite } from '@electric-sql/pglite'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { OFFICIAL_EXTENSIONS } from '@/lib/officialExtensions'

import { checkNaming } from '../../../scripts/rename-5.0/namingRules.mjs'
import { inventory } from '../../../scripts/rename-5.0/schemaInventory.mjs'
import { actAs, actAsOwner, bootBaseline, MIGRATIONS, readSql, seed } from './testing/schemaDb'

const ORG_A = '00000000-0000-0000-0000-00000000000a'
const ORG_B = '00000000-0000-0000-0000-00000000000b'
const ADMIN = '00000000-0000-0000-0000-000000000001'
const AUTHOR = '00000000-0000-0000-0000-000000000002'
const REVIEWER = '00000000-0000-0000-0000-000000000003'
const OTHER_ADMIN = '00000000-0000-0000-0000-000000000009'
const VA1 = '40000000-0000-0000-0000-000000000001'
const D1 = '50000000-0000-0000-0000-000000000001'
const V1 = '51000000-0000-0000-0000-000000000001'
const RV = '60000000-0000-0000-0000-000000000001'
const ITEM = '61000000-0000-0000-0000-000000000001'
const C_REVIEW = '70000000-0000-0000-0000-000000000001'
const H = 'a'.repeat(64)

const MIGRATION = '0516_official_extensions.sql'
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
  '0513_supply_orders.sql',
  '0514_review_comment_notify.sql',
  '0515_TBD_orders.sql', // 5.13.0 (Orders): set the real name after the rebase
  MIGRATION,
]

interface SetResult {
  success: boolean
  error_code?: string
  settings?: { extensions?: Record<string, { installed: boolean; changed_by?: string }> }
}

let db: PGlite

async function setInstalled(user: string, id: string, installed: boolean | null): Promise<SetResult> {
  await actAs(db, user)
  const r = await db.query<{ r: SetResult }>('SELECT org_extension_set_installed($1, $2) AS r', [id, installed])
  return r.rows[0].r
}

/** The HINT a statement fails with, or null when it succeeds. */
async function hintOf(user: string | null, sql: string, params: unknown[] = []): Promise<string | null> {
  if (user) await actAs(db, user)
  else await actAsOwner(db)
  try {
    await db.query(sql, params)
    return null
  } catch (e) {
    return (e as { hint?: string }).hint ?? (e instanceof Error ? e.message : String(e))
  }
}

async function installed(org: string, id: string): Promise<boolean> {
  await actAsOwner(db)
  const r = await db.query<{ v: boolean }>('SELECT is_org_extension_installed($1, $2) AS v', [org, id])
  return r.rows[0].v
}

async function canAccess(user: string, module: string): Promise<boolean> {
  await actAs(db, user)
  const r = await db.query<{ v: boolean }>('SELECT can_access_module($1) AS v', [module])
  return r.rows[0].v
}

beforeAll(async () => {
  db = await bootBaseline()
  await actAsOwner(db)
  for (const m of MIGRATION_FILES) await db.exec(readSql(resolve(MIGRATIONS, m)))
  const user = (id: string, email: string, org: string, role: string) => `('${id}', '${email}', '${org}', '${role}')`
  await seed(
    db,
    `
    INSERT INTO organization (id, name, slug) VALUES ('${ORG_A}', 'A', 'org-a'), ('${ORG_B}', 'B', 'org-b');
    INSERT INTO app_user (id, email, org_id, role) VALUES
      ${user(ADMIN, 'admin@a.test', ORG_A, 'admin')},
      ${user(AUTHOR, 'author@a.test', ORG_A, 'engineer')},
      ${user(REVIEWER, 'reviewer@a.test', ORG_A, 'engineer')},
      ${user(OTHER_ADMIN, 'admin@b.test', ORG_B, 'admin')};
    INSERT INTO vault (id, org_id, name, slug) VALUES ('${VA1}', '${ORG_A}', 'A1', 'a1');
    INSERT INTO vault_access (vault_id, user_id) VALUES ('${VA1}', '${AUTHOR}'), ('${VA1}', '${REVIEWER}');
    INSERT INTO file (id, org_id, vault_id, file_path, file_name, extension, content_hash, version, created_by) VALUES
      ('${D1}', '${ORG_A}', '${VA1}', 'a1/one.slddrw', 'one.slddrw', '.slddrw', '${H}', 1, '${AUTHOR}');
    INSERT INTO file_version (id, file_id, version, revision, content_hash, created_by) VALUES
      ('${V1}', '${D1}', 1, 'A', '${H}', '${AUTHOR}');
    INSERT INTO review (id, org_id, requested_by, title, status) VALUES ('${RV}', '${ORG_A}', '${AUTHOR}', 'One', 'pending');
    INSERT INTO review_item (id, org_id, review_id, file_id, file_version_id) VALUES
      ('${ITEM}', '${ORG_A}', '${RV}', '${D1}', '${V1}');
    INSERT INTO review_response (org_id, review_id, round_number, reviewer_id, status) VALUES
      ('${ORG_A}', '${RV}', 1, '${REVIEWER}', 'pending');
    INSERT INTO file_comment (id, file_id, user_id, comment, review_id, review_round, review_item_id) VALUES
      ('${C_REVIEW}', '${D1}', '${REVIEWER}', 'Dimension 42 has no tolerance', '${RV}', 1, '${ITEM}');
    `,
  )
}, 240_000)

afterAll(async () => {
  await db?.close()
})

describe('supabase/migrations/0516_official_extensions.sql', () => {
  it('follows the runner contract and stamps 516', async () => {
    const sql = readSql(resolve(MIGRATIONS, MIGRATION))
    expect(sql).not.toMatch(/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/im)
    expect(sql).not.toMatch(/^-- blueplm:no-transaction/)
    expect(sql).toContain('LANGUAGE sql IMMUTABLE AS $$ SELECT 516 $$;')
    await actAsOwner(db)
    const r = await db.query<{ v: { stamped: boolean; version: number; problems: unknown[] } }>(
      'SELECT verify_and_stamp_schema() AS v',
    )
    expect(r.rows[0].v.problems).toEqual([])
    expect(r.rows[0].v).toMatchObject({ stamped: true, version: 516 })
  }, 600_000)

  it('follows the naming rules', () => {
    const inv = inventory([{ file: MIGRATION, text: readSql(resolve(MIGRATIONS, MIGRATION)) }])
    expect(checkNaming(inv).map((v) => `${v.kind} ${v.name}: ${v.rule}`)).toEqual([])
  })

  it('knows exactly the extensions of the app manifest, with the same dependencies', async () => {
    await actAsOwner(db)
    const r = await db.query<{ extension_id: string; needs: string[] }>(
      'SELECT extension_id, needs FROM official_extension_list_dependencies() ORDER BY extension_id',
    )
    const app = OFFICIAL_EXTENSIONS.map((m) => ({ extension_id: m.id, needs: [...m.dependencies.extensions] })).sort(
      (a, b) => a.extension_id.localeCompare(b.extension_id),
    )
    expect(r.rows).toEqual(app)
  })

  it('guards every table the manifests own, and no other', async () => {
    await actAsOwner(db)
    const r = await db.query<{ t: string }>(
      `SELECT c.relname AS t FROM pg_trigger g JOIN pg_class c ON c.oid = g.tgrelid
        JOIN pg_proc p ON p.oid = g.tgfoid WHERE p.proname = 'trg_official_extension_guard' ORDER BY 1`,
    )
    const owned = OFFICIAL_EXTENSIONS.flatMap((m) => [...m.schema.tables])
    expect(r.rows.map((x) => x.t)).toEqual([...owned, 'file_comment'].sort())
  })

  it('redefines the release functions changing only the marked lines', () => {
    const body = (file: string, name: string) => {
      const sql = readSql(resolve(MIGRATIONS, file))
      const m = sql.match(new RegExp(`CREATE OR REPLACE FUNCTION ${name}\\(\\n  p_file_id UUID,[\\s\\S]*?\\nSET search_path = public, pg_temp;`))
      if (!m) throw new Error(`${name} not found in ${file}`)
      return m[0]
    }
    const strip = (s: string) =>
      s
        .replace(/\n *-- Schema 516:[^\n]*/g, '')
        .replace(/\n *AND is_org_extension_installed\(v_file\.org_id, 'blueplm\.reviews'\)/, '')
        .replace(/\n *AND is_org_extension_installed\(v_org_id, 'blueplm\.reviews'\);/, ';')
    for (const name of ['workflow_transition_apply', 'workflow_transition_execute']) {
      const before = body('0509_release_versions.sql', name)
      const after = body(MIGRATION, name)
      expect(after).not.toEqual(before)
      expect(strip(after).replace(/\s+/g, ' ')).toEqual(before.replace(/\s+/g, ' '))
    }
  })
})

describe('the install state', () => {
  it('reads every extension as installed in an organization that never set it', async () => {
    for (const m of OFFICIAL_EXTENSIONS) {
      expect(await installed(ORG_A, m.id)).toBe(true)
      expect(await installed(ORG_B, m.id)).toBe(true)
    }
    expect(await canAccess(REVIEWER, 'orders')).toBe(true)
  })

  it('is changed by an admin only, for a known extension', async () => {
    expect((await setInstalled(REVIEWER, 'blueplm.orders', false)).error_code).toBe('NOT_ADMIN')
    expect((await setInstalled(ADMIN, 'blueplm.nope', false)).error_code).toBe('UNKNOWN_EXTENSION')
    expect((await setInstalled(ADMIN, 'blueplm.orders', null)).error_code).toBe('UNKNOWN_EXTENSION')
    expect(await installed(ORG_A, 'blueplm.orders')).toBe(true)
  })

  it("uninstalls in the admin's organization only, records who, and keeps other settings", async () => {
    await actAsOwner(db)
    await db.query(`UPDATE organization SET settings = '{"file_workflows_enabled": true}' WHERE id = $1`, [ORG_A])
    const r = await setInstalled(ADMIN, 'blueplm.orders', false)
    expect(r.success).toBe(true)
    expect(r.settings?.extensions?.['blueplm.orders']).toMatchObject({ installed: false, changed_by: ADMIN })
    expect(r.settings).toMatchObject({ file_workflows_enabled: true })
    expect(await installed(ORG_A, 'blueplm.orders')).toBe(false)
    expect(await installed(ORG_B, 'blueplm.orders')).toBe(true)
  })

  it("closes an uninstalled extension's module to everyone, admins included", async () => {
    expect(await canAccess(ADMIN, 'orders')).toBe(false)
    expect(await canAccess(REVIEWER, 'orders')).toBe(false)
    expect(await canAccess(OTHER_ADMIN, 'orders')).toBe(true)
    expect(await canAccess(ADMIN, 'explorer')).toBe(true)
  })

  it('refuses an order while Orders is uninstalled, and takes one again after a reinstall', async () => {
    expect(await hintOf(ADMIN, `SELECT supply_order_create(p_title => 'Brackets')`)).not.toBeNull()
    expect((await setInstalled(ADMIN, 'blueplm.orders', true)).success).toBe(true)
    expect(await canAccess(ADMIN, 'orders')).toBe(true)
    expect(await hintOf(ADMIN, `SELECT supply_order_create(p_title => 'Brackets')`)).toBeNull()
  })
})

describe('writes while Reviews is uninstalled', () => {
  beforeAll(async () => {
    expect((await setInstalled(ADMIN, 'blueplm.reviews', false)).success).toBe(true)
  })

  it("refuses a signed-in caller's write to a review table", async () => {
    expect(await hintOf(ADMIN, `UPDATE review SET title = 'Renamed' WHERE id = $1`, [RV])).toBe('EXTENSION_NOT_INSTALLED')
  })

  it('refuses a new comment that names a review, not a plain comment or an edit of an old one', async () => {
    expect(
      await hintOf(
        REVIEWER,
        `INSERT INTO file_comment (file_id, user_id, comment, review_id, review_round, review_item_id) VALUES ($1, $2, 'x', $3, 1, $4)`,
        [D1, REVIEWER, RV, ITEM],
      ),
    ).toBe('EXTENSION_NOT_INSTALLED')
    expect(
      await hintOf(REVIEWER, `INSERT INTO file_comment (file_id, user_id, comment) VALUES ($1, $2, 'plain')`, [D1, REVIEWER]),
    ).not.toBe('EXTENSION_NOT_INSTALLED')
    expect(await hintOf(null, `UPDATE file_comment SET comment = 'edited' WHERE id = $1`, [C_REVIEW])).toBeNull()
    expect(await hintOf(REVIEWER, `SELECT file_comment_set_resolved($1, true)`, [C_REVIEW])).toBeNull()
  })

  it('lets a server caller write (a restore, pg_cron, the SQL editor)', async () => {
    expect(await hintOf(null, `UPDATE review SET title = 'By the server' WHERE id = $1`, [RV])).toBeNull()
  })

  it('lets housekeeping from other triggers write: a reviewer who loses the vault is withdrawn', async () => {
    expect(await hintOf(ADMIN, `DELETE FROM vault_access WHERE vault_id = $1 AND user_id = $2`, [VA1, REVIEWER])).toBeNull()
    await actAsOwner(db)
    const r = await db.query<{ withdrawn_at: string | null }>(
      'SELECT withdrawn_at::text FROM review_response WHERE review_id = $1 AND reviewer_id = $2',
      [RV, REVIEWER],
    )
    expect(r.rows[0].withdrawn_at).not.toBeNull()
  })

  it('never refuses a delete', async () => {
    expect(await hintOf(null, `DELETE FROM file_comment WHERE user_id = $1 AND comment = 'plain'`, [REVIEWER])).toBeNull()
  })

  it('takes review writes again after a reinstall', async () => {
    expect((await setInstalled(ADMIN, 'blueplm.reviews', true)).success).toBe(true)
    expect(await hintOf(ADMIN, `UPDATE review SET title = 'Renamed' WHERE id = $1`, [RV])).not.toBe('EXTENSION_NOT_INSTALLED')
  })
})
