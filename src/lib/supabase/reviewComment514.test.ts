/**
 * supabase/migrations/0514_review_comment_notify.sql on real Postgres (PGlite), applied after
 * 0501-0513 to the 5.0 baseline as the migration runner applies them: it stamps 514;
 * trg_file_comment_notify_review() notifies an open review's requester and current-round reviewers
 * (never the commenter, a withdrawn reviewer or someone without the vault) at most once per review per
 * hour; file_comment_list_resolvable() names exactly the comments file_comment_set_resolved() lets
 * the caller resolve; review_list_queue() package rows count the round's owing and withdrawn reviewers.
 */
import type { PGlite } from '@electric-sql/pglite'
import { resolve } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { checkNaming } from '../../../scripts/rename-5.0/namingRules.mjs'
import { inventory } from '../../../scripts/rename-5.0/schemaInventory.mjs'
import { actAs, actAsOwner, bootBaseline, MIGRATIONS, readSql, seed } from './testing/schemaDb'

const ORG_A = '00000000-0000-0000-0000-00000000000a'
const ORG_B = '00000000-0000-0000-0000-00000000000b'
const ADMIN = '00000000-0000-0000-0000-000000000001'
const AUTHOR = '00000000-0000-0000-0000-000000000002' // the review's requester; no explorer edit
const REVIEWER = '00000000-0000-0000-0000-000000000003'
const REVIEWER2 = '00000000-0000-0000-0000-00000000000c'
const WITHDRAWN = '00000000-0000-0000-0000-000000000004' // withdrawn from the review, vault back
const OUTSIDER = '00000000-0000-0000-0000-000000000005' // both vaults, no review, no explorer edit
const EDITOR = '00000000-0000-0000-0000-000000000006' // both vaults, explorer edit everywhere
const NO_VAULT = '00000000-0000-0000-0000-000000000007' // explorer edit, no vault grant
const VAULT_EDITOR = '00000000-0000-0000-0000-000000000008' // both vaults, explorer edit on VA1 only
const OTHER_ADMIN = '00000000-0000-0000-0000-000000000009' // admin of ORG_B
const EDITORS = '10000000-0000-0000-0000-000000000001'
const VA1_EDITORS = '10000000-0000-0000-0000-000000000002'
const VA1 = '40000000-0000-0000-0000-000000000001'
const VA2 = '40000000-0000-0000-0000-000000000002'
const D1 = '50000000-0000-0000-0000-000000000001'
const D2 = '50000000-0000-0000-0000-000000000002'
const V1 = '51000000-0000-0000-0000-000000000001'
const RV = '60000000-0000-0000-0000-000000000001'
const ITEM = '61000000-0000-0000-0000-000000000001'
const C_REVIEW = '70000000-0000-0000-0000-000000000001' // REVIEWER's markup in RV
const C_PLAIN = '70000000-0000-0000-0000-000000000002' // OUTSIDER's comment on D1 (VA1), no review
const C_PLAIN2 = '70000000-0000-0000-0000-000000000003' // OUTSIDER's comment on D2 (VA2), no review
const C_AUTHOR = '70000000-0000-0000-0000-000000000004' // AUTHOR's own comment on D2, no review
const MISSING = '70000000-0000-0000-0000-0000000000ff'
const H = 'a'.repeat(64)

const MIGRATION = '0514_review_comment_notify.sql'
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
  MIGRATION,
]

const PEOPLE = [ADMIN, AUTHOR, REVIEWER, REVIEWER2, WITHDRAWN, OUTSIDER, EDITOR, NO_VAULT, VAULT_EDITOR, OTHER_ADMIN]
const COMMENTS = [C_REVIEW, C_PLAIN, C_PLAIN2, C_AUTHOR]

interface NotificationRow {
  user_id: string
  title: string
  message: string | null
  priority: string | null
  category: string | null
  entity_type: string | null
  entity_id: string | null
  from_user_id: string | null
  action_type: string | null
  action_url: string | null
}

let db: PGlite

