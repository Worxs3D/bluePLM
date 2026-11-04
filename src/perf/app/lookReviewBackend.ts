/**
 * The review backend of the ui-look boot: `LookReviewModel` (the review RPCs of
 * 20-change-control.sql) registered on the perf backend's fake Supabase with `defineRpc`, plus the
 * reads around it (drawing PDFs, dependency closure, gate reviews, the reviewer picker's team
 * query) and an actor switch, so one run can act as the author, then a reviewer, then the author.
 *
 * Installed by boot.ts in a ui-look boot only; scenes live in lookScenes/review.ts.
 */
import { FakeRpcRefusal, type FakeSupabase, type Row } from '@/test/fakeSupabase'

import type { PerfBackend } from './backend'
import {
  LOOK_REVIEW_FILE_IDS,
  LOOK_REVIEW_FILES,
  LOOK_REVIEW_PEOPLE,
  LOOK_WORKFLOW,
  lookReviewContentHash,
  lookReviewVersionId,
  seedLookReviews,
  storeLookReviewPdf,
} from './lookReviewFixtures'
import { LookReviewModel, ReviewRefusal, type ReviewWorld, type WorldUser } from './lookReviewModel'

export type LookPersonKey = 'author' | keyof typeof LOOK_REVIEW_PEOPLE

export interface LookReviews {
  model: LookReviewModel
  /** User id of a person key (`author` is the perf user). */
  personId(key: LookPersonKey): string
  /** Make the fake act as this user (RPC actor and auth session). The store side is the scene's. */
  setActor(userId: string): void
  /** Run `fn` as another user, then switch back. */
  as<T>(key: LookPersonKey, fn: () => T): T
  /** Call a review RPC the way the app does; refusals come back as `{ error }`. */
  rpc(name: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: { message: string; hint?: string } | null }>
  /** Notifications written for a user that the app has not been shown yet (delivered on actAs). */
  takeUndelivered(userId: string): Row[]
  /** Check in a new version of a review file (new row, new PDF for drawings). Returns its id. */
  checkInNewVersion(fileName: string, options?: { pdf?: boolean }): Promise<string>
  /** Store and record the PDF of a drawing version that has none (what `generate-review-pdfs` does). */
  renderPdf(fileName: string, version?: number): Promise<void>
  /** Add a markup to a review item in its current round, as `user`. */
  addComment(input: { reviewId: string; itemId: string; fileName: string; user: LookPersonKey; text: string; page?: number; at?: [number, number]; resolved?: boolean; parentId?: string }): string
  /** Make every call of these RPCs fail (`[]` clears), for the error scenes. */
  fail(names: string[]): void
  /** Called when a review moves a file to another workflow state. */
  onFileState: ((fileId: string, stateName: string) => void) | null
  /** Lose or regain vault access, then withdraw reviewers who can no longer decide (schema 108). */
  setVaultAccess(key: LookPersonKey, hasAccess: boolean): number
  /** Forget every review, comment and notification (the scenes rebuild their state from here). */
  reset(): void
}

/** The perf boot's own org / vault / user ids (backend.ts), passed in to keep this module pure. */
export interface LookReviewIds {
  orgId: string
  vaultId: string
  userId: string
}

const findRow = (db: FakeSupabase, table: string, id: string | null | undefined): Row | null =>
  id ? (db.rows(table as never).find((r) => r.id === id) ?? null) : null

