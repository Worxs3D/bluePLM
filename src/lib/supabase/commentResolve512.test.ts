/**
 * supabase/migrations/0512_comment_resolve.sql on real Postgres (PGlite), applied after 0501-0511
 * to the 5.0 baseline as the migration runner applies them: it stamps 512, and
 * file_comment_set_resolved() lets the people working on a file resolve or reopen a comment
 * (author, admin, a review's requester and reviewers, explorer edit outside a review), never a
 * withdrawn reviewer or someone who cannot read the file's vault, while the comment UPDATE policy
 * stays the author's.
 */
import type { PGlite } from '@electric-sql/pglite'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { actAs, actAsOwner, bootBaseline, MIGRATIONS, readSql, seed } from './testing/schemaDb'

const ORG_A = '00000000-0000-0000-0000-00000000000a'
const ORG_B = '00000000-0000-0000-0000-00000000000b'
const ADMIN = '00000000-0000-0000-0000-000000000001'
const AUTHOR = '00000000-0000-0000-0000-000000000002' // the review's requester; no explorer edit
const REVIEWER = '00000000-0000-0000-0000-000000000003'
const WITHDRAWN = '00000000-0000-0000-0000-000000000004' // withdrawn from the review, vault back
const OUTSIDER = '00000000-0000-0000-0000-000000000005' // vault, no review, no explorer edit
const EDITOR = '00000000-0000-0000-0000-000000000006' // vault and explorer edit, no review
const NO_VAULT = '00000000-0000-0000-0000-000000000007' // explorer edit, no vault grant
const VAULT_EDITOR = '00000000-0000-0000-0000-000000000008' // explorer edit on VA1 only
const OTHER_ADMIN = '00000000-0000-0000-0000-000000000009' // admin of ORG_B
const EDITORS = '10000000-0000-0000-0000-000000000001'
const VA1_EDITORS = '10000000-0000-0000-0000-000000000002'
const VA1 = '40000000-0000-0000-0000-000000000001'
const D1 = '50000000-0000-0000-0000-000000000001'
const V1 = '51000000-0000-0000-0000-000000000001'
const RV = '60000000-0000-0000-0000-000000000001'
const ITEM = '61000000-0000-0000-0000-000000000001'
const C_REVIEW = '70000000-0000-0000-0000-000000000001' // REVIEWER's markup in RV, round 1
const C_PLAIN = '70000000-0000-0000-0000-000000000002' // OUTSIDER's comment outside any review
const MISSING = '70000000-0000-0000-0000-0000000000ff'
const H = 'a'.repeat(64)

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
]

interface ResolveResult {
  id: string
  file_id: string
  is_resolved: boolean
  resolved_by: string | null
  resolved_at: string | null
  changed: boolean
}

interface CommentRow {
  comment: string
  is_resolved: boolean
  resolved_by: string | null
  resolved_at: string | null
  review_round: number | null
}

let db: PGlite

async function setResolved(user: string, commentId: string, resolved: boolean): Promise<ResolveResult> {
  await actAs(db, user)
  const r = await db.query<{ r: ResolveResult }>('SELECT file_comment_set_resolved($1, $2) AS r', [commentId, resolved])
  return r.rows[0].r
}

/** The refusal's HINT (COMMENT_NOT_FOUND, FORBIDDEN, ...), or null when the call succeeded. */
async function refusal(user: string, commentId: string | null, resolved: boolean | null): Promise<string | null> {
  await actAs(db, user)
  try {
    await db.query('SELECT file_comment_set_resolved($1, $2)', [commentId, resolved])
    return null
  } catch (e) {
    const hint = (e as { hint?: string }).hint
    return hint ?? (e instanceof Error ? e.message : String(e))
  }
}

async function comment(id: string): Promise<CommentRow> {
  await actAsOwner(db)
  const r = await db.query<CommentRow>(
    'SELECT comment, is_resolved, resolved_by, resolved_at::text, review_round FROM file_comment WHERE id = $1',
    [id],
  )
  return r.rows[0]
}