/** Insert a comment as `user`, through the insert policy and the triggers, as the app does. */
async function commentAs(
  user: string,
  text: string,
  options: { parentId?: string; reviewId?: string | null; fileId?: string } = {},
): Promise<string> {
  await actAs(db, user)
  const reviewId = options.reviewId === undefined ? RV : options.reviewId
  const r = await db.query<{ id: string }>(
    `INSERT INTO file_comment (file_id, user_id, comment, parent_id, review_id, review_item_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [options.fileId ?? D1, user, text, options.parentId ?? null, reviewId, reviewId ? ITEM : null],
  )
  await actAsOwner(db)
  return r.rows[0].id
}

async function notified(): Promise<NotificationRow[]> {
  await actAsOwner(db)
  const r = await db.query<NotificationRow>(
    `SELECT user_id, title, message, priority, category, entity_type, entity_id, from_user_id, action_type, action_url
       FROM notification WHERE type = 'review_comment' ORDER BY created_at, user_id`,
  )
  return r.rows
}

const recipients = async () => (await notified()).map((n) => n.user_id).sort()

async function setStatus(status: string): Promise<void> {
  await actAsOwner(db)
  await db.query(`UPDATE review SET status = $1::review_status WHERE id = $2`, [status, RV])
}

async function resolvable(user: string, ids: string[] | null): Promise<string[]> {
  await actAs(db, user)
  const r = await db.query<{ ids: string[] }>('SELECT to_jsonb(file_comment_list_resolvable($1::uuid[])) AS ids', [ids])
  return r.rows[0].ids
}

/** file_comment_set_resolved()'s answer for one caller and comment, left as it was afterwards. */
async function mayResolve(user: string, commentId: string): Promise<boolean> {
  await actAs(db, user)
  let ok = true
  try {
    await db.query('SELECT file_comment_set_resolved($1, true)', [commentId])
  } catch {
    ok = false
  }
  await actAsOwner(db)
  await db.query('UPDATE file_comment SET is_resolved = false, resolved_by = NULL, resolved_at = NULL WHERE id = $1', [commentId])
  return ok
}

interface QueueRow {
  id: string
  reviewers_owing: number | null
  reviewers_withdrawn: number | null
}

async function queueRow(user: string, bucket: string): Promise<QueueRow | undefined> {
  await actAs(db, user)
  const r = await db.query<{ q: { rows: QueueRow[] } }>('SELECT review_list_queue($1) AS q', [bucket])
  await actAsOwner(db)
  return r.rows[0].q.rows.find((row) => row.id === RV)
}

beforeAll(async () => {
  db = await bootBaseline()
  await actAsOwner(db)
  for (const m of MIGRATION_FILES) await db.exec(readSql(resolve(MIGRATIONS, m)))
  const user = (id: string, email: string, name: string, org: string, role: string) =>
    `('${id}', '${email}', '${name}', '${org}', '${role}')`
  await seed(
    db,
    `
    INSERT INTO organization (id, name, slug) VALUES ('${ORG_A}', 'A', 'org-a'), ('${ORG_B}', 'B', 'org-b');
    INSERT INTO app_user (id, email, full_name, org_id, role) VALUES
      ${user(ADMIN, 'admin@a.test', 'Ada Admin', ORG_A, 'admin')},
      ${user(AUTHOR, 'author@a.test', 'Ann Author', ORG_A, 'engineer')},
      ${user(REVIEWER, 'reviewer@a.test', 'Sam Rivera', ORG_A, 'engineer')},
      ${user(REVIEWER2, 'reviewer2@a.test', '', ORG_A, 'engineer')},
      ${user(WITHDRAWN, 'withdrawn@a.test', 'Wes Withdrawn', ORG_A, 'engineer')},
      ${user(OUTSIDER, 'outsider@a.test', 'Olive Other', ORG_A, 'engineer')},
      ${user(EDITOR, 'editor@a.test', 'Ed Editor', ORG_A, 'engineer')},
      ${user(NO_VAULT, 'novault@a.test', 'Nia Novault', ORG_A, 'engineer')},
      ${user(VAULT_EDITOR, 'vaulteditor@a.test', 'Val Editor', ORG_A, 'engineer')},
      ${user(OTHER_ADMIN, 'admin@b.test', 'Bo Admin', ORG_B, 'admin')};
    INSERT INTO vault (id, org_id, name, slug) VALUES ('${VA1}', '${ORG_A}', 'A1', 'a1'), ('${VA2}', '${ORG_A}', 'A2', 'a2');
    INSERT INTO vault_access (vault_id, user_id) VALUES
      ('${VA1}', '${AUTHOR}'), ('${VA1}', '${REVIEWER}'), ('${VA1}', '${REVIEWER2}'), ('${VA1}', '${WITHDRAWN}'),
      ('${VA1}', '${OUTSIDER}'), ('${VA1}', '${EDITOR}'), ('${VA1}', '${VAULT_EDITOR}'),
      ('${VA2}', '${AUTHOR}'), ('${VA2}', '${OUTSIDER}'), ('${VA2}', '${EDITOR}'), ('${VA2}', '${VAULT_EDITOR}');
    INSERT INTO team (id, org_id, name) VALUES ('${EDITORS}', '${ORG_A}', 'Editors'), ('${VA1_EDITORS}', '${ORG_A}', 'A1 editors');
    INSERT INTO team_member (team_id, user_id) VALUES
      ('${EDITORS}', '${EDITOR}'), ('${EDITORS}', '${NO_VAULT}'), ('${VA1_EDITORS}', '${VAULT_EDITOR}');
    INSERT INTO team_permission (team_id, resource, actions, vault_id) VALUES
      ('${EDITORS}', 'module:explorer', '{view,create,edit,delete}', NULL),
      ('${VA1_EDITORS}', 'module:explorer', '{view,edit}', '${VA1}');
    INSERT INTO file (id, org_id, vault_id, file_path, file_name, extension, content_hash, version, created_by) VALUES
      ('${D1}', '${ORG_A}', '${VA1}', 'a1/PMP-2001.slddrw', 'PMP-2001.SLDDRW', '.slddrw', '${H}', 1, '${AUTHOR}'),
      ('${D2}', '${ORG_A}', '${VA2}', 'a2/two.slddrw', 'two.slddrw', '.slddrw', '${H}', 1, '${AUTHOR}');
    INSERT INTO file_version (id, file_id, version, revision, content_hash, created_by) VALUES
      ('${V1}', '${D1}', 1, 'A', '${H}', '${AUTHOR}');
    INSERT INTO review (id, org_id, requested_by, title, status, priority) VALUES
      ('${RV}', '${ORG_A}', '${AUTHOR}', 'Pump housing, rev C', 'pending', 'high');
    INSERT INTO review_item (id, org_id, review_id, file_id, file_version_id) VALUES
      ('${ITEM}', '${ORG_A}', '${RV}', '${D1}', '${V1}');
    INSERT INTO review_response (org_id, review_id, round_number, reviewer_id, status, withdrawn_at, withdrawn_reason) VALUES
      ('${ORG_A}', '${RV}', 1, '${REVIEWER}', 'pending', NULL, NULL),
      ('${ORG_A}', '${RV}', 1, '${REVIEWER2}', 'pending', NULL, NULL),
      ('${ORG_A}', '${RV}', 1, '${WITHDRAWN}', 'cancelled', now(), 'lost_vault_access');
    INSERT INTO file_comment (id, file_id, user_id, comment, review_id, review_round, review_item_id) VALUES
      ('${C_REVIEW}', '${D1}', '${REVIEWER}', 'Dimension 42 has no tolerance', '${RV}', 1, '${ITEM}'),
      ('${C_PLAIN}', '${D1}', '${OUTSIDER}', 'Old note', NULL, NULL, NULL),
      ('${C_PLAIN2}', '${D2}', '${OUTSIDER}', 'Note in the second vault', NULL, NULL, NULL),
      ('${C_AUTHOR}', '${D2}', '${AUTHOR}', 'My own note', NULL, NULL, NULL);
    `,
  )
}, 240_000)

afterAll(async () => {
  await db?.close()
})

describe('supabase/migrations/0514_review_comment_notify.sql', () => {
  it('follows the runner contract and stamps 514', async () => {
    const sql = readSql(resolve(MIGRATIONS, MIGRATION))
    expect(sql).not.toMatch(/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/im)
    expect(sql).not.toMatch(/^-- blueplm:no-transaction/)
    expect(sql).toContain('LANGUAGE sql IMMUTABLE AS $$ SELECT 514 $$;')
    await actAsOwner(db)
    const r = await db.query<{ v: { stamped: boolean; version: number; problems: unknown[] } }>(
      'SELECT verify_and_stamp_schema() AS v',
    )
    expect(r.rows[0].v.problems).toEqual([])
    expect(r.rows[0].v).toMatchObject({ stamped: true, version: 514 })
  }, 600_000)

  it('follows the naming rules', () => {
    const inv = inventory([{ file: MIGRATION, text: readSql(resolve(MIGRATIONS, MIGRATION)) }])
    expect(checkNaming(inv).map((v) => `${v.kind} ${v.name}: ${v.rule}`)).toEqual([])
  })
})

describe('trg_file_comment_notify_review()', () => {
  beforeEach(async () => {
    await actAsOwner(db)
    await db.exec(`DELETE FROM notification; DELETE FROM file_comment WHERE id NOT IN ('${COMMENTS.join("','")}');`)
    await setStatus('pending')
  })

  it("notifies the requester and the other current reviewers of a reviewer's comment, never the commenter", async () => {
    const id = await commentAs(REVIEWER, 'Bore has no tolerance. H7?')
    expect(await recipients()).toEqual([AUTHOR, REVIEWER2].sort())
    const [first] = await notified()
    expect(first).toMatchObject({
      title: 'Sam Rivera commented on PMP-2001.SLDDRW',
      message: 'Bore has no tolerance. H7?',
      priority: 'high',
      category: 'review',
      entity_type: 'review',
      entity_id: RV,
      from_user_id: REVIEWER,
      action_type: 'open_review',
      action_url: `review/${RV}/item/${ITEM}/comment/${id}`,
    })
  })

  it('names a reply, points at its thread, and falls back to the email for a blank name', async () => {
    await commentAs(REVIEWER2, 'Agreed, H7.', { parentId: C_REVIEW })
    const rows = await notified()
    expect(rows.map((n) => n.user_id).sort()).toEqual([AUTHOR, REVIEWER].sort())
    expect(rows[0].title).toBe('reviewer2@a.test replied to a comment on PMP-2001.SLDDRW')
    expect(rows[0].action_url).toBe(`review/${RV}/item/${ITEM}/comment/${C_REVIEW}`)
  })

  it('notifies each recipient once per review per hour', async () => {
    await commentAs(REVIEWER, 'First')
    await commentAs(REVIEWER, 'Second')
    expect(await recipients()).toEqual([AUTHOR, REVIEWER2].sort())
    // The author replies: Sam has not heard about this review yet, Reviewer 2 has.
    await commentAs(AUTHOR, 'Fixed in v2', { parentId: C_REVIEW })
    expect(await recipients()).toEqual([AUTHOR, REVIEWER, REVIEWER2].sort())
    // An hour on, the next comment is news again.
    await db.exec(`UPDATE notification SET created_at = now() - interval '61 minutes'`)
    await commentAs(REVIEWER, 'Third')
    expect((await recipients()).filter((u) => u === AUTHOR)).toHaveLength(2)
    expect((await recipients()).filter((u) => u === REVIEWER2)).toHaveLength(2)
  })

  it("notifies everyone working on the review of an administrator's comment, and only them", async () => {
    await commentAs(ADMIN, 'Please also check the title block.')
    expect(await recipients()).toEqual([AUTHOR, REVIEWER, REVIEWER2].sort())
  })

  it('leaves out a withdrawn reviewer and a requester who cannot read the vault', async () => {
    await actAsOwner(db)
    await db.query('DELETE FROM vault_access WHERE vault_id = $1 AND user_id = $2', [VA1, AUTHOR])
    await commentAs(REVIEWER, 'Still waiting on the author')
    expect(await recipients()).toEqual([REVIEWER2])
    await seed(db, `INSERT INTO vault_access (vault_id, user_id) VALUES ('${VA1}', '${AUTHOR}');`)
  })

  it('notifies while changes are requested, and never on a closed review', async () => {
    await setStatus('kicked_back')
    await commentAs(REVIEWER, 'See the kickback note')
    expect(await recipients()).toEqual([AUTHOR, REVIEWER2].sort())
    for (const status of ['approved', 'rejected', 'cancelled']) {
      await actAsOwner(db)
      await db.exec('DELETE FROM notification')
      await setStatus(status)
      await commentAs(REVIEWER, `After ${status}`)
      expect(await recipients()).toEqual([])
    }
  })

  it('stays quiet for a comment outside a review, and for edits', async () => {
    await commentAs(OUTSIDER, 'No review here', { reviewId: null })
    await actAs(db, REVIEWER)
    await db.query(`UPDATE file_comment SET comment = 'Edited' WHERE id = $1`, [C_REVIEW])
    expect(await recipients()).toEqual([])
  })

  it('takes the per-review lock before it checks and writes, so concurrent comments cannot both notify', async () => {
    const r = await db.query<{ src: string }>(`SELECT prosrc AS src FROM pg_proc WHERE proname = 'trg_file_comment_notify_review'`)
    const src = r.rows[0].src
    const lock = src.indexOf("pg_advisory_xact_lock(hashtext('trg_file_comment_notify_review'), hashtext(r.id::text))")
    expect(lock).toBeGreaterThan(0)
    expect(lock).toBeLessThan(src.indexOf('INSERT INTO notification'))
    // Held to the end of the commenting transaction: two comments in one transaction notify once.
    await actAs(db, REVIEWER)
    await db.exec('BEGIN')
    for (const text of ['One', 'Two']) {
      await db.query(
        `INSERT INTO file_comment (file_id, user_id, comment, review_id, review_item_id) VALUES ($1, $2, $3, $4, $5)`,
        [D1, REVIEWER, text, RV, ITEM],
      )
    }
    const held = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND granted AND pid = pg_backend_pid()`,
    )
    await db.exec('COMMIT')
    expect(held.rows[0].n).toBeGreaterThan(0)
    expect(await recipients()).toEqual([AUTHOR, REVIEWER2].sort())
  })

  it('shortens a long comment to 140 characters', async () => {
    await commentAs(REVIEWER, `${'word '.repeat(60)}end`)
    const [row] = await notified()
    expect(row.message).toHaveLength(140)
    expect(row.message?.endsWith('…')).toBe(true)
    expect(row.message).not.toContain('  ')
  })
})