function makeWorld(db: FakeSupabase, lostVaultAccess: Set<string>, delivered: { pending: Row[] }, hooks: { onState: (fileId: string, stateName: string) => void }): ReviewWorld {
  let last = 0
  const teamMembers = (teamId: string) => db.rows('team_member').filter((m) => m.team_id === teamId).map((m) => String(m.user_id))
  const user = (id: string | null): WorldUser | null => {
    const u = findRow(db, 'app_user', id)
    if (!u) return null
    const adminTeam = db.rows('team').find((t) => t.name === 'Administrators')
    return {
      id: String(u.id),
      email: String(u.email ?? ''),
      fullName: (u.full_name as string | null) ?? null,
      avatarUrl: (u.avatar_url as string | null) ?? null,
      orgId: (u.org_id as string | null) ?? null,
      admin: u.role === 'admin' || (!!adminTeam && teamMembers(String(adminTeam.id)).includes(String(u.id))),
    }
  }
  return {
    actorId: () => db.actorId,
    user,
    usersOfOrg: (orgId) => db.rows('app_user').filter((u) => u.org_id === orgId).map((u) => user(String(u.id))!),
    canAccessVault: (userId, vaultId) => !vaultId || !lostVaultAccess.has(userId),
    file: (id) => {
      const f = findRow(db, 'file', id)
      if (!f) return null
      return {
        id: String(f.id),
        orgId: String(f.org_id),
        vaultId: (f.vault_id as string | null) ?? null,
        fileName: String(f.file_name),
        filePath: String(f.file_path),
        extension: (f.extension as string | null) ?? null,
        partNumber: (f.part_number as string | null) ?? null,
        description: (f.description as string | null) ?? null,
        version: Number(f.version),
        revision: (f.revision as string | null) ?? null,
        deleted: f.deleted_at != null,
        checkedOutBy: (f.checked_out_by as string | null) ?? null,
      }
    },
    version: (id) => {
      const v = findRow(db, 'file_version', id)
      if (!v) return null
      return {
        id: String(v.id),
        fileId: String(v.file_id),
        version: Number(v.version),
        revision: (v.revision as string | null) ?? null,
        contentHash: String(v.content_hash ?? ''),
        fileSize: Number(v.file_size ?? 0),
        state: (v.state as string | null) ?? null,
        createdAt: (v.created_at as string | null) ?? null,
        createdBy: (v.created_by as string | null) ?? null,
        referencesRecorded: v.references_recorded_at != null,
      }
    },
    pdf: (fileVersionId) => {
      const d = db.rows('drawing_pdf_render').find((r) => r.file_version_id === fileVersionId)
      if (!d) return null
      return {
        fileVersionId: String(d.file_version_id),
        fileId: String(d.file_id),
        storageHash: String(d.storage_hash),
        fileSize: Number(d.file_size),
        closureExact: (d.is_closure_exact as boolean | null) ?? null,
        generatedBy: (d.generated_by as string | null) ?? null,
        generatedAt: String(d.generated_at),
      }
    },
    teamOrg: (teamId) => (findRow(db, 'team', teamId)?.org_id as string | undefined) ?? null,
    teamReviewerIds: (teamId) => {
      // team_reviewer_list_user_ids(): the team's reviewer rules when it has any, else every member.
      const rules = db.rows('team_reviewer').filter((r) => r.team_id === teamId)
      const members = teamMembers(teamId)
      if (rules.length === 0) return members
      const roles = db.rows('user_workflow_role')
      return members.filter((m) =>
        rules.some((r) =>
          (r.reviewer_type === 'user' && r.user_id === m) ||
          (r.reviewer_type === 'workflow_role' && roles.some((x) => x.user_id === m && x.workflow_role_id === r.workflow_role_id)),
        ),
      )
    },
    teamsOfUser: (userId) => db.rows('team_member').filter((m) => m.user_id === userId).map((m) => String(m.team_id)),
    orgSettings: (orgId) => (findRow(db, 'organization', orgId)?.settings as Record<string, unknown> | null) ?? {},
    notify: (n) => {
      db.now = Date.now()
      const row = db.seed('notification', {
        org_id: n.orgId,
        user_id: n.userId,
        type: n.type,
        category: 'review',
        title: n.title,
        message: n.message,
        priority: n.priority,
        entity_type: 'review',
        entity_id: n.reviewId,
        from_user_id: n.fromUserId,
        action_type: 'open_review',
        is_read: false,
      })
      delivered.pending.push(row as unknown as Row)
    },
    applyTransition: (fileId, t) => {
      const to = LOOK_WORKFLOW.states.find((s) => s.id === t.toStateId)
      const name = to?.name ?? ''
      const f = findRow(db, 'file', fileId)
      if (f) f.state = name
      // workflow_transition_apply (schema 509): a releasing state stamps the current version.
      const fv = f && to?.releasesVersion ? db.rows('file_version').find((v) => v.file_id === fileId && Number(v.version) === Number(f.version)) : null
      if (fv && !fv.released_at) {
        Object.assign(fv, { released_at: new Date().toISOString(), released_by: db.actorId ?? null, release_revision: String(fv.revision ?? f?.revision ?? '') || null, release_forced: false })
      }
      hooks.onState(fileId, name)
    },
    now: () => {
      last = Math.max(Date.now(), last + 1)
      return new Date(last).toISOString()
    },
    uuid: () => crypto.randomUUID(),
  }
}

