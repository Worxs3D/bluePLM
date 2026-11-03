/**
 * supabase/migrations/0509_release_versions.sql on real Postgres (PGlite), applied after
 * 0501-0508 to the 5.0 baseline as the migration runner applies them: it stamps 509 with the
 * residue checks clean; a drawing enters a releasing state only with an approved review of that
 * version or forced (recorded, with history and activity); a review stage's approval releases
 * with the review named; parts are not gated; the release columns are written by transitions
 * only; a released version's exports and reports are frozen; a report of the same version is
 * overwritten in place until it is released or returned; the per-file auto export list; the new
 * default workflow; and the 3-argument entry point of 5.8.0 still runs.
 */
import type { PGlite } from '@electric-sql/pglite'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { actAs, actAsOwner, bootBaseline, MIGRATIONS, readSql, seed } from './testing/schemaDb'

const ORG_A = '00000000-0000-0000-0000-00000000000a'
const ADMIN = '00000000-0000-0000-0000-000000000001'
const ALICE = '00000000-0000-0000-0000-000000000002' // vault VA1, explorer edit
const CAROL = '00000000-0000-0000-0000-000000000004' // explorer edit, no vault
const EDITORS = '30000000-0000-0000-0000-000000000001'
const VA1 = '40000000-0000-0000-0000-000000000001'
const D1 = '50000000-0000-0000-0000-000000000001' // drawing, no review: gated, then forced
const D2 = '50000000-0000-0000-0000-000000000002' // drawing, approved review of v1
const D3 = '50000000-0000-0000-0000-000000000003' // drawing in the review stage, item approved
const D4 = '50000000-0000-0000-0000-000000000004' // drawing, not released: reports overwritten
const P1 = '50000000-0000-0000-0000-000000000005' // part, no review
const V_D1 = '51000000-0000-0000-0000-000000000001'
const V_D2 = '51000000-0000-0000-0000-000000000002'
const V_D3 = '51000000-0000-0000-0000-000000000003'
const V_D4 = '51000000-0000-0000-0000-000000000004'
const V_P1 = '51000000-0000-0000-0000-000000000005'
const PDF_D1 = '60000000-0000-0000-0000-000000000001'
const OUT_D1 = '61000000-0000-0000-0000-000000000001'
const REP_D1 = '70000000-0000-0000-0000-000000000001'
const REP_D4A = '70000000-0000-0000-0000-000000000002'
const REP_D4B = '70000000-0000-0000-0000-000000000003' // a filled-in workbook came back
const RV2 = '80000000-0000-0000-0000-000000000002'
const RV3 = '80000000-0000-0000-0000-000000000003'
const OLD_WF = '90000000-0000-0000-0000-000000000001'
const OLD_RELEASED = '91000000-0000-0000-0000-000000000001'
const OLD_RELEASED_EDITABLE = '91000000-0000-0000-0000-000000000002'
const H = (n: number) => String(n).repeat(64)
const H_REPORT = 'a'.repeat(64) // Alice's uploads
const H_NEW = 'b'.repeat(64)
const H_STEP = 'c'.repeat(64)