describe('file_comment_list_resolvable()', () => {
  it('names exactly the comments file_comment_set_resolved() lets each caller resolve', async () => {
    await setStatus('pending')
    const mismatches: string[] = []
    for (const person of PEOPLE) {
      const listed = new Set(await resolvable(person, [...COMMENTS, MISSING]))
      for (const c of COMMENTS) {
        const allowed = await mayResolve(person, c)
        if (listed.has(c) !== allowed) mismatches.push(`${person} ${c}: listed ${listed.has(c)}, allowed ${allowed}`)
      }
      expect(listed.has(MISSING)).toBe(false)
    }
    expect(mismatches).toEqual([])
  })

  it('counts explorer edit on the comment’s own vault only', async () => {
    expect((await resolvable(VAULT_EDITOR, COMMENTS)).sort()).toEqual([C_PLAIN])
    expect((await resolvable(EDITOR, COMMENTS)).sort()).toEqual([C_PLAIN, C_PLAIN2, C_AUTHOR].sort())
    expect(await mayResolve(VAULT_EDITOR, C_PLAIN2)).toBe(false)
  })

  it('follows the review roles, never past the vault or the organization', async () => {
    expect((await resolvable(AUTHOR, COMMENTS)).sort()).toEqual([C_REVIEW, C_AUTHOR].sort())
    expect(await resolvable(WITHDRAWN, COMMENTS)).toEqual([])
    expect((await resolvable(ADMIN, COMMENTS)).sort()).toEqual([...COMMENTS].sort())
    expect(await resolvable(NO_VAULT, COMMENTS)).toEqual([])
    expect(await resolvable(OTHER_ADMIN, COMMENTS)).toEqual([])
    expect(await resolvable(AUTHOR, [])).toEqual([])
  })

  it('refuses a missing list, and cannot be called signed out', async () => {
    const failure = async (sql: string, params: unknown[] = []) => {
      try {
        await db.query(sql, params)
        return null
      } catch (e) {
        const hint = (e as { hint?: string }).hint
        return hint ?? (e instanceof Error ? e.message : String(e))
      }
    }
    await actAs(db, AUTHOR)
    expect(await failure('SELECT file_comment_list_resolvable(NULL)')).toBe('BAD_ARGUMENTS')
    await actAsOwner(db)
    await db.exec('SET ROLE anon')
    expect(await failure('SELECT file_comment_list_resolvable($1::uuid[])', [[C_PLAIN]])).toMatch(/permission denied/)
    await actAsOwner(db)
  })
})

describe('review_list_queue() reviewer counts', () => {
  it("counts the round's owing and withdrawn reviewers, down to nobody left to decide", async () => {
    await setStatus('pending')
    expect(await queueRow(AUTHOR, 'requested_by_me')).toMatchObject({ reviewers_owing: 2, reviewers_withdrawn: 1 })
    await db.exec(
      `UPDATE review_response SET withdrawn_at = now(), withdrawn_reason = 'left_org', status = 'cancelled'
        WHERE review_id = '${RV}' AND reviewer_id IN ('${REVIEWER}', '${REVIEWER2}')`,
    )
    expect(await queueRow(AUTHOR, 'requested_by_me')).toMatchObject({ reviewers_owing: 0, reviewers_withdrawn: 3 })
    await db.exec(
      `UPDATE review_response SET withdrawn_at = NULL, withdrawn_reason = NULL, status = 'pending'
        WHERE review_id = '${RV}' AND reviewer_id IN ('${REVIEWER}', '${REVIEWER2}')`,
    )
  })
})