/** The dependency closure the package pane summarises: the root and each referenced file's latest version. */
function closureRows(db: FakeSupabase, fileVersionId: string): Row[] {
  const root = findRow(db, 'file_version', fileVersionId)
  if (!root) throw new FakeRpcRefusal('File version not found', '42501')
  const fileRow = (id: unknown) => findRow(db, 'file', String(id))
  const row = (depth: number, parent: string | null, fv: Row, source: string, exact: boolean): Row => {
    const f = fileRow(fv.file_id)
    return {
      depth, parent_version_id: parent, file_id: fv.file_id, file_version_id: fv.id, reference_path: f?.file_path ?? null,
      configuration: 'Default', reference_type: depth === 0 ? null : 'component', quantity: 1, is_exact: exact,
      edge_source: source, missing: false, version: fv.version, revision: fv.revision, content_hash: fv.content_hash,
      file_size: fv.file_size, file_name: f?.file_name ?? null, file_path: f?.file_path ?? null,
      extension: f?.extension ?? null, vault_id: f?.vault_id ?? null, deleted: f?.deleted_at != null,
    }
  }
  const out: Row[] = [row(0, null, root, 'root', true)]
  const walk = (parent: Row, depth: number) => {
    const spec = LOOK_REVIEW_FILES.find((f) => LOOK_REVIEW_FILE_IDS[f.name] === parent.file_id)
    for (const child of spec?.references ?? []) {
      const childFile = fileRow(LOOK_REVIEW_FILE_IDS[child])
      const fv = childFile && db.rows('file_version').find((v) => v.file_id === childFile.id && v.version === childFile.version)
      if (!fv) continue
      out.push(row(depth, String(parent.id), fv, spec?.approximate ? 'fallback' : 'recorded', !spec?.approximate))
      walk(fv, depth + 1)
    }
  }
  walk(root, 1)
  return out
}