const BEFORE = [
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
let wf: string
const state: Record<string, string> = {}
const transition: Record<string, string> = {}

async function error(sql: string, params: unknown[] = []): Promise<string | null> {
  try {
    await db.query(sql, params)
    return null
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

interface TransitionResult {
  success: boolean
  error_code?: string
  release_forced?: boolean
  released_file_version_id?: string | null
}

async function run(user: string, file: string, name: string, force?: boolean, comment: string | null = null) {
  await actAs(db, user)
  const r =
    force === undefined
      ? await db.query<{ r: TransitionResult }>('SELECT workflow_transition_execute($1::uuid, $2::uuid, $3::text) AS r', [
          file,
          transition[name],
          comment,
        ])
      : await db.query<{ r: TransitionResult }>(
          'SELECT workflow_transition_execute($1::uuid, $2::uuid, $3::text, $4::boolean) AS r',
          [file, transition[name], comment, force],
        )
  return r.rows[0].r
}

interface ReleaseRow {
  released_at: string | null
  released_by: string | null
  release_forced: boolean
  release_review_id: string | null
  release_note: string | null
  release_revision: string | null
}

async function release(versionId: string): Promise<ReleaseRow> {
  await actAsOwner(db)
  const r = await db.query<ReleaseRow>(
    `SELECT released_at::text, released_by, release_forced, release_review_id, release_note, release_revision
       FROM file_version WHERE id = $1`,
    [versionId],
  )
  return r.rows[0]
}

beforeAll(async () => {
  db = await bootBaseline()
  await actAsOwner(db)
  for (const m of BEFORE) await db.exec(readSql(resolve(MIGRATIONS, m)))
  const user = (id: string, email: string, role: string) => `('${id}', '${email}', '${ORG_A}', '${role}')`
  const file = (id: string, name: string, ext: string) =>
    `('${id}', '${ORG_A}', '${VA1}', 'a1/${name}', '${name}', '${ext}', '${H(1)}', 1, 'A', '${ADMIN}')`
  const version = (id: string, fileId: string) => `('${id}', '${fileId}', 1, 'A', '${H(1)}', '${ADMIN}', '2020-01-01')`
  const object = (hash: string) => `('vault', '${ORG_A}/${hash.slice(0, 2)}/${hash}', '${ALICE}', '${ALICE}')`
  // Stands as it did before 509: a template with a non-editable Released state (backfilled) and an
  // editable one (left alone).
  await seed(
    db,
    `
    INSERT INTO organization (id, name, slug) VALUES ('${ORG_A}', 'A', 'org-a');
    INSERT INTO app_user (id, email, org_id, role) VALUES
      ${user(ADMIN, 'admin@a.test', 'admin')},
      ${user(ALICE, 'alice@a.test', 'engineer')},
      ${user(CAROL, 'carol@a.test', 'engineer')};
    INSERT INTO team (id, org_id, name) VALUES ('${EDITORS}', '${ORG_A}', 'Editors');
    INSERT INTO team_member (team_id, user_id) VALUES ('${EDITORS}', '${ALICE}'), ('${EDITORS}', '${CAROL}');
    INSERT INTO team_permission (team_id, resource, actions) VALUES ('${EDITORS}', 'module:explorer', '{view,create,edit,delete}');
    INSERT INTO vault (id, org_id, name, slug) VALUES ('${VA1}', '${ORG_A}', 'A1', 'a1');
    INSERT INTO vault_access (vault_id, user_id) VALUES ('${VA1}', '${ALICE}');
    INSERT INTO workflow_template (id, org_id, name) VALUES ('${OLD_WF}', '${ORG_A}', 'Old');
    INSERT INTO workflow_state (id, workflow_id, name, is_editable) VALUES
      ('${OLD_RELEASED}', '${OLD_WF}', ' released ', false),
      ('${OLD_RELEASED_EDITABLE}', '${OLD_WF}', 'Released', true);
    INSERT INTO file (id, org_id, vault_id, file_path, file_name, extension, content_hash, version, revision, created_by) VALUES
      ${file(D1, 'one.slddrw', '.slddrw')},
      ${file(D2, 'two.slddrw', '.slddrw')},
      ${file(D3, 'three.SLDDRW', '.SLDDRW')},
      ${file(D4, 'four.slddrw', '.slddrw')},
      ${file(P1, 'part.sldprt', '.sldprt')};
    INSERT INTO file_version (id, file_id, version, revision, content_hash, created_by, created_at) VALUES
      ${version(V_D1, D1)}, ${version(V_D2, D2)}, ${version(V_D3, D3)}, ${version(V_D4, D4)}, ${version(V_P1, P1)};
    INSERT INTO storage.objects (bucket_id, name, owner, owner_id) VALUES
      ${object(H_REPORT)}, ${object(H_NEW)}, ${object(H_STEP)};
    INSERT INTO drawing_pdf_render (id, org_id, file_id, file_version_id, storage_hash, file_size, generated_by) VALUES
      ('${PDF_D1}', '${ORG_A}', '${D1}', '${V_D1}', '${H(3)}', 10, '${ALICE}');
    INSERT INTO file_version_output (id, org_id, file_id, file_version_id, kind, storage_hash, file_size, file_name, generated_by) VALUES
      ('${OUT_D1}', '${ORG_A}', '${D1}', '${V_D1}', 'dxf', '${H(4)}', 10, 'one.dxf', '${ALICE}');
    INSERT INTO inspection_report (id, org_id, file_id, file_version_id, report_number, storage_hash, file_size, created_by, returned_hash) VALUES
      ('${REP_D1}', '${ORG_A}', '${D1}', '${V_D1}', 'R-1', '${H_REPORT}', 10, '${ALICE}', NULL),
      ('${REP_D4A}', '${ORG_A}', '${D4}', '${V_D4}', 'R-2', '${H_REPORT}', 10, '${ALICE}', NULL),
      ('${REP_D4B}', '${ORG_A}', '${D4}', '${V_D4}', 'R-3', '${H_REPORT}', 10, '${ALICE}', '${H(5)}');
    INSERT INTO review (id, org_id, requested_by, title, status) VALUES
      ('${RV2}', '${ORG_A}', '${ADMIN}', 'Two', 'approved'),
      ('${RV3}', '${ORG_A}', '${ADMIN}', 'Three', 'pending');
    INSERT INTO review_item (org_id, review_id, file_id, file_version_id, outcome) VALUES
      ('${ORG_A}', '${RV2}', '${D2}', '${V_D2}', 'approved'),
      ('${ORG_A}', '${RV3}', '${D3}', '${V_D3}', 'approved');
    `,
  )

  await db.exec(readSql(resolve(MIGRATIONS, '0509_release_versions.sql')))

  await actAs(db, ADMIN)
  const created = await db.query<{ id: string }>('SELECT workflow_create_default($1) AS id', [ORG_A])
  wf = created.rows[0].id
  await actAsOwner(db)
  for (const s of (await db.query<{ id: string; name: string }>('SELECT id, name FROM workflow_state WHERE workflow_id = $1', [wf])).rows) {
    state[s.name] = s.id
  }
  for (const t of (
    await db.query<{ id: string; name: string }>('SELECT id, name FROM workflow_transition WHERE workflow_id = $1', [wf])
  ).rows) {
    transition[t.name] = t.id
  }
  const assign = (f: string, s: string) => `('${f}', '${wf}', '${state[s]}')`
  await seed(
    db,
    `
    INSERT INTO file_workflow_assignment (file_id, workflow_id, current_state_id) VALUES
      ${assign(D1, 'WIP')}, ${assign(D2, 'WIP')}, ${assign(D3, 'In Review')}, ${assign(D4, 'WIP')}, ${assign(P1, 'WIP')};
    UPDATE file SET workflow_state_id = '${state.WIP}' WHERE id IN ('${D1}', '${D2}', '${D4}', '${P1}');
    UPDATE file SET workflow_state_id = '${state['In Review']}' WHERE id = '${D3}';
    `,
  )
}, 240_000)

afterAll(async () => {
  await db?.close()
})

describe('supabase/migrations/0509_release_versions.sql', () => {
  it('follows the runner contract and stamps 509 with the residue checks clean', async () => {
    const sql = readSql(resolve(MIGRATIONS, '0509_release_versions.sql'))
    expect(sql).not.toMatch(/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/im)
    expect(sql).toContain('LANGUAGE sql IMMUTABLE AS $$ SELECT 509 $$;')
    await actAsOwner(db)
    const r = await db.query<{ v: { stamped: boolean; version: number; problems: unknown[] } }>(
      'SELECT verify_and_stamp_schema() AS v',
    )
    expect(r.rows[0].v.problems).toEqual([])
    expect(r.rows[0].v).toMatchObject({ stamped: true, version: 509 })
    const unbound = await db.query('SELECT * FROM check_unbound_entity_args()')
    expect(unbound.rows).toEqual([])
  }, 600_000)

  it('backfills releases_version for non-editable states named Released only', async () => {
    await actAsOwner(db)
    const r = await db.query<{ id: string; releases_version: boolean }>(
      'SELECT id, releases_version FROM workflow_state WHERE workflow_id = $1 ORDER BY id',
      [OLD_WF],
    )
    expect(r.rows).toEqual([
      { id: OLD_RELEASED, releases_version: true },
      { id: OLD_RELEASED_EDITABLE, releases_version: false },
    ])
  })
})

describe('workflow_create_default()', () => {
  it('creates WIP -> In Review -> Released -> Obsolete with the review stage and the releasing state', async () => {
    await actAsOwner(db)
    const states = await db.query<Record<string, unknown>>(
      `SELECT name, is_editable, is_checkout_required, is_review_stage, review_approved_state_id,
              releases_version, is_revision_auto_incremented
         FROM workflow_state WHERE workflow_id = $1 ORDER BY sort_order`,
      [wf],
    )
    expect(states.rows).toEqual([
      { name: 'WIP', is_editable: true, is_checkout_required: true, is_review_stage: false, review_approved_state_id: null, releases_version: false, is_revision_auto_incremented: false },
      { name: 'In Review', is_editable: false, is_checkout_required: false, is_review_stage: true, review_approved_state_id: state.Released, releases_version: false, is_revision_auto_incremented: false },
      { name: 'Released', is_editable: false, is_checkout_required: false, is_review_stage: false, review_approved_state_id: null, releases_version: true, is_revision_auto_incremented: true },
      { name: 'Obsolete', is_editable: false, is_checkout_required: false, is_review_stage: false, review_approved_state_id: null, releases_version: false, is_revision_auto_incremented: false },
    ])
    expect(Object.keys(transition).sort()).toEqual(
      ['Obsolete', 'Reinstate', 'Release', 'Release directly', 'Return to WIP', 'Revise', 'Submit for review'],
    )
    const exit = await db.query<{ t: string }>('SELECT review_stage_get_exit_transition($1) AS t', [state['In Review']])
    expect(exit.rows[0].t).toBe(transition.Release)
    const tpl = await db.query<{ is_default: boolean; created_by: string }>(
      'SELECT is_default, created_by FROM workflow_template WHERE id = $1',
      [wf],
    )
    expect(tpl.rows[0]).toEqual({ is_default: true, created_by: ADMIN })
  })

  it('is for administrators only', async () => {
    await actAs(db, ALICE)
    expect(await error('SELECT workflow_create_default($1)', [ORG_A])).toMatch(/Only admins/)
  })
})

describe('the drawing release gate', () => {
  it('refuses to release a drawing version with no approved review (4-argument form, no force)', async () => {
    const r4 = await run(ALICE, D1, 'Release directly', false)
    expect(r4).toMatchObject({ success: false, error_code: 'RELEASE_NOT_REVIEWED' })
    expect((await release(V_D1)).released_at).toBeNull()
  })

  it("releases an unreviewed drawing through 5.8.0's 3-argument form as forced, saying so", async () => {
    const D5 = '50000000-0000-0000-0000-000000000007'
    const V_D5 = '51000000-0000-0000-0000-000000000007'
    await seed(
      db,
      `
      INSERT INTO file (id, org_id, vault_id, file_path, file_name, extension, content_hash, version, revision, created_by, workflow_state_id)
        VALUES ('${D5}', '${ORG_A}', '${VA1}', 'a1/five.slddrw', 'five.slddrw', '.slddrw', '${H(1)}', 1, 'A', '${ADMIN}', '${state.WIP}');
      INSERT INTO file_version (id, file_id, version, revision, content_hash, created_by, created_at)
        VALUES ('${V_D5}', '${D5}', 1, 'A', '${H(1)}', '${ADMIN}', '2020-01-01');
      INSERT INTO file_workflow_assignment (file_id, workflow_id, current_state_id) VALUES ('${D5}', '${wf}', '${state.WIP}');
      `,
    )
    const r = await run(ALICE, D5, 'Release directly', undefined, 'old client')
    expect(r).toMatchObject({ success: true, release_forced: true, released_file_version_id: V_D5 })
    expect(await release(V_D5)).toMatchObject({
      release_forced: true,
      released_by: ALICE,
      release_note: 'Released by a client without the release check: old client',
    })
    await actAsOwner(db)
    const act = await db.query<{ d: Record<string, unknown> }>(
      `SELECT details AS d FROM activity WHERE file_id = $1 AND details ? 'forced_release'`,
      [D5],
    )
    expect(act.rows).toHaveLength(1)
    expect(act.rows[0].d).toMatchObject({
      forced_release: true,
      legacy_client: true,
      reason: 'Released by a client without the release check: old client',
    })
  })

  it('records a forced release with history and activity', async () => {
    const r = await run(ALICE, D1, 'Release directly', true, 'Customer deadline')
    expect(r).toMatchObject({ success: true, release_forced: true, released_file_version_id: V_D1 })
    const rel = await release(V_D1)
    expect(rel.released_at).not.toBeNull()
    expect(rel).toMatchObject({
      released_by: ALICE,
      release_forced: true,
      release_review_id: null,
      release_note: 'Customer deadline',
      release_revision: 'B',
    })
    await actAsOwner(db)
    const hist = await db.query<{ a: Record<string, unknown> | null }>(
      `SELECT approvals_data AS a FROM workflow_history WHERE file_id = $1 AND to_state_name = 'Released'`,
      [D1],
    )
    expect(hist.rows).toEqual([{ a: { forced_release: true } }])
    const act = await db.query<{ user_id: string; action: string; d: Record<string, unknown> }>(
      `SELECT user_id, action::text AS action, details AS d FROM activity WHERE file_id = $1 AND details ? 'forced_release'`,
      [D1],
    )
    expect(act.rows).toHaveLength(1)
    expect(act.rows[0]).toMatchObject({ user_id: ALICE, action: 'state_change' })
    expect(act.rows[0].d).toMatchObject({ forced_release: true, version: 1, revision: 'B', file_version_id: V_D1, reason: 'Customer deadline' })
  })

  it('releases a drawing with an approved review of the version, without force, naming the review', async () => {
    const r = await run(ALICE, D2, 'Release directly')
    expect(r).toMatchObject({ success: true, release_forced: false })
    expect(await release(V_D2)).toMatchObject({ release_forced: false, release_review_id: RV2 })
  })

  it("records the review when a review stage's approval moves the drawing", async () => {
    // As review_settle() runs it: definer code with the deciding user's JWT.
    await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${ADMIN}', false);`)
    const r = await db.query<{ r: { moved: number } }>('SELECT review_advance_items($1, true) AS r', [RV3])
    expect(r.rows[0].r.moved).toBe(1)
    expect(await release(V_D3)).toMatchObject({ release_forced: false, release_review_id: RV3, released_by: ADMIN })
    await actAsOwner(db)
    const f = await db.query<{ s: string }>('SELECT workflow_state_id AS s FROM file WHERE id = $1', [D3])
    expect(f.rows[0].s).toBe(state.Released)
  })

  it('does not gate parts, and the 3-argument entry point still runs transitions', async () => {
    const r = await run(ALICE, P1, 'Release directly')
    expect(r).toMatchObject({ success: true, release_forced: false })
    const first = await release(V_P1)
    expect(first).toMatchObject({ release_forced: false, release_review_id: null })
    expect(await run(ALICE, P1, 'Obsolete')).toMatchObject({ success: true })
    // Leaving the releasing state keeps the version released.
    expect((await release(V_P1)).released_at).toBe(first.released_at)
  })

  it('keeps the first release record when the same version enters a releasing state again', async () => {
    const first = await release(V_P1)
    await seed(db, `UPDATE file SET checked_out_by = '${ALICE}' WHERE id = '${P1}';`)
    expect(await run(ALICE, P1, 'Reinstate')).toMatchObject({ success: true })
    await seed(db, `UPDATE file SET checked_out_by = NULL WHERE id = '${P1}';`)
    expect(await run(ALICE, P1, 'Release directly', false, 'again')).toMatchObject({ success: true })
    expect(await release(V_P1)).toEqual(first)
  })
})

describe('release columns', () => {
  it('cannot be set or changed by a client', async () => {
    await actAs(db, ALICE)
    expect(await error(`UPDATE file_version SET release_note = 'x' WHERE id = $1`, [V_D1])).toMatch(/workflow transition only/)
    expect(await error('UPDATE file_version SET released_at = NOW() WHERE id = $1', [V_D4])).toMatch(/workflow transition only/)
    expect(await error('UPDATE file_version SET release_forced = false WHERE id = $1', [V_D1])).toMatch(/workflow transition only/)
    expect(
      await error(
        `INSERT INTO file_version (file_id, version, revision, content_hash, created_by, released_at)
         VALUES ($1, 2, 'A', $2, $3, NOW())`,
        [D4, H(1), ALICE],
      ),
    ).toMatch(/workflow transition only/)
    // Other columns of a released version stay editable.
    expect(await error(`UPDATE file_version SET comment = 'note' WHERE id = $1`, [V_D1])).toBeNull()
    expect((await release(V_D4)).released_at).toBeNull()
  })

  it('keeps a released version while its file is live', async () => {
    await actAs(db, ALICE)
    expect(await error('DELETE FROM file_version WHERE id = $1', [V_D1])).toMatch(/released/)
    await actAsOwner(db)
    const n = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM file_version WHERE id = $1', [V_D1])
    expect(n.rows[0].n).toBe(1)
  })
})

describe('freezing a released version', () => {
  it("refuses to replace or delete the released version's drawing PDF and exports", async () => {
    await actAs(db, ADMIN)
    expect(await error('SELECT drawing_pdf_render_record($1, $2, 10)', [V_D1, H(9)])).toMatch(/released/)
    expect(await error('SELECT drawing_pdf_render_delete($1)', [PDF_D1])).toMatch(/released/)
    expect(await error(`SELECT file_version_output_record($1, 'dxf', NULL, $2, 10, 'one.dxf')`, [V_D1, H(9)])).toMatch(
      /released/,
    )
    expect(await error('SELECT file_version_output_delete($1)', [OUT_D1])).toMatch(/released/)
    await actAsOwner(db)
    const pdf = await db.query<{ h: string }>('SELECT storage_hash AS h FROM drawing_pdf_render WHERE id = $1', [PDF_D1])
    expect(pdf.rows[0].h).toBe(H(3))
  })

  it('still adds a missing export of the released version', async () => {
    await actAs(db, ALICE)
    expect(await error(`SELECT file_version_output_record($1, 'step', NULL, $2, 10, 'one.step')`, [V_D1, H_STEP])).toBeNull()
  })

  it("refuses to delete or rewrite the released version's report, and keeps its other columns editable", async () => {
    await actAs(db, ALICE)
    expect(await error('DELETE FROM inspection_report WHERE id = $1', [REP_D1])).toMatch(/released/)
    expect(await error('UPDATE inspection_report SET storage_hash = $1 WHERE id = $2', [H_NEW, REP_D1])).toMatch(/released/)
    expect(
      await error('SELECT inspection_report_overwrite($1, $2, 20, 3, NULL, NULL, NULL, NULL)', [REP_D1, H_NEW]),
    ).toMatch(/released/)
    expect(await error(`UPDATE inspection_report SET notes = 'checked' WHERE id = $1`, [REP_D1])).toBeNull()
    await actAsOwner(db)
    const r = await db.query<{ h: string }>('SELECT storage_hash AS h FROM inspection_report WHERE id = $1', [REP_D1])
    expect(r.rows[0].h).toBe(H_REPORT)
  })
})

describe('inspection_report_overwrite()', () => {
  it('overwrites a report of an unreleased version in place', async () => {
    await actAs(db, ALICE)
    expect(
      await error(`SELECT inspection_report_overwrite($1, $2, 20, 3, NULL, NULL, 'Template', NULL)`, [REP_D4A, H_NEW]),
    ).toBeNull()
    await actAsOwner(db)
    const r = await db.query<Record<string, unknown>>(
      `SELECT storage_hash, file_size::int AS file_size, characteristic_count, template_name, report_number, file_version_id
         FROM inspection_report WHERE id = $1`,
      [REP_D4A],
    )
    expect(r.rows[0]).toEqual({
      storage_hash: H_NEW,
      file_size: 20,
      characteristic_count: 3,
      template_name: 'Template',
      report_number: 'R-2',
      file_version_id: V_D4,
    })
  })

  it('refuses a returned report, a missing one, a caller without the vault and content not theirs', async () => {
    await actAs(db, ALICE)
    expect(
      await error('SELECT inspection_report_overwrite($1, $2, 20, 3, NULL, NULL, NULL, NULL)', [REP_D4B, H_NEW]),
    ).toMatch(/came back/)
    expect(
      await error('SELECT inspection_report_overwrite($1, $2, 20, 3, NULL, NULL, NULL, NULL)', [
        '70000000-0000-0000-0000-0000000000ff',
        H_NEW,
      ]),
    ).toMatch(/not found/)
    expect(
      await error('SELECT inspection_report_overwrite($1, $2, 20, 3, NULL, NULL, NULL, NULL)', [REP_D4A, H(7)]),
    ).toMatch(/not uploaded by you/)
    await actAs(db, CAROL)
    expect(
      await error('SELECT inspection_report_overwrite($1, $2, 20, 3, NULL, NULL, NULL, NULL)', [REP_D4A, H_REPORT]),
    ).not.toBeNull()
  })
})

describe('file_set_auto_output()', () => {
  async function off(): Promise<string[]> {
    await actAsOwner(db)
    const r = await db.query<{ k: string[] }>('SELECT auto_outputs_off AS k FROM file WHERE id = $1', [D4])
    return r.rows[0].k
  }

  it('adds and removes kinds idempotently', async () => {
    expect(await off()).toEqual([])
    await actAs(db, ALICE)
    expect(await error(`SELECT file_set_auto_output($1, 'step', false)`, [D4])).toBeNull()
    expect(await error(`SELECT file_set_auto_output($1, 'step', false)`, [D4])).toBeNull()
    expect(await error(`SELECT file_set_auto_output($1, 'PDF', false)`, [D4])).toBeNull()
    expect(await off()).toEqual(['pdf', 'step'])
    await actAs(db, ALICE)
    expect(await error(`SELECT file_set_auto_output($1, 'step', true)`, [D4])).toBeNull()
    expect(await off()).toEqual(['pdf'])
  })

  it('refuses an unknown kind and a caller without the vault', async () => {
    await actAs(db, ALICE)
    expect(await error(`SELECT file_set_auto_output($1, 'zip', false)`, [D4])).toMatch(/Unknown output kind/)
    await actAs(db, CAROL)
    expect(await error(`SELECT file_set_auto_output($1, 'dxf', false)`, [D4])).not.toBeNull()
    expect(await off()).toEqual(['pdf'])
  })
})

describe('workflow_import_graph()', () => {
  it('imports releases_version, and an imported releasing state releases on entry', async () => {
    const IMPORT_WF = '90000000-0000-0000-0000-000000000002'
    const P2 = '50000000-0000-0000-0000-000000000006'
    const V_P2 = '51000000-0000-0000-0000-000000000006'
    await seed(
      db,
      `
      INSERT INTO workflow_template (id, org_id, name) VALUES ('${IMPORT_WF}', '${ORG_A}', 'Imported');
      INSERT INTO file (id, org_id, vault_id, file_path, file_name, extension, content_hash, version, revision, created_by) VALUES
        ('${P2}', '${ORG_A}', '${VA1}', 'a1/two.sldprt', 'two.sldprt', '.sldprt', '${H(1)}', 1, 'A', '${ADMIN}');
      INSERT INTO file_version (id, file_id, version, revision, content_hash, created_by, created_at) VALUES
        ('${V_P2}', '${P2}', 1, 'A', '${H(1)}', '${ADMIN}', '2020-01-01');
      `,
    )
    const payload = {
      states: [
        { key: 'draft', name: 'Draft', is_editable: true, is_checkout_required: false },
        { key: 'issued', name: 'Issued', is_editable: false, is_checkout_required: false, releases_version: true },
      ],
      transitions: [{ from: 'draft', to: 'issued', name: 'Issue' }],
    }
    await actAs(db, ADMIN)
    expect(await error('SELECT workflow_import_graph($1, $2::jsonb)', [IMPORT_WF, JSON.stringify(payload)])).toBeNull()
    await actAsOwner(db)
    const states = await db.query<{ id: string; name: string; releases_version: boolean }>(
      'SELECT id, name, releases_version FROM workflow_state WHERE workflow_id = $1 ORDER BY sort_order',
      [IMPORT_WF],
    )
    expect(states.rows.map((s) => [s.name, s.releases_version])).toEqual([
      ['Draft', false],
      ['Issued', true],
    ])
    const t = await db.query<{ id: string }>('SELECT id FROM workflow_transition WHERE workflow_id = $1', [IMPORT_WF])
    await seed(
      db,
      `INSERT INTO file_workflow_assignment (file_id, workflow_id, current_state_id)
         VALUES ('${P2}', '${IMPORT_WF}', '${states.rows[0].id}');`,
    )
    await actAs(db, ALICE)
    const r = await db.query<{ r: TransitionResult }>(
      'SELECT workflow_transition_execute($1::uuid, $2::uuid, NULL::text) AS r',
      [P2, t.rows[0].id],
    )
    expect(r.rows[0].r).toMatchObject({ success: true, released_file_version_id: V_P2 })
    expect((await release(V_P2)).released_at).not.toBeNull()
  })
})

describe('a gated release', () => {
  it('releases the version pinned when it was asked for, by its requester, with their comment', async () => {
    const GATED_WF = '90000000-0000-0000-0000-000000000003'
    const S_DRAFT = '91000000-0000-0000-0000-000000000010'
    const S_ISSUED = '91000000-0000-0000-0000-000000000011'
    const T_ISSUE = '92000000-0000-0000-0000-000000000010'
    const GATE = '93000000-0000-0000-0000-000000000010'
    const D6 = '50000000-0000-0000-0000-000000000008'
    const V_D6_1 = '51000000-0000-0000-0000-000000000008'
    const V_D6_2 = '51000000-0000-0000-0000-000000000009'
    await seed(
      db,
      `
      INSERT INTO workflow_template (id, org_id, name) VALUES ('${GATED_WF}', '${ORG_A}', 'Gated');
      INSERT INTO workflow_state (id, workflow_id, name, is_editable, is_checkout_required, releases_version) VALUES
        ('${S_DRAFT}', '${GATED_WF}', 'Draft', true, false, false),
        ('${S_ISSUED}', '${GATED_WF}', 'Issued', false, false, true);
      INSERT INTO workflow_transition (id, workflow_id, from_state_id, to_state_id, name)
        VALUES ('${T_ISSUE}', '${GATED_WF}', '${S_DRAFT}', '${S_ISSUED}', 'Issue');
      INSERT INTO workflow_gate (id, transition_id, name, required_approvals, is_blocking)
        VALUES ('${GATE}', '${T_ISSUE}', 'Sign-off', 1, true);
      INSERT INTO file (id, org_id, vault_id, file_path, file_name, extension, content_hash, version, revision, created_by, workflow_state_id)
        VALUES ('${D6}', '${ORG_A}', '${VA1}', 'a1/six.slddrw', 'six.slddrw', '.slddrw', '${H(1)}', 1, 'A', '${ADMIN}', '${S_DRAFT}');
      INSERT INTO file_version (id, file_id, version, revision, content_hash, created_by, created_at)
        VALUES ('${V_D6_1}', '${D6}', 1, 'A', '${H(1)}', '${ADMIN}', '2020-01-01');
      INSERT INTO file_workflow_assignment (file_id, workflow_id, current_state_id) VALUES ('${D6}', '${GATED_WF}', '${S_DRAFT}');
      `,
    )
    transition.Issue = T_ISSUE
    const asked = await run(ALICE, D6, 'Issue', true, 'Gate reason')
    expect(asked).toMatchObject({ success: true, requires_review: true })
    await actAsOwner(db)
    const pinned = await db.query<{ id: string; v: string; mode: string; c: string }>(
      `SELECT id, release_file_version_id AS v, release_mode AS mode, release_comment AS c
         FROM workflow_gate_review WHERE file_id = $1`,
      [D6],
    )
    expect(pinned.rows).toHaveLength(1)
    expect(pinned.rows[0]).toMatchObject({ v: V_D6_1, mode: 'force', c: 'Gate reason' })

    // A newer version is checked in while the gate waits.
    await seed(
      db,
      `INSERT INTO file_version (id, file_id, version, revision, content_hash, created_by, created_at)
         VALUES ('${V_D6_2}', '${D6}', 2, 'A', '${H(2)}', '${ADMIN}', '2020-01-02');
       UPDATE file SET version = 2 WHERE id = '${D6}';`,
    )
    await actAs(db, ADMIN)
    const done = await db.query<{ r: { success: boolean } }>(
      `SELECT gate_review_complete($1, 'approved'::review_status, 'ok') AS r`,
      [pinned.rows[0].id],
    )
    expect(done.rows[0].r).toMatchObject({ success: true })
    expect(await release(V_D6_1)).toMatchObject({ released_by: ALICE, release_forced: true, release_note: 'Gate reason' })
    expect((await release(V_D6_2)).released_at).toBeNull()
  })
})

describe('deleting an organization', () => {
  it('goes through with released versions, their exports and reports', async () => {
    const ORG_B = '00000000-0000-0000-0000-00000000000b'
    const VB = '40000000-0000-0000-0000-00000000000b'
    const FB = '50000000-0000-0000-0000-00000000000b'
    const VFB = '51000000-0000-0000-0000-00000000000b'
    await seed(
      db,
      `
      INSERT INTO organization (id, name, slug) VALUES ('${ORG_B}', 'B', 'org-b');
      INSERT INTO vault (id, org_id, name, slug) VALUES ('${VB}', '${ORG_B}', 'B1', 'b1');
      INSERT INTO file (id, org_id, vault_id, file_path, file_name, extension, content_hash, version, revision, created_by)
        VALUES ('${FB}', '${ORG_B}', '${VB}', 'b1/b.slddrw', 'b.slddrw', '.slddrw', '${H(1)}', 1, 'A', '${ADMIN}');
      INSERT INTO file_version (id, file_id, version, revision, content_hash, created_by, created_at, released_at)
        VALUES ('${VFB}', '${FB}', 1, 'A', '${H(1)}', '${ADMIN}', '2020-01-01', NOW());
      INSERT INTO drawing_pdf_render (org_id, file_id, file_version_id, storage_hash, file_size)
        VALUES ('${ORG_B}', '${FB}', '${VFB}', '${H(3)}', 10);
      INSERT INTO file_version_output (org_id, file_id, file_version_id, kind, storage_hash, file_size, file_name)
        VALUES ('${ORG_B}', '${FB}', '${VFB}', 'step', '${H(4)}', 10, 'b.step');
      INSERT INTO inspection_report (org_id, file_id, file_version_id, report_number, storage_hash, file_size)
        VALUES ('${ORG_B}', '${FB}', '${VFB}', 'R-B', '${H_REPORT}', 10);
      `,
    )
    await actAsOwner(db)
    // 0502's realtime_tombstone rows name the organization being deleted, which refuses an
    // organization delete on its own (not 509's concern); the foreign key is set aside inside a
    // transaction that is rolled back, so only the freeze triggers are under test.
    await db.exec('BEGIN; ALTER TABLE realtime_tombstone DROP CONSTRAINT realtime_tombstone_org_id_fkey;')
    try {
      expect(await error('DELETE FROM organization WHERE id = $1', [ORG_B])).toBeNull()
      const n = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM file_version WHERE id = $1', [VFB])
      expect(n.rows[0].n).toBe(0)
    } finally {
      await db.exec('ROLLBACK')
    }
    // Deleting the file alone goes through as well.
    expect(await error('DELETE FROM file WHERE id = $1', [FB])).toBeNull()
    const left = await db.query<{ n: number }>(
      'SELECT (SELECT count(*) FROM file_version WHERE id = $1) + (SELECT count(*) FROM inspection_report WHERE file_id = $2)::int AS n',
      [VFB, FB],
    )
    expect(Number(left.rows[0].n)).toBe(0)
  })
})