async function reset(id: string): Promise<void> {
  await actAsOwner(db)
  await db.query('UPDATE file_comment SET is_resolved = false, resolved_by = NULL, resolved_at = NULL WHERE id = $1', [id])
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
      ${user(WITHDRAWN, 'withdrawn@a.test', ORG_A, 'engineer')},
      ${user(OUTSIDER, 'outsider@a.test', ORG_A, 'engineer')},
      ${user(EDITOR, 'editor@a.test', ORG_A, 'engineer')},
      ${user(NO_VAULT, 'novault@a.test', ORG_A, 'engineer')},
      ${user(VAULT_EDITOR, 'vaulteditor@a.test', ORG_A, 'engineer')},
      ${user(OTHER_ADMIN, 'admin@b.test', ORG_B, 'admin')};
    INSERT INTO vault (id, org_id, name, slug) VALUES ('${VA1}', '${ORG_A}', 'A1', 'a1');
    INSERT INTO vault_access (vault_id, user_id) VALUES
      ('${VA1}', '${AUTHOR}'), ('${VA1}', '${REVIEWER}'), ('${VA1}', '${WITHDRAWN}'),
      ('${VA1}', '${OUTSIDER}'), ('${VA1}', '${EDITOR}'), ('${VA1}', '${VAULT_EDITOR}');
    INSERT INTO team (id, org_id, name) VALUES ('${EDITORS}', '${ORG_A}', 'Editors'), ('${VA1_EDITORS}', '${ORG_A}', 'A1 editors');
    INSERT INTO team_member (team_id, user_id) VALUES
      ('${EDITORS}', '${EDITOR}'), ('${EDITORS}', '${NO_VAULT}'), ('${VA1_EDITORS}', '${VAULT_EDITOR}');
    INSERT INTO team_permission (team_id, resource, actions, vault_id) VALUES
      ('${EDITORS}', 'module:explorer', '{view,create,edit,delete}', NULL),
      ('${VA1_EDITORS}', 'module:explorer', '{view,edit}', '${VA1}');
    INSERT INTO file (id, org_id, vault_id, file_path, file_name, extension, content_hash, version, created_by) VALUES
      ('${D1}', '${ORG_A}', '${VA1}', 'a1/one.slddrw', 'one.slddrw', '.slddrw', '${H}', 1, '${AUTHOR}');
    INSERT INTO file_version (id, file_id, version, revision, content_hash, created_by) VALUES
      ('${V1}', '${D1}', 1, 'A', '${H}', '${AUTHOR}');
    INSERT INTO review (id, org_id, requested_by, title, status) VALUES
      ('${RV}', '${ORG_A}', '${AUTHOR}', 'One', 'pending');
    INSERT INTO review_item (id, org_id, review_id, file_id, file_version_id) VALUES
      ('${ITEM}', '${ORG_A}', '${RV}', '${D1}', '${V1}');
    INSERT INTO review_response (org_id, review_id, round_number, reviewer_id, status, withdrawn_at, withdrawn_reason) VALUES
      ('${ORG_A}', '${RV}', 1, '${REVIEWER}', 'pending', NULL, NULL),
      ('${ORG_A}', '${RV}', 1, '${WITHDRAWN}', 'cancelled', now(), 'lost_vault_access');
    INSERT INTO file_comment (id, file_id, user_id, comment, review_id, review_round, review_item_id) VALUES
      ('${C_REVIEW}', '${D1}', '${REVIEWER}', 'Dimension 42 has no tolerance', '${RV}', 1, '${ITEM}'),
      ('${C_PLAIN}', '${D1}', '${OUTSIDER}', 'Old note', NULL, NULL, NULL);
    `,
  )
}, 240_000)

afterAll(async () => {
  await db?.close()
})

describe('supabase/migrations/0512_comment_resolve.sql', () => {
  it('follows the runner contract and stamps 512', async () => {
    const sql = readSql(resolve(MIGRATIONS, '0512_comment_resolve.sql'))
    expect(sql).not.toMatch(/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/im)
    expect(sql).toContain('LANGUAGE sql IMMUTABLE AS $$ SELECT 512 $$;')
    await actAsOwner(db)
    const r = await db.query<{ v: { stamped: boolean; version: number; problems: unknown[] } }>(
      'SELECT verify_and_stamp_schema() AS v',
    )
    expect(r.rows[0].v.problems).toEqual([])
    expect(r.rows[0].v).toMatchObject({ stamped: true, version: 512 })
  }, 600_000)
})

describe('file_comment_set_resolved() on a review comment', () => {
  it("lets the review's requester resolve a reviewer's markup, and reopen it", async () => {
    const r = await setResolved(AUTHOR, C_REVIEW, true)
    expect(r).toMatchObject({ id: C_REVIEW, file_id: D1, is_resolved: true, resolved_by: AUTHOR, changed: true })
    expect(r.resolved_at).not.toBeNull()
    const row = await comment(C_REVIEW)
    expect(row).toMatchObject({ comment: 'Dimension 42 has no tolerance', is_resolved: true, resolved_by: AUTHOR })

    expect(await setResolved(AUTHOR, C_REVIEW, true)).toMatchObject({ is_resolved: true, resolved_by: AUTHOR, changed: false })

    expect(await setResolved(AUTHOR, C_REVIEW, false)).toMatchObject({ is_resolved: false, resolved_by: null, resolved_at: null, changed: true })
    expect(await comment(C_REVIEW)).toMatchObject({ is_resolved: false, resolved_by: null, resolved_at: null })
  })

  it('lets the comment author, a reviewer and an administrator resolve it', async () => {
    expect(await setResolved(REVIEWER, C_REVIEW, true)).toMatchObject({ resolved_by: REVIEWER, changed: true })
    await reset(C_REVIEW)
    expect(await setResolved(ADMIN, C_REVIEW, true)).toMatchObject({ resolved_by: ADMIN, changed: true })
    await reset(C_REVIEW)
  })

  it('refuses a withdrawn reviewer, a member outside the review and explorer edit alone', async () => {
    expect(await refusal(WITHDRAWN, C_REVIEW, true)).toBe('FORBIDDEN')
    expect(await refusal(OUTSIDER, C_REVIEW, true)).toBe('FORBIDDEN')
    expect(await refusal(EDITOR, C_REVIEW, true)).toBe('FORBIDDEN')
    expect(await comment(C_REVIEW)).toMatchObject({ is_resolved: false, resolved_by: null })
  })

  it('resolves a comment from an earlier round', async () => {
    await actAsOwner(db)
    await db.query('UPDATE review SET current_round = 2 WHERE id = $1', [RV])
    expect(await setResolved(AUTHOR, C_REVIEW, true)).toMatchObject({ is_resolved: true, changed: true })
    expect(await comment(C_REVIEW)).toMatchObject({ review_round: 1, comment: 'Dimension 42 has no tolerance' })
    await reset(C_REVIEW)
  })

  it('works on a closed review', async () => {
    await actAsOwner(db)
    await db.query(`UPDATE review SET status = 'approved' WHERE id = $1`, [RV])
    expect(await setResolved(REVIEWER, C_REVIEW, true)).toMatchObject({ is_resolved: true, changed: true })
    await reset(C_REVIEW)
  })
})

describe('file_comment_set_resolved() on a comment outside a review', () => {
  it('lets explorer edit (all vaults or this vault) and the author resolve it', async () => {
    expect(await setResolved(EDITOR, C_PLAIN, true)).toMatchObject({ resolved_by: EDITOR, changed: true })
    await reset(C_PLAIN)
    expect(await setResolved(VAULT_EDITOR, C_PLAIN, true)).toMatchObject({ resolved_by: VAULT_EDITOR, changed: true })
    await reset(C_PLAIN)
    expect(await setResolved(OUTSIDER, C_PLAIN, true)).toMatchObject({ resolved_by: OUTSIDER, changed: true })
    await reset(C_PLAIN)
  })

  it("refuses a reviewer without explorer edit: the review's roles do not reach other comments", async () => {
    expect(await refusal(AUTHOR, C_PLAIN, true)).toBe('FORBIDDEN')
    expect(await refusal(REVIEWER, C_PLAIN, true)).toBe('FORBIDDEN')
  })
})

describe('file_comment_set_resolved() and access', () => {
  it("refuses a caller who cannot read the file's vault exactly like a missing comment", async () => {
    expect(await refusal(NO_VAULT, C_PLAIN, true)).toBe('COMMENT_NOT_FOUND')
    expect(await refusal(NO_VAULT, C_REVIEW, true)).toBe('COMMENT_NOT_FOUND')
    expect(await refusal(OTHER_ADMIN, C_REVIEW, true)).toBe('COMMENT_NOT_FOUND')
    expect(await refusal(AUTHOR, MISSING, true)).toBe('COMMENT_NOT_FOUND')
  })

  it('refuses a reviewer who lost the vault', async () => {
    await actAsOwner(db)
    await db.query('DELETE FROM vault_access WHERE vault_id = $1 AND user_id = $2', [VA1, REVIEWER])
    expect(await refusal(REVIEWER, C_REVIEW, true)).toBe('COMMENT_NOT_FOUND')
    await seed(db, `INSERT INTO vault_access (vault_id, user_id) VALUES ('${VA1}', '${REVIEWER}');`)
  })

  it('refuses missing arguments', async () => {
    expect(await refusal(AUTHOR, null, true)).toBe('BAD_ARGUMENTS')
    expect(await refusal(AUTHOR, C_REVIEW, null)).toBe('BAD_ARGUMENTS')
  })

  it('leaves the update policy the author\'s: a direct update by the requester changes nothing', async () => {
    await actAs(db, AUTHOR)
    const r = await db.query(`UPDATE file_comment SET is_resolved = true WHERE id = $1 RETURNING id`, [C_REVIEW])
    expect(r.rows).toEqual([])
    expect(await comment(C_REVIEW)).toMatchObject({ is_resolved: false })
  })

  it('cannot be called signed out', async () => {
    await actAsOwner(db)
    await db.exec('SET ROLE anon')
    let message = ''
    try {
      await db.query('SELECT file_comment_set_resolved($1, true)', [C_REVIEW])
    } catch (e) {
      message = e instanceof Error ? e.message : String(e)
    }
    await actAsOwner(db)
    expect(message).toMatch(/permission denied/)
  })
})