export async function installLookReviews(backend: PerfBackend, ids: LookReviewIds): Promise<LookReviews> {
  const { db } = backend
  await seedLookReviews(db, ids)
  const lostVaultAccess = new Set<string>()
  const delivery = { pending: [] as Row[] }
  const stateHooks = { onState: (_fileId: string, _name: string) => {} }
  const world = makeWorld(db, lostVaultAccess, delivery, stateHooks)
  const model = new LookReviewModel(world)
  model.states = LOOK_WORKFLOW.states.map((s) => ({ ...s }))
  model.transitions = LOOK_WORKFLOW.transitions.map((t) => ({ ...t }))
  const inReview = LOOK_WORKFLOW.states[1].id
  const personId = (key: LookPersonKey) => (key === 'author' ? ids.userId : LOOK_REVIEW_PEOPLE[key].id)

  // Organization settings the review stage reads (absent = defaults: workflows on, hold, together).
  const org = findRow(db, 'organization', ids.orgId)
  const baseSettings = { ...((org?.settings as Record<string, unknown> | null) ?? {}) }

  // Every review RPC: a model refusal reaches the app as the RPC's { error } with its hint.
  const failing = new Set<string>()
  const register = (name: string, run: (args: Record<string, unknown>) => unknown, options?: { untyped?: boolean }) =>
    db.defineRpc(name, (args) => {
      if (failing.has(name)) throw new FakeRpcRefusal(`${name}: the server is unavailable (look scene)`, '08006')
      try {
        return run(args)
      } catch (error) {
        if (error instanceof ReviewRefusal) throw new FakeRpcRefusal(error.message, error.sqlState, error.hint, error.details)
        throw error
      }
    }, options)
  register('review_request', (a) => model.request(a))
  register('review_item_respond', (a) => model.respond(a))
  register('review_approve_all_remaining', (a) => model.approveAllRemaining(a))
  register('review_resubmit', (a) => model.resubmit(a))
  register('review_cancel', (a) => model.cancel(a))
  register('review_list_open_for_files', (a) => model.listOpenForFiles(a))
  register('review_item_add', (a) => model.itemAdd(a))
  register('review_item_remove', (a) => model.itemRemove(a))
  register('review_get_workflow_status', (a) => model.workflowStatus(a))
  register('review_advance_files', (a) => model.advanceFiles(a))
  register('review_update_meta', (a) => model.updateMeta(a))
  register('review_list_queue', (a) => model.listQueue(a))
  register('review_get_detail', (a) => model.detail(a))
  register('review_count_badge', () => model.countBadge())
  register('gate_review_complete', (a) => model.completeGate(a))
  register('file_version_get_dependency_closure', (a) => closureRows(db, String(a.p_file_version_id)))
  register('drawing_pdf_render_get', (a) => {
    const d = db.rows('drawing_pdf_render').find((r) => r.file_version_id === a.p_file_version_id)
    return d
      ? [{ file_version_id: d.file_version_id, file_id: d.file_id, storage_hash: d.storage_hash, file_size: d.file_size, is_closure_exact: d.is_closure_exact, generated_by: d.generated_by, generated_at: d.generated_at }]
      : []
  })
  register('drawing_pdf_render_record', (a) => {
    const fv = findRow(db, 'file_version', String(a.p_file_version_id))
    if (!fv) throw new FakeRpcRefusal('File version not found', '42501')
    const existing = db.rows('drawing_pdf_render').find((r) => r.file_version_id === fv.id)
    if (existing && existing.storage_hash === a.p_storage_hash) return { recorded: false, replaced: false, storage_hash: existing.storage_hash }
    if (existing && !world.user(db.actorId)?.admin) throw new FakeRpcRefusal('A PDF is already recorded for this version', '55000', 'PDF_EXISTS')
    if (existing) db.removeRows('drawing_pdf_render', [existing])
    db.seed('drawing_pdf_render', {
      file_id: String(fv.file_id), file_version_id: String(fv.id), org_id: ids.orgId, storage_hash: String(a.p_storage_hash),
      file_size: Number(a.p_file_size), is_closure_exact: (a.p_closure_exact as boolean | null) ?? null, generated_by: db.actorId,
      generated_at: new Date().toISOString(),
    })
    return { recorded: true, replaced: !!existing, storage_hash: a.p_storage_hash }
  })

  // Resolving a markup (schema 512): the comment's author, the review's requester, its reviewers or
  // an administrator. Registered untyped until the generated types know the function.
  register(
    'file_comment_set_resolved',
    (a) => {
      // As 0512_comment_resolve.sql: a comment the caller cannot read is COMMENT_NOT_FOUND; then the
      // author, an admin, the review's requester or a not-withdrawn reviewer, or (outside a review)
      // explorer edit, which every perf user has. Only the resolve columns change.
      const actor = world.user(db.actorId)
      const c = findRow(db, 'file_comment', String(a.p_comment_id ?? ''))
      const f = c ? world.file(String(c.file_id)) : null
      if (!actor || !c || !f || f.orgId !== actor.orgId || !world.canAccessVault(actor.id, f.vaultId)) {
        throw new FakeRpcRefusal('Comment not found', '42501', 'COMMENT_NOT_FOUND')
      }
      const reviewId = (c.review_id as string | null) ?? null
      if (c.user_id !== actor.id && !actor.admin && reviewId && !model.mayResolveIn(reviewId, actor.id)) {
        throw new FakeRpcRefusal('You cannot resolve this comment', '42501', 'FORBIDDEN')
      }
      const resolved = a.p_resolved === true
      const changed = (c.is_resolved === true) !== resolved
      if (changed) {
        c.is_resolved = resolved
        c.resolved_by = resolved ? actor.id : null
        c.resolved_at = resolved ? new Date().toISOString() : null
      }
      return { id: c.id, file_id: c.file_id, is_resolved: c.is_resolved === true, resolved_by: c.resolved_by ?? null, resolved_at: c.resolved_at ?? null, changed }
    },
    { untyped: !db.schema.functions.has('file_comment_set_resolved') },
  )

  // The reviewer picker's teams: a nested embedded select the typed fake does not shape.
  backend.queryOverrides.push({
    table: 'team',
    matches: (select) => select.includes('team_member('),
    rows: (eq) =>
      db.rows('team')
        .filter((t) => !eq.org_id || t.org_id === eq.org_id)
        .sort((x, y) => String(x.name).localeCompare(String(y.name)))
        .map((t) => ({
          id: t.id, name: t.name, color: t.color, icon: t.icon, description: t.description,
          team_member: db.rows('team_member')
            .filter((m) => m.team_id === t.id)
            .map((m) => {
              const u = findRow(db, 'app_user', String(m.user_id))
              return { user: u ? { id: u.id, email: u.email, full_name: u.full_name, avatar_url: u.avatar_url, role: u.role } : null }
            }),
        })),
  })

  const setActor = (userId: string) => {
    const u = world.user(userId)
    db.actorId = userId
    db.actorEmail = u?.email ?? ''
    backend.session.user.id = userId
    backend.session.user.email = u?.email ?? ''
    backend.session.user.user_metadata = { full_name: u?.fullName ?? '' }
  }

  const control: LookReviews = {
    model,
    personId,
    setActor,
    as(key, fn) {
      const previous = db.actorId
      setActor(personId(key))
      try {
        return fn()
      } finally {
        if (previous) setActor(previous)
      }
    },
    async rpc(name, args = {}) {
      // Forwarded by reference, as lenientClient does: rpcContract.test.ts reads every literal
      // `.rpc(` call in src as an app call, and this one names no function of its own.
      const call = db.client.rpc.bind(db.client) as unknown as (fn: string, a: Record<string, unknown>) => PromiseLike<unknown>
      const result = (await call(name, args)) as { data: unknown; error: { message: string; hint?: string } | null }
      return { data: result.data, error: result.error }
    },
    takeUndelivered(userId) {
      const mine = delivery.pending.filter((n) => n.user_id === userId)
      delivery.pending = delivery.pending.filter((n) => n.user_id !== userId)
      return mine
    },
    async checkInNewVersion(fileName, options) {
      const spec = LOOK_REVIEW_FILES.find((f) => f.name === fileName)
      const f = findRow(db, 'file', LOOK_REVIEW_FILE_IDS[fileName])
      if (!spec || !f) throw new Error(`look: no review file ${fileName}`)
      const n = Number(f.version) + 1
      const id = lookReviewVersionId(fileName, n)
      db.now = Date.now()
      db.seed('file_version', {
        id, file_id: String(f.id), version: n, revision: String(f.revision ?? 'A'),
        content_hash: lookReviewContentHash(fileName, n), file_size: Number(f.file_size ?? 200_000) + 1_337,
        created_by: db.actorId ?? ids.userId, state: String(f.state ?? 'In Review'), part_number: spec.partNumber,
        description: spec.description, comment: 'Review comments addressed', references_recorded_at: new Date().toISOString(),
      })
      f.version = n
      f.content_hash = lookReviewContentHash(fileName, n)
      const serverRow = backend.vault.serverRows.find((r) => r.id === f.id)
      if (serverRow) Object.assign(serverRow, { version: n, content_hash: f.content_hash })
      if (spec.fileType === 'drawing' && options?.pdf !== false) await storeLookReviewPdf(db, ids.orgId, db.actorId ?? ids.userId, spec, n)
      return id
    },
    async renderPdf(fileName, version) {
      const spec = LOOK_REVIEW_FILES.find((f) => f.name === fileName)
      const f = findRow(db, 'file', LOOK_REVIEW_FILE_IDS[fileName])
      if (!spec || !f) throw new Error(`look: no review file ${fileName}`)
      const n = version ?? Number(f.version)
      if (db.rows('drawing_pdf_render').some((r) => r.file_version_id === lookReviewVersionId(fileName, n))) return
      await storeLookReviewPdf(db, ids.orgId, db.actorId ?? ids.userId, spec, n)
    },
    addComment(input) {
      const fileId = LOOK_REVIEW_FILE_IDS[input.fileName]
      const userId = personId(input.user)
      const round = model.currentRound(input.reviewId)
      const refused = model.commentAllowed(input.reviewId, input.itemId, round, userId, fileId)
      if (refused) throw new Error(`look: ${refused}`)
      const fileVersion = findRow(db, 'file', fileId)?.version
      db.now = Date.now()
      const [x, y] = input.at ?? [0, 0]
      const row = db.seed('file_comment', {
        file_id: fileId, user_id: userId, comment: input.text, page_number: input.at ? (input.page ?? 1) : null,
        position: input.at ? { x, y, width: 0, height: 0, pageWidth: 1224, pageHeight: 792 } : null,
        annotation_type: input.at ? 'text' : 'file', parent_id: input.parentId ?? null, is_resolved: input.resolved ?? false,
        resolved_by: input.resolved ? personId('author') : null, resolved_at: input.resolved ? new Date().toISOString() : null,
        file_version: Number(fileVersion ?? 1), review_id: input.reviewId, review_round: round, review_item_id: input.itemId,
      })
      return String(row.id)
    },
    fail(names) {
      failing.clear()
      for (const n of names) failing.add(n)
    },
    onFileState: null,
    setVaultAccess(key, hasAccess) {
      if (hasAccess) lostVaultAccess.delete(personId(key))
      else lostVaultAccess.add(personId(key))
      return model.withdrawLostReviewers()
    },
    reset() {
      model.reset()
      lostVaultAccess.clear()
      delivery.pending = []
      db.removeRows('notification', [...db.rows('notification')])
      db.removeRows('file_comment', db.rows('file_comment').filter((c) => c.review_id != null))
      failing.clear()
      const orgRow = findRow(db, 'organization', ids.orgId)
      if (orgRow) orgRow.settings = { ...baseSettings }
      // Back to the fixture's versions and PDFs: drop what checkInNewVersion and renderPdf added.
      for (const spec of LOOK_REVIEW_FILES) {
        const id = LOOK_REVIEW_FILE_IDS[spec.name]
        model.assignments.set(id, inReview)
        const keep = new Set(spec.pdfVersions.map((n) => lookReviewVersionId(spec.name, n)))
        db.removeRows('drawing_pdf_render', db.rows('drawing_pdf_render').filter((r) => r.file_id === id && !keep.has(String(r.file_version_id))))
        db.removeRows('file_version', db.rows('file_version').filter((v) => v.file_id === id && Number(v.version) > spec.version))
        for (const v of db.rows('file_version')) {
          if (v.file_id === id) Object.assign(v, { released_at: null, released_by: null, release_revision: null, release_forced: false })
        }
        const f = findRow(db, 'file', id)
        if (!f) continue
        Object.assign(f, { state: 'In Review', version: spec.version, content_hash: lookReviewContentHash(spec.name, spec.version) })
        const serverRow = backend.vault.serverRows.find((r) => r.id === id)
        if (serverRow) Object.assign(serverRow, { version: spec.version, content_hash: f.content_hash })
      }
    },
  }
  stateHooks.onState = (fileId, name) => control.onFileState?.(fileId, name)

  // A gate review waiting on the author and Olive: releasing the flange drawing needs Quality's sign-off.
  model.gates = [{
    id: '00000000-0000-4000-8000-9a7e00000001',
    orgId: ids.orgId,
    fileId: LOOK_REVIEW_FILE_IDS['PMP-2004.SLDDRW'],
    gateId: '00000000-0000-4000-8000-9a7e0000a001',
    gateName: 'Quality sign-off',
    gateType: 'approval',
    transitionId: LOOK_WORKFLOW.transitions[1].id,
    requestedBy: LOOK_REVIEW_PEOPLE.sam.id,
    requestedAt: new Date(Date.now() - 26 * 3_600_000).toISOString(),
    reviewerIds: [ids.userId, LOOK_REVIEW_PEOPLE.olive.id],
    checklistItems: [
      { id: 'fai', label: 'First article inspection attached', required: true },
      { id: 'mat', label: 'Material certificate on file', required: false },
    ],
    decided: null,
  }]
  control.reset()
  return control
}
