/**
 * The drawing-review state machine of the ui-look boot: the review RPCs of
 * `supabase/modules/20-change-control.sql` (schema 107, stages 110, withdrawals 108) ported to
 * memory, with the same rules and the same JSON shapes, so the real review UI can be driven end to
 * end headlessly (`lookReviewBackend.ts` registers these on the fake Supabase).
 *
 * The rows the rest of the app also reads (users, teams, files, versions, PDFs) stay in the fake's
 * tables and are read through `ReviewWorld`; the review tables themselves live here, because no
 * client code reads them. Never part of a release build.
 */
import {
  DECISIONS,
  PARAMETER,
  PREREQUISITE,
  PRIORITY_RANK,
  PRIVILEGE,
  refuse,
  sortStamp,
  statusLabel,
  trimmed,
  uuidArray,
  type Decision,
  type DecisionRow,
  type GateReview,
  type ItemOutcome,
  type ItemRow,
  type Json,
  type JsonObject,
  type ResponseRow,
  type ReviewRow,
  type ReviewStatus,
  type ReviewWorld,
  type RoundItemRow,
  type RoundRow,
  type WorkflowState,
  type WorkflowTransition,
  type WorldFile,
  type WorldVersion,
} from './lookReviewTypes'

export { ReviewRefusal } from './lookReviewTypes'
export type { GateReview, ReviewWorld, WorkflowState, WorkflowTransition, WorldUser } from './lookReviewTypes'

export class LookReviewModel {
  private reviews: ReviewRow[] = []
  private items: ItemRow[] = []
  private rounds: RoundRow[] = []
  private roundItems: RoundItemRow[] = []
  private responses: ResponseRow[] = []
  private decisions: DecisionRow[] = []
  private seq = 0
  gates: GateReview[] = []
  states: WorkflowState[] = []
  transitions: WorkflowTransition[] = []
  /** `file_workflow_assignment.current_state_id` by file. */
  assignments = new Map<string, string>()

  constructor(private readonly world: ReviewWorld) {}

  /** Forget every review (the scenes start from a known state). */
  reset(): void {
    this.reviews = []
    this.items = []
    this.rounds = []
    this.roundItems = []
    this.responses = []
    this.decisions = []
    for (const g of this.gates) g.decided = null
  }

  // ---------------------------------------------------------------------------
  // Helpers (review_require_access, review_get_display_title, review_item_list_owed_ids, ...)
  // ---------------------------------------------------------------------------

  private actor(): { id: string; orgId: string; admin: boolean } {
    const id = this.world.actorId()
    const user = this.world.user(id)
    if (!id || !user?.orgId) return refuse('Not a member of an organization', PRIVILEGE, 'FORBIDDEN')
    return { id, orgId: user.orgId, admin: user.admin }
  }

  private requireAccess(reviewId: unknown): { actor: { id: string; orgId: string; admin: boolean }; r: ReviewRow } {
    if (typeof reviewId !== 'string') return refuse('Review is required', PARAMETER)
    const actor = this.actor()
    const r = this.reviews.find((x) => x.id === reviewId)
    if (!r || r.orgId !== actor.orgId) return refuse('Not authorized for this review', PRIVILEGE, 'REVIEW_NOT_FOUND')
    return { actor, r }
  }

  /** Read-only view of a review's status, for tests and scenes. */
  status(reviewId: string): ReviewStatus | null {
    return this.reviews.find((r) => r.id === reviewId)?.status ?? null
  }

  reviewIds(): string[] {
    return this.reviews.map((r) => r.id)
  }

  itemIds(reviewId: string): string[] {
    return this.itemsOf(reviewId).map((i) => i.id)
  }

  /** The item of a review that holds `fileId`, for scenes and tests. */
  itemIdForFile(reviewId: string, fileId: string): string | null {
    return this.items.find((i) => i.reviewId === reviewId && i.fileId === fileId)?.id ?? null
  }

  private itemsOf(reviewId: string): ItemRow[] {
    return this.items
      .filter((i) => i.reviewId === reviewId)
      .sort((a, b) => a.sortOrder - b.sortOrder || (this.world.file(a.fileId)?.fileName ?? '').localeCompare(this.world.file(b.fileId)?.fileName ?? ''))
  }

  displayTitle(r: ReviewRow): string {
    const own = trimmed(r.title)
    if (own) return own
    const first = this.itemsOf(r.id)[0]
    return (first && this.world.file(first.fileId)?.fileName) || 'Review'
  }

  private owedIds(r: ReviewRow, userId: string): string[] {
    if (r.status !== 'pending') return []
    const assigned = this.responses.some(
      (x) => x.reviewId === r.id && x.roundNumber === r.currentRound && x.reviewerId === userId && !x.withdrawnAt,
    )
    if (!assigned) return []
    return this.roundItems
      .filter((ri) => ri.reviewId === r.id && ri.roundNumber === r.currentRound && !ri.isCarriedForward && ri.outcome === 'pending')
      .filter((ri) => !this.decisions.some((d) => d.itemId === ri.itemId && d.roundNumber === r.currentRound && d.reviewerId === userId))
      .map((ri) => ri.itemId)
  }

  private notify(r: ReviewRow, recipients: string[], actor: string | null, type: string, title: string, message: string): void {
    for (const id of new Set(recipients)) {
      const user = this.world.user(id)
      if (!user || user.orgId !== r.orgId || id === actor) continue
      this.world.notify({ orgId: r.orgId, userId: id, type, title, message, reviewId: r.id, priority: r.priority, fromUserId: actor })
    }
  }

  private validVersion(id: string, orgId: string, actorId: string): { v: WorldVersion; f: WorldFile } | null {
    const v = this.world.version(id)
    const f = v ? this.world.file(v.fileId) : null
    if (!v || !f || f.orgId !== orgId || f.deleted || !this.world.canAccessVault(actorId, f.vaultId)) return null
    return { v, f }
  }

  private teamMembers(teamId: string): string[] {
    return this.world.teamReviewerIds(teamId)
  }

  // ---------------------------------------------------------------------------
  // review_settle
  // ---------------------------------------------------------------------------

  private settle(r: ReviewRow, actor: string | null, notify: boolean): ReviewStatus {
    if (r.status !== 'pending') return r.status
    const round = r.currentRound
    const now = this.world.now()
    const reviewers = this.responses
      .filter((x) => x.reviewId === r.id && x.roundNumber === round && !x.withdrawnAt)
      .map((x) => x.reviewerId)
    const roundDecisions = (itemId: string) =>
      this.decisions.filter((d) => d.itemId === itemId && d.roundNumber === round).sort((a, b) => a.decidedAt.localeCompare(b.decidedAt) || a.seq - b.seq)

    for (const ri of this.roundItems) {
      if (ri.reviewId !== r.id || ri.roundNumber !== round || ri.isCarriedForward || ri.outcome !== 'pending') continue
      const ds = roundDecisions(ri.itemId)
      let outcome: ItemOutcome | null = null
      if (r.mode === 'any') {
        const first = ds[0]
        if (first) outcome = first.decision === 'approved_with_comments' ? 'approved' : first.decision
      } else if (reviewers.length > 0 && reviewers.every((id) => ds.some((d) => d.reviewerId === id))) {
        outcome = ds.some((d) => d.decision === 'rejected')
          ? 'rejected'
          : ds.some((d) => d.decision === 'changes_requested')
            ? 'changes_requested'
            : 'approved'
      }
      if (outcome) {
        ri.outcome = outcome
        ri.decidedAt = now
        const item = this.items.find((i) => i.id === ri.itemId)
        if (item) item.outcome = outcome
      }
    }

    const open = this.roundItems.filter(
      (ri) => ri.reviewId === r.id && ri.roundNumber === round && !ri.isCarriedForward && ri.outcome === 'pending',
    )
    for (const x of this.responses) {
      if (x.reviewId !== r.id || x.roundNumber !== round || x.withdrawnAt) continue
      const mine = this.decisions.filter((d) => d.reviewId === r.id && d.roundNumber === round && d.reviewerId === x.reviewerId)
      const owes = open.some((ri) => !mine.some((d) => d.itemId === ri.itemId))
      x.status = owes
        ? 'pending'
        : mine.length === 0
          ? 'cancelled'
          : mine.some((d) => d.decision === 'rejected')
            ? 'rejected'
            : mine.some((d) => d.decision === 'changes_requested')
              ? 'kicked_back'
              : 'approved'
      x.respondedAt = mine.length ? mine.map((d) => d.decidedAt).sort().at(-1) ?? null : null
    }

    if (open.length > 0) {
      this.applyWorkflowAfterSettle(r, 'pending')
      return 'pending'
    }

    const items = this.items.filter((i) => i.reviewId === r.id)
    if (items.length === 0) return r.status
    const status: ReviewStatus = items.some((i) => i.outcome === 'rejected')
      ? 'rejected'
      : items.some((i) => i.outcome === 'changes_requested' || i.outcome === 'pending')
        ? 'kicked_back'
        : 'approved'
    r.status = status
    r.completedAt = status === 'approved' || status === 'rejected' ? now : null
    r.updatedAt = now
    const rd = this.rounds.find((x) => x.reviewId === r.id && x.roundNumber === round)
    if (rd) {
      rd.closedAt = now
      rd.outcome = status === 'kicked_back' ? 'changes_requested' : status
    }

    if (notify) {
      const title = this.displayTitle(r)
      const [type, prefix, message] =
        status === 'approved'
          ? ['review_approved', 'Review approved: ', 'Every item was approved.']
          : status === 'rejected'
            ? ['review_rejected', 'Review rejected: ', 'At least one item was rejected.']
            : ['review_kicked_back', 'Changes requested: ', 'Some items need changes. Resubmit them at a newer version.']
      this.notify(r, [r.requestedBy], actor, type, prefix + title, message)
      if (status === 'approved') {
        this.notify(r, reviewers, actor, 'review_completed', 'Review completed: ' + title, 'Every item was approved.')
      }
    }
    this.applyWorkflowAfterSettle(r, status)
    return status
  }

  // ---------------------------------------------------------------------------
  // Writes
  // ---------------------------------------------------------------------------

  request(a: Record<string, unknown>): JsonObject {
    const actor = this.actor()
    const rawMode = a.p_mode ?? 'all'
    if (rawMode !== 'all' && rawMode !== 'any') refuse('Mode must be all or any', PARAMETER, 'BAD_MODE')
    const priority = typeof a.p_priority === 'string' ? a.p_priority : 'normal'
    if (!(priority in PRIORITY_RANK)) refuse('Priority must be low, normal, high or urgent', PARAMETER, 'BAD_PRIORITY')
    const versionIds = uuidArray(a.p_file_version_ids)
    if (versionIds.length === 0) refuse('A review needs at least one file', PARAMETER, 'NO_ITEMS')
    if (versionIds.length > 500) refuse('A review can hold at most 500 files', PARAMETER, 'TOO_MANY_ITEMS')
    const pinned = versionIds.map((id) => this.validVersion(id, actor.orgId, actor.id) ?? refuse('File version not found', PRIVILEGE, 'VERSION_NOT_FOUND', id))
    const byFile = new Map<string, Set<string>>()
    for (const { v } of pinned) byFile.set(v.fileId, (byFile.get(v.fileId) ?? new Set()).add(v.id))
    if ([...byFile.values()].some((s) => s.size > 1)) refuse('A file can be in a review only once', PARAMETER, 'DUPLICATE_FILE')
    const reviewerIds = uuidArray(a.p_reviewer_ids)
    const teamIds = uuidArray(a.p_team_ids)
    for (const id of reviewerIds) {
      if (this.world.user(id)?.orgId !== actor.orgId) refuse('Reviewer not found in your organization', PRIVILEGE, 'REVIEWER_NOT_FOUND', id)
    }
    for (const id of teamIds) {
      if (this.world.teamOrg(id) !== actor.orgId) refuse('Team not found in your organization', PRIVILEGE, 'TEAM_NOT_FOUND', id)
    }
    const vaults = [...new Set(pinned.map(({ f }) => f.vaultId).filter((v): v is string => !!v))]
    const seesAll = (userId: string) => vaults.every((v) => this.world.canAccessVault(userId, v))
    for (const id of reviewerIds) {
      if (id !== actor.id && !seesAll(id)) refuse('A reviewer cannot see a vault this review uses', PRIVILEGE, 'REVIEWER_NO_VAULT_ACCESS', id)
    }

    const now = this.world.now()
    const r: ReviewRow = {
      id: this.world.uuid(),
      orgId: actor.orgId,
      vaultId: vaults.length === 1 ? vaults[0] : null,
      requestedBy: actor.id,
      requestedAt: now,
      title: trimmed(a.p_title),
      message: trimmed(a.p_message),
      status: 'pending',
      dueDate: trimmed(a.p_due_date),
      priority,
      teamId: teamIds[0] ?? null,
      mode: rawMode === 'any' ? 'any' : 'all',
      currentRound: 1,
      completedAt: null,
      cancelledBy: null,
      cancelledAt: null,
      cancelReason: null,
      createdAt: now,
      updatedAt: now,
    }
    // Candidates: named users first (they win over a team membership), then team members.
    const candidates = new Map<string, string | null>()
    for (const id of reviewerIds) if (!candidates.has(id)) candidates.set(id, null)
    for (const t of teamIds) for (const id of this.teamMembers(t)) if (!candidates.has(id)) candidates.set(id, t)
    const reviewers: Array<[string, string | null]> = []
    const skipped: JsonObject[] = []
    for (const [id, via] of [...candidates].sort((x, y) => x[0].localeCompare(y[0]))) {
      if (this.world.user(id)?.orgId !== actor.orgId) continue
      if (id === actor.id) skipped.push({ user_id: id, reason: 'requester' })
      else if (!seesAll(id)) skipped.push({ user_id: id, reason: 'no_vault_access' })
      else reviewers.push([id, via])
    }
    if (reviewers.length === 0) refuse('A review needs at least one reviewer other than yourself', PARAMETER, 'NO_REVIEWERS')

    this.reviews.push(r)
    versionIds.forEach((id, index) => {
      const v = this.world.version(id)!
      const f = this.world.file(v.fileId)!
      const item: ItemRow = {
        id: this.world.uuid(), reviewId: r.id, fileId: f.id, vaultId: f.vaultId, fileVersionId: v.id,
        sortOrder: index + 1, addedInRound: 1, outcome: 'pending', advancedAt: null, advancedToStateId: null,
      }
      this.items.push(item)
      this.roundItems.push({ reviewId: r.id, itemId: item.id, roundNumber: 1, fileVersionId: v.id, isCarriedForward: false, outcome: 'pending', decidedAt: null })
    })
    this.rounds.push({ reviewId: r.id, roundNumber: 1, openedBy: actor.id, openedAt: now, note: null, closedAt: null, outcome: null })
    for (const [id, via] of reviewers) this.addResponse(r, 1, id, via)

    this.notify(r, reviewers.map(([id]) => id), actor.id, 'review_request', 'Review requested: ' + this.displayTitle(r),
      r.message ?? `${versionIds.length} file(s) to review`)
    return { review_id: r.id, item_count: versionIds.length, reviewer_ids: reviewers.map(([id]) => id), skipped }
  }

  private addResponse(r: ReviewRow, round: number, reviewerId: string, via: string | null): void {
    this.responses.push({
      reviewId: r.id, roundNumber: round, reviewerId, viaTeamId: via, status: 'pending', respondedAt: null,
      withdrawnAt: null, withdrawnReason: null, createdAt: this.world.now(), seq: ++this.seq,
    })
  }

  respond(a: Record<string, unknown>): JsonObject {
    const { actor, r } = this.requireAccess(a.p_review_id)
    if (r.status !== 'pending') refuse('This review is not open for decisions', PREREQUISITE, 'REVIEW_CLOSED')
    const assigned = this.responses.some((x) => x.reviewId === r.id && x.roundNumber === r.currentRound && x.reviewerId === actor.id && !x.withdrawnAt)
    if (!assigned) refuse('You are not a reviewer in this round', PRIVILEGE, 'NOT_A_REVIEWER')
    const list = Array.isArray(a.p_decisions) ? (a.p_decisions as unknown[]) : []
    if (list.length === 0) refuse('Decisions must be a non-empty JSON array', PARAMETER, 'BAD_DECISIONS')
    const counts = { approved: 0, changes: 0, rejected: 0 }
    // All or nothing: validate every entry before writing one.
    const staged: DecisionRow[] = []
    for (const raw of list) {
      const e = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
      const itemId = trimmed(e.item_id)
      const decision = e.decision as Decision
      const comment = trimmed(e.comment)
      if (!DECISIONS.includes(decision)) refuse('Unknown decision', PARAMETER, 'BAD_DECISION', itemId ?? '')
      if (decision !== 'approved' && !comment) refuse('A comment is required for this decision', PARAMETER, 'COMMENT_REQUIRED', itemId ?? '')
      const owed = this.owedIds(r, actor.id).filter((id) => !staged.some((d) => d.itemId === id))
      if (!itemId || !owed.includes(itemId)) refuse('This item is not awaiting your decision', PREREQUISITE, 'ITEM_NOT_OWED', itemId ?? '')
      staged.push({
        id: this.world.uuid(), reviewId: r.id, itemId: itemId!, roundNumber: r.currentRound, reviewerId: actor.id,
        decision, comment, decidedAt: this.world.now(), legacy: false, seq: ++this.seq,
      })
      if (decision === 'approved' || decision === 'approved_with_comments') counts.approved++
      else if (decision === 'changes_requested') counts.changes++
      else counts.rejected++
    }
    this.decisions.push(...staged)
    const status = this.settle(r, actor.id, true)
    if (status === 'pending') {
      const parts = [
        counts.approved ? `${counts.approved} approved` : null,
        counts.changes ? `${counts.changes} changes requested` : null,
        counts.rejected ? `${counts.rejected} rejected` : null,
      ].filter(Boolean)
      this.notify(r, [r.requestedBy], actor.id, 'review_decision', 'Review decision: ' + this.displayTitle(r), parts.join(', '))
    }
    return { review_id: r.id, decided: staged.length, status: statusLabel(status), owed_remaining: this.owedIds(r, actor.id).length }
  }

  approveAllRemaining(a: Record<string, unknown>): JsonObject {
    const { actor, r } = this.requireAccess(a.p_review_id)
    const comment = trimmed(a.p_comment)
    const owed = this.owedIds(r, actor.id)
    if (owed.length === 0) refuse('Nothing in this review is awaiting your decision', PREREQUISITE, 'NOTHING_OWED')
    return this.respond({
      p_review_id: r.id,
      p_decisions: owed.map((id) => ({ item_id: id, decision: comment ? 'approved_with_comments' : 'approved', comment })),
    })
  }

  resubmit(a: Record<string, unknown>): JsonObject {
    const { actor, r } = this.requireAccess(a.p_review_id)
    if (r.requestedBy !== actor.id && !actor.admin) refuse('Only the requester or an administrator can resubmit a review', PRIVILEGE, 'FORBIDDEN')
    if (r.status !== 'kicked_back' && r.status !== 'rejected') {
      refuse('Only a review that came back with changes requested or rejected can be resubmitted', PREREQUISITE, 'NOT_RESUBMITTABLE')
    }
    const list = Array.isArray(a.p_items) ? (a.p_items as unknown[]) : []
    if (list.length === 0) refuse('Resubmitting needs at least one item at a newer version', PARAMETER, 'NOTHING_TO_RESUBMIT')
    const listed = new Map<string, string>()
    for (const raw of list) {
      const e = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
      const itemId = trimmed(e.item_id)
      const item = this.items.find((i) => i.id === itemId && i.reviewId === r.id)
      if (!item) return refuse('Item not found in this review', PARAMETER, 'ITEM_NOT_FOUND', itemId ?? '')
      if (listed.has(item.id)) refuse('An item is listed twice', PARAMETER, 'DUPLICATE_ITEM', item.id)
      const current = this.world.version(item.fileVersionId)?.version ?? 0
      const next = this.world.version(trimmed(e.file_version_id) ?? '')
      if (!next || next.fileId !== item.fileId || this.world.file(next.fileId)?.orgId !== actor.orgId) {
        refuse("That version does not belong to this item's file", PARAMETER, 'VERSION_NOT_FOUND', item.id)
      }
      if (next!.version <= current) {
        refuse(`An item can only be resubmitted at a newer version than the one reviewed (v${current})`, PARAMETER, 'SAME_VERSION', item.id)
      }
      listed.set(item.id, next!.id)
    }
    const items = this.items.filter((i) => i.reviewId === r.id)
    const missing = items.find((i) => i.outcome !== 'approved' && !listed.has(i.id))
    if (missing) {
      refuse('Every item that needs changes or was rejected must be resubmitted at a newer version', PARAMETER, 'ITEM_NEEDS_NEW_VERSION', missing.id)
    }
    const round = r.currentRound + 1
    const carry = this.responses.filter(
      (x) =>
        x.reviewId === r.id && x.roundNumber === r.currentRound && !x.withdrawnAt &&
        this.world.user(x.reviewerId)?.orgId === actor.orgId &&
        items.every((i) => this.world.canAccessVault(x.reviewerId, i.vaultId)),
    )
    if (carry.length === 0) refuse("None of this review's reviewers is still in the organization", PREREQUISITE, 'NO_REVIEWERS')

    const now = this.world.now()
    const note = trimmed(a.p_note)
    this.rounds.push({ reviewId: r.id, roundNumber: round, openedBy: actor.id, openedAt: now, note, closedAt: null, outcome: null })
    for (const i of items) {
      const nextVersion = listed.get(i.id)
      if (nextVersion) {
        i.fileVersionId = nextVersion
        i.outcome = 'pending'
      }
      this.roundItems.push({
        reviewId: r.id, itemId: i.id, roundNumber: round, fileVersionId: i.fileVersionId,
        isCarriedForward: !nextVersion, outcome: nextVersion ? 'pending' : 'approved', decidedAt: null,
      })
    }
    for (const x of carry) this.addResponse(r, round, x.reviewerId, x.viaTeamId)
    r.currentRound = round
    r.status = 'pending'
    r.completedAt = null
    r.updatedAt = now
    this.notify(r, carry.map((x) => x.reviewerId), actor.id, 'review_round',
      `Resubmitted for review (round ${round}): ${this.displayTitle(r)}`, note ?? `${listed.size} file(s) at a newer version`)
    return { review_id: r.id, round, items_to_review: listed.size, carried_forward: items.length - listed.size }
  }

  cancel(a: Record<string, unknown>): JsonObject {
    const { actor, r } = this.requireAccess(a.p_review_id)
    if (r.requestedBy !== actor.id && !actor.admin) refuse('Only the requester or an administrator can cancel a review', PRIVILEGE, 'FORBIDDEN')
    if (r.status !== 'pending' && r.status !== 'kicked_back') refuse('This review is already closed', PREREQUISITE, 'REVIEW_CLOSED')
    const reason = trimmed(a.p_reason)
    const owing = this.responses.filter((x) => x.reviewId === r.id && x.roundNumber === r.currentRound && x.status === 'pending').map((x) => x.reviewerId)
    for (const x of this.responses) if (x.reviewId === r.id && x.status === 'pending') x.status = 'cancelled'
    const now = this.world.now()
    const rd = this.rounds.find((x) => x.reviewId === r.id && x.roundNumber === r.currentRound)
    if (rd) {
      rd.closedAt = rd.closedAt ?? now
      rd.outcome = rd.outcome ?? 'cancelled'
    }
    Object.assign(r, { status: 'cancelled', cancelledBy: actor.id, cancelledAt: now, cancelReason: reason, completedAt: now, updatedAt: now })
    this.notify(r, r.requestedBy !== actor.id ? [...owing, r.requestedBy] : owing, actor.id, 'review_cancelled',
      'Review cancelled: ' + this.displayTitle(r), reason ?? 'This review no longer needs a decision.')
    return { review_id: r.id, status: 'cancelled' }
  }

  listOpenForFiles(a: Record<string, unknown>): Json {
    const actor = this.actor()
    const files = uuidArray(a.p_file_ids)
    return this.reviews
      .filter((r) => r.orgId === actor.orgId && (r.status === 'pending' || r.status === 'kicked_back'))
      .filter((r) => r.requestedBy === actor.id || (actor.admin && this.items.some((i) => i.reviewId === r.id && files.includes(i.fileId))))
      .sort((x, y) => y.requestedAt.localeCompare(x.requestedAt))
      .slice(0, 50)
      .map((r) => ({
        review_id: r.id,
        title: this.displayTitle(r),
        status: r.status,
        item_count: this.items.filter((i) => i.reviewId === r.id).length,
        requested_by_me: r.requestedBy === actor.id,
        can_add: r.status === 'pending',
        contained_file_ids: this.items.filter((i) => i.reviewId === r.id && files.includes(i.fileId)).map((i) => i.fileId),
      }))
  }

  itemAdd(a: Record<string, unknown>): JsonObject {
    const { actor, r } = this.requireAccess(a.p_review_id)
    if (r.requestedBy !== actor.id && !actor.admin) refuse('Only the requester or an administrator can add files to a review', PRIVILEGE, 'FORBIDDEN')
    if (r.status !== 'pending') refuse('Files can be added only while the review is waiting on its reviewers', PREREQUISITE, 'REVIEW_NOT_OPEN')
    const ids = uuidArray(a.p_file_version_ids)
    if (ids.length === 0) refuse('Nothing to add', PARAMETER, 'NO_ITEMS')
    const existing = this.items.filter((i) => i.reviewId === r.id)
    if (ids.length + existing.length > 500) refuse('A review can hold at most 500 files', PARAMETER, 'TOO_MANY_ITEMS')
    const pinned = ids.map((id) => this.validVersion(id, actor.orgId, actor.id) ?? refuse('File version not found', PRIVILEGE, 'VERSION_NOT_FOUND', id))
    const fileIds = pinned.map(({ f }) => f.id)
    if (new Set(fileIds).size !== fileIds.length || fileIds.some((id) => existing.some((i) => i.fileId === id))) {
      refuse('A file can be in a review only once', PARAMETER, 'DUPLICATE_FILE')
    }
    const reviewers = this.responses.filter((x) => x.reviewId === r.id && x.roundNumber === r.currentRound && !x.withdrawnAt).map((x) => x.reviewerId)
    const blind = reviewers.find((id) => pinned.some(({ f }) => !this.world.canAccessVault(id, f.vaultId)))
    if (blind) refuse('A reviewer cannot see a vault these files use', PRIVILEGE, 'REVIEWER_NO_VAULT_ACCESS', blind)
    const base = Math.max(0, ...existing.map((i) => i.sortOrder))
    pinned.forEach(({ v, f }, index) => {
      const item: ItemRow = {
        id: this.world.uuid(), reviewId: r.id, fileId: f.id, vaultId: f.vaultId, fileVersionId: v.id,
        sortOrder: base + index + 1, addedInRound: r.currentRound, outcome: 'pending', advancedAt: null, advancedToStateId: null,
      }
      this.items.push(item)
      this.roundItems.push({ reviewId: r.id, itemId: item.id, roundNumber: r.currentRound, fileVersionId: v.id, isCarriedForward: false, outcome: 'pending', decidedAt: null })
    })
    this.refreshVault(r)
    this.settle(r, actor.id, false)
    this.notify(r, reviewers, actor.id, 'review_request', 'Files added to review: ' + this.displayTitle(r),
      `${ids.length} file(s) were added to this review and need your decision.`)
    return { review_id: r.id, added: ids.length }
  }

  private refreshVault(r: ReviewRow): void {
    const vaults = new Set(this.items.filter((i) => i.reviewId === r.id).map((i) => i.vaultId))
    r.vaultId = vaults.size === 1 ? [...vaults][0] : null
    r.updatedAt = this.world.now()
  }

  itemRemove(a: Record<string, unknown>): JsonObject {
    const { actor, r } = this.requireAccess(a.p_review_id)
    const files = uuidArray(a.p_file_ids)
    if (r.requestedBy !== actor.id && !actor.admin) refuse('Only the requester or an administrator can remove files from a review', PRIVILEGE, 'FORBIDDEN')
    if (r.status !== 'pending' && r.status !== 'kicked_back') refuse('This review is already closed', PREREQUISITE, 'REVIEW_CLOSED')
    if (!this.items.some((i) => i.reviewId === r.id && !files.includes(i.fileId))) {
      refuse('A review needs at least one file. Cancel the review instead.', PARAMETER, 'LAST_ITEM')
    }
    const owing = this.responses
      .filter((x) => x.reviewId === r.id && x.roundNumber === r.currentRound && x.status === 'pending' && !x.withdrawnAt)
      .map((x) => x.reviewerId)
    const doomed = new Set(this.items.filter((i) => i.reviewId === r.id && files.includes(i.fileId)).map((i) => i.id))
    if (doomed.size === 0) return { review_id: r.id, removed: 0, status: r.status }
    this.items = this.items.filter((i) => !doomed.has(i.id))
    this.roundItems = this.roundItems.filter((x) => !doomed.has(x.itemId))
    this.decisions = this.decisions.filter((x) => !doomed.has(x.itemId))
    this.refreshVault(r)
    let status: ReviewStatus
    if (r.status === 'pending') status = this.settle(r, actor.id, true)
    else if (!this.items.some((i) => i.reviewId === r.id && i.outcome !== 'approved')) {
      r.status = 'approved'
      r.completedAt = this.world.now()
      const rd = this.rounds.find((x) => x.reviewId === r.id && x.roundNumber === r.currentRound)
      if (rd) rd.outcome = 'approved'
      status = 'approved'
      this.applyWorkflowAfterSettle(r, status)
    } else status = r.status
    if (status === 'pending') {
      this.notify(r, owing, actor.id, 'review_item_removed', 'Files removed from review: ' + this.displayTitle(r),
        `${doomed.size} file(s) were taken out of this review and no longer need a decision.`)
    }
    return { review_id: r.id, removed: doomed.size, status }
  }

  updateMeta(a: Record<string, unknown>): JsonObject {
    const { actor, r } = this.requireAccess(a.p_review_id)
    if (r.requestedBy !== actor.id && !actor.admin) refuse('Only the requester or an administrator can change a review', PRIVILEGE, 'FORBIDDEN')
    if (r.status !== 'pending' && r.status !== 'kicked_back') refuse('This review is already closed', PREREQUISITE, 'REVIEW_CLOSED')
    const priority = trimmed(a.p_priority)
    if (priority && !(priority in PRIORITY_RANK)) refuse('Priority must be low, normal, high or urgent', PARAMETER, 'BAD_PRIORITY')
    if (priority) r.priority = priority
    if (a.p_clear_due_date === true) r.dueDate = null
    else if (trimmed(a.p_due_date)) r.dueDate = trimmed(a.p_due_date)
    r.updatedAt = this.world.now()
    return { review_id: r.id, priority: r.priority, due_date: r.dueDate }
  }

  // ---------------------------------------------------------------------------
  // Withdrawals (schema 108): run after a user left the org or lost a vault
  // ---------------------------------------------------------------------------

  withdrawLostReviewers(): number {
    let n = 0
    for (const r of this.reviews) {
      if (r.status !== 'pending') continue
      for (const x of this.responses) {
        if (x.reviewId !== r.id || x.roundNumber !== r.currentRound || x.withdrawnAt || r.status !== 'pending') continue
        const owed = this.owedIds(r, x.reviewerId)
        if (owed.length === 0) continue
        const user = this.world.user(x.reviewerId)
        const leftOrg = user?.orgId !== r.orgId
        const blind = owed.some((id) => !this.world.canAccessVault(x.reviewerId, this.items.find((i) => i.id === id)?.vaultId ?? null))
        if (!leftOrg && !blind) continue
        x.withdrawnAt = this.world.now()
        x.withdrawnReason = leftOrg ? 'left_org' : 'lost_vault_access'
        x.status = 'cancelled'
        n++
        if (this.settle(r, null, true) === 'pending') {
          const left = this.responses.filter((y) => y.reviewId === r.id && y.roundNumber === r.currentRound && !y.withdrawnAt).length
          this.notify(r, [r.requestedBy], null, 'review_reviewer_removed', 'Reviewer removed: ' + this.displayTitle(r),
            `${user?.fullName ?? 'A reviewer'}${leftOrg ? ' left the organization' : " can no longer see this review's vault"}` +
              (left === 0 ? '. Nobody is left to decide: cancel the review and ask again.' : '. The review continues without them.'))
        }
      }
    }
    return n
  }

  // ---------------------------------------------------------------------------
  // Review stages (schema 110)
  // ---------------------------------------------------------------------------

  private workflowsEnabled(orgId: string): boolean {
    return this.world.orgSettings(orgId).file_workflows_enabled !== false
  }

  exitTransition(stateId: string | null): WorkflowTransition | null {
    const s = this.states.find((x) => x.id === stateId)
    if (!s) return null
    if (s.reviewApprovedStateId) return this.transitions.find((t) => t.fromStateId === s.id && t.toStateId === s.reviewApprovedStateId) ?? null
    const exits = this.transitions.filter((t) => t.fromStateId === s.id)
    return exits.length === 1 ? exits[0] : null
  }

  private advanceItems(r: ReviewRow, onlyApproved: boolean): JsonObject {
    let moved = 0
    const skipped: JsonObject[] = []
    for (const i of this.itemsOf(r.id)) {
      if (i.advancedAt || (onlyApproved && i.outcome !== 'approved')) continue
      const f = this.world.file(i.fileId)
      const reviewed = this.world.version(i.fileVersionId)?.version
      const stateId = this.assignments.get(i.fileId) ?? null
      const state = this.states.find((s) => s.id === stateId)
      let reason: string | null = null
      let t: WorkflowTransition | null = null
      if (i.outcome !== 'approved') reason = 'not_approved'
      else if (!f || f.deleted) reason = 'deleted'
      else if (!state?.isReviewStage) reason = 'not_in_review_stage'
      else if (f.version !== reviewed) reason = 'changed_since_review'
      else if (f.checkedOutBy) reason = 'checked_out'
      else {
        t = this.exitTransition(stateId)
        if (!t) reason = 'no_next_stage'
        else if (t.blockingGate) reason = 'gated'
        else if (this.states.find((s) => s.id === t!.toStateId)?.checkoutRequired) reason = 'checkout_required'
      }
      if (!reason && t) {
        this.assignments.set(i.fileId, t.toStateId)
        this.world.applyTransition(i.fileId, t)
        i.advancedAt = this.world.now()
        i.advancedToStateId = t.toStateId
        moved++
      } else {
        skipped.push({ item_id: i.id, file_id: i.fileId, file_name: f?.fileName ?? '', reason: reason ?? 'transition_failed' })
      }
    }
    return { moved, skipped }
  }

  private applyWorkflowAfterSettle(r: ReviewRow, status: ReviewStatus): void {
    if (!this.workflowsEnabled(r.orgId)) return
    const settings = this.world.orgSettings(r.orgId)
    if ((settings.review_stage_on_approval ?? 'hold') !== 'advance') return
    if ((settings.review_stage_package_policy ?? 'together') === 'approved_only') this.advanceItems(r, true)
    else if (status === 'approved') this.advanceItems(r, false)
  }

  advanceFiles(a: Record<string, unknown>): JsonObject {
    const { actor, r } = this.requireAccess(a.p_review_id)
    if (r.requestedBy !== actor.id && !actor.admin) refuse('Only the requester or an administrator can move reviewed files', PRIVILEGE, 'FORBIDDEN')
    if (!this.workflowsEnabled(r.orgId)) refuse('File workflows are turned off for this organization', PREREQUISITE, 'WORKFLOWS_DISABLED')
    if (r.status === 'cancelled') refuse('This review was cancelled', PREREQUISITE, 'REVIEW_CLOSED')
    const only = a.p_only_approved === true
    if (!only && r.status !== 'approved') refuse('The package moves as one only once every file is approved', PREREQUISITE, 'NOT_APPROVED')
    return this.advanceItems(r, only)
  }

  workflowStatus(a: Record<string, unknown>): JsonObject {
    const { r } = this.requireAccess(a.p_review_id)
    const settings = this.world.orgSettings(r.orgId)
    const stateName = (id: string | null | undefined) => this.states.find((s) => s.id === id) ?? null
    return {
      workflows_enabled: this.workflowsEnabled(r.orgId),
      on_approval: typeof settings.review_stage_on_approval === 'string' ? settings.review_stage_on_approval : 'hold',
      package_policy: typeof settings.review_stage_package_policy === 'string' ? settings.review_stage_package_policy : 'together',
      items: this.itemsOf(r.id).map((i) => {
        const ws = stateName(this.assignments.get(i.fileId))
        const next = ws?.isReviewStage ? stateName(this.exitTransition(ws.id)?.toStateId) : null
        return {
          item_id: i.id,
          file_id: i.fileId,
          outcome: i.outcome,
          state_name: ws?.name ?? null,
          state_color: ws?.color ?? null,
          in_review_stage: ws?.isReviewStage ?? false,
          next_state_name: next?.name ?? null,
          advanced_at: i.advancedAt,
          advanced_to_state_name: stateName(i.advancedToStateId)?.name ?? null,
        }
      }),
    }
  }

  // ---------------------------------------------------------------------------
  // Gate reviews (workflow_gate_review): listed in awaiting_me, decided by gate_review_complete
  // ---------------------------------------------------------------------------

  private gatesAwaiting(userId: string, orgId: string): GateReview[] {
    return this.gates.filter((g) => g.orgId === orgId && !g.decided && g.reviewerIds.includes(userId))
  }

  completeGate(a: Record<string, unknown>): JsonObject {
    const actor = this.actor()
    const gate = this.gatesAwaiting(actor.id, actor.orgId).find((g) => g.id === a.p_pending_review_id)
    if (!gate) return { success: false, error_code: 'NOT_FOUND', error_message: 'This gate review is not waiting on you' }
    const decision = String(a.p_decision)
    gate.decided = decision
    const t = this.transitions.find((x) => x.id === gate.transitionId)
    if (decision === 'approved' && t) {
      this.assignments.set(gate.fileId, t.toStateId)
      this.world.applyTransition(gate.fileId, t)
      const to = this.states.find((s) => s.id === t.toStateId)
      return { success: true, new_state_id: t.toStateId, new_state_name: to?.name ?? null }
    }
    return { success: true }
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  private userJson(id: string | null): Json {
    const u = this.world.user(id)
    return u ? { id: u.id, email: u.email, full_name: u.fullName, avatar_url: u.avatarUrl } : null
  }

  private overdue(r: ReviewRow): boolean {
    return (r.status === 'pending' || r.status === 'kicked_back') && !!r.dueDate && r.dueDate < new Date().toISOString().slice(0, 10)
  }

  listQueue(a: Record<string, unknown>): JsonObject {
    const actor = this.actor()
    const bucket = a.p_bucket ?? 'awaiting_me'
    if (typeof bucket !== 'string' || !['awaiting_me', 'requested_by_me', 'my_teams', 'done'].includes(bucket)) {
      refuse('Unknown queue bucket', PARAMETER, 'BAD_BUCKET')
    }
    const teamId = trimmed(a.p_team_id)
    if (teamId && this.world.teamOrg(teamId) !== actor.orgId) refuse('Team not found in your organization', PRIVILEGE, 'TEAM_NOT_FOUND')
    const limit = Math.min(Math.max(typeof a.p_limit === 'number' ? a.p_limit : 50, 1), 200)
    const search = trimmed(a.p_search)?.toLowerCase() ?? null
    const cursor = trimmed(a.p_cursor)
    const myTeams = this.world.teamsOfUser(actor.id)
    const has = (v: string | null | undefined) => !!search && !!v && v.toLowerCase().includes(search)
    const responsesOf = (r: ReviewRow) => this.responses.filter((x) => x.reviewId === r.id)
    const open = (r: ReviewRow) => r.status === 'pending' || r.status === 'kicked_back'

    const rows: Array<{ key: string; payload: JsonObject }> = []
    for (const r of this.reviews) {
      if (r.orgId !== actor.orgId) continue
      const owed = this.owedIds(r, actor.id).length
      const inBucket =
        bucket === 'awaiting_me' ? owed > 0
          : bucket === 'requested_by_me' ? r.requestedBy === actor.id && open(r)
            : bucket === 'my_teams' ? open(r) && ((!!r.teamId && myTeams.includes(r.teamId)) || responsesOf(r).some((x) => !!x.viaTeamId && myTeams.includes(x.viaTeamId)))
              : !open(r) && (r.requestedBy === actor.id || responsesOf(r).some((x) => x.reviewerId === actor.id))
      if (!inBucket) continue
      if (teamId && r.teamId !== teamId && !responsesOf(r).some((x) => x.viaTeamId === teamId)) continue
      if (search) {
        const requester = this.world.user(r.requestedBy)
        const hit = has(r.title) || has(r.message) || has(requester?.fullName) || has(requester?.email) ||
          this.itemsOf(r.id).some((i) => {
            const f = this.world.file(i.fileId)
            return has(f?.fileName) || has(f?.partNumber) || has(f?.description)
          })
        if (!hit) continue
      }
      const involved = r.requestedBy === actor.id || owed > 0 || responsesOf(r).some((x) => x.reviewerId === actor.id) ||
        this.items.some((i) => i.reviewId === r.id && this.world.canAccessVault(actor.id, i.vaultId))
      if (!involved) continue
      const overdue = this.overdue(r)
      const key = bucket === 'done'
        ? (253402300799999999n - BigInt(Date.parse(r.completedAt ?? r.cancelledAt ?? r.updatedAt ?? r.requestedAt)) * 1000n).toString().padStart(18, '0') + r.id
        : (overdue ? '0' : '1') + String(PRIORITY_RANK[r.priority] ?? 2) + (r.dueDate ?? '9999-12-31').replace(/-/g, '') + sortStamp(r.requestedAt) + r.id
      const first = this.itemsOf(r.id)[0]
      const firstFile = first ? this.world.file(first.fileId) : null
      const firstVersion = first ? this.world.version(first.fileVersionId) : null
      rows.push({
        key,
        payload: {
          kind: 'package',
          id: r.id,
          title: this.displayTitle(r),
          status: statusLabel(r.status),
          priority: r.priority,
          due_date: r.dueDate,
          overdue,
          mode: r.mode,
          round: r.currentRound,
          requested_by: this.userJson(r.requestedBy),
          requested_at: r.requestedAt,
          completed_at: r.completedAt,
          team_id: r.teamId,
          item_count: this.items.filter((i) => i.reviewId === r.id).length,
          items_decided: this.roundItems.filter((x) => x.reviewId === r.id && x.roundNumber === r.currentRound && x.outcome !== 'pending').length,
          items_owed_by_me: owed,
          // Schema 514: the round's reviewers who still owe it, and those withdrawn from it.
          reviewers_owing: responsesOf(r).filter((x) => x.roundNumber === r.currentRound && x.status === 'pending' && !x.withdrawnAt).length,
          reviewers_withdrawn: responsesOf(r).filter((x) => x.roundNumber === r.currentRound && !!x.withdrawnAt).length,
          preview: first && firstFile && firstVersion
            ? { file_id: firstFile.id, file_name: firstFile.fileName, extension: firstFile.extension, file_version_id: firstVersion.id, version: firstVersion.version, revision: firstVersion.revision }
            : null,
          gate: null,
        },
      })
    }
    if (bucket === 'awaiting_me' && !teamId) {
      for (const g of this.gatesAwaiting(actor.id, actor.orgId)) {
        const f = this.world.file(g.fileId)
        const t = this.transitions.find((x) => x.id === g.transitionId)
        if (!f || !t) continue
        if (search && !has(f.fileName) && !has(g.gateName)) continue
        const from = this.states.find((s) => s.id === t.fromStateId)
        const to = this.states.find((s) => s.id === t.toStateId)
        rows.push({
          key: '1299991231' + sortStamp(g.requestedAt) + g.id,
          payload: {
            kind: 'gate', id: g.id, title: `${f.fileName} - ${g.gateName}`, status: 'open', priority: 'normal', due_date: null,
            overdue: false, mode: null, round: null, requested_by: this.userJson(g.requestedBy), requested_at: g.requestedAt,
            completed_at: null, team_id: null, item_count: 1, items_decided: 0, items_owed_by_me: 1,
            reviewers_owing: null, reviewers_withdrawn: null,
            preview: { file_id: f.id, file_name: f.fileName, extension: f.extension, file_version_id: null, version: f.version, revision: f.revision },
            gate: {
              pending_review_id: g.id, file_id: f.id, file_name: f.fileName, file_path: f.filePath, gate_id: g.gateId, gate_name: g.gateName,
              gate_type: g.gateType, transition_id: t.id, transition_name: t.name, from_state_name: from?.name ?? null,
              to_state_name: to?.name ?? null, checklist_items: g.checklistItems,
            },
          },
        })
      }
    }
    const page = rows.filter((x) => !cursor || x.key > cursor).sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0))
    const shown = page.slice(0, limit)
    return {
      rows: shown.map((x) => ({ ...x.payload, cursor: x.key })),
      next_cursor: page.length > limit ? shown[shown.length - 1].key : null,
    }
  }

  detail(a: Record<string, unknown>): JsonObject {
    const { actor, r } = this.requireAccess(a.p_review_id)
    const isRequester = r.requestedBy === actor.id
    const isReviewer = this.responses.some((x) => x.reviewId === r.id && x.reviewerId === actor.id)
    const involved = isRequester || isReviewer || actor.admin
    const owed = this.owedIds(r, actor.id)
    const items = this.itemsOf(r.id)
      .filter((i) => involved || this.world.canAccessVault(actor.id, i.vaultId))
      .flatMap((i): JsonObject[] => {
        const f = this.world.file(i.fileId)
        const v = this.world.version(i.fileVersionId)
        if (!f || !v) return []
        const pdf = this.world.pdf(v.id)
        return [{
          id: i.id,
          file_id: i.fileId,
          vault_id: i.vaultId,
          sort_order: i.sortOrder,
          outcome: i.outcome,
          added_in_round: i.addedInRound,
          file: {
            file_name: f.fileName, file_path: f.filePath, extension: f.extension, part_number: f.partNumber,
            description: f.description, latest_version: f.version, deleted: f.deleted,
          },
          version: {
            file_version_id: v.id, version: v.version, revision: v.revision, content_hash: v.contentHash, file_size: v.fileSize,
            state: v.state, created_at: v.createdAt, created_by: v.createdBy, references_recorded: v.referencesRecorded,
          },
          pdf: pdf
            ? { storage_hash: pdf.storageHash, file_size: pdf.fileSize, is_closure_exact: pdf.closureExact, generated_by: pdf.generatedBy, generated_at: pdf.generatedAt }
            : null,
          rounds: this.roundItems
            .filter((x) => x.itemId === i.id)
            .sort((x, y) => x.roundNumber - y.roundNumber)
            .map((x) => {
              const rv = this.world.version(x.fileVersionId)
              return {
                round_number: x.roundNumber,
                file_version_id: x.fileVersionId,
                version: rv?.version ?? null,
                revision: rv?.revision ?? null,
                is_carried_forward: x.isCarriedForward,
                outcome: x.outcome,
                decided_at: x.decidedAt,
                decisions: this.decisions
                  .filter((d) => d.itemId === i.id && d.roundNumber === x.roundNumber)
                  .sort((p, q) => p.decidedAt.localeCompare(q.decidedAt) || p.seq - q.seq)
                  .map((d) => ({ reviewer_id: d.reviewerId, decision: d.decision, comment: d.comment, decided_at: d.decidedAt, legacy: d.legacy })),
              }
            }),
        }]
      })
    return {
      review: {
        id: r.id, title: this.displayTitle(r), raw_title: r.title, message: r.message, status: statusLabel(r.status),
        priority: r.priority, due_date: r.dueDate, overdue: this.overdue(r), mode: r.mode, current_round: r.currentRound,
        team_id: r.teamId, requested_by: this.userJson(r.requestedBy), requested_at: r.requestedAt, completed_at: r.completedAt,
        cancelled_by: this.userJson(r.cancelledBy), cancelled_at: r.cancelledAt, cancel_reason: r.cancelReason,
      },
      items,
      rounds: this.rounds
        .filter((x) => x.reviewId === r.id)
        .sort((x, y) => x.roundNumber - y.roundNumber)
        .map((x) => ({ round_number: x.roundNumber, opened_by: x.openedBy, opened_at: x.openedAt, note: x.note, closed_at: x.closedAt, outcome: x.outcome })),
      reviewers: this.responses
        .filter((x) => x.reviewId === r.id)
        .sort((x, y) => x.roundNumber - y.roundNumber || x.seq - y.seq)
        .map((x) => ({
          user: this.userJson(x.reviewerId), round_number: x.roundNumber,
          status: x.status === 'kicked_back' ? 'changes_requested' : x.status, via_team_id: x.viaTeamId,
          responded_at: x.respondedAt, withdrawn_reason: x.withdrawnReason,
        })),
      me: {
        user_id: actor.id, is_requester: isRequester, is_reviewer: isReviewer, is_admin: actor.admin, owed_item_ids: owed,
        can_respond: r.status === 'pending' && owed.length > 0,
        can_cancel: (r.status === 'pending' || r.status === 'kicked_back') && (isRequester || actor.admin),
        can_resubmit: (r.status === 'kicked_back' || r.status === 'rejected') && (isRequester || actor.admin),
        can_edit_meta: (r.status === 'pending' || r.status === 'kicked_back') && (isRequester || actor.admin),
      },
    }
  }

  countBadge(): number {
    const id = this.world.actorId()
    const user = this.world.user(id)
    if (!id || !user?.orgId) return 0
    const items = this.reviews.filter((r) => r.orgId === user.orgId).reduce((n, r) => n + this.owedIds(r, id).length, 0)
    return items + this.gatesAwaiting(id, user.orgId).length
  }

  /** Whether `userId` may comment on the review's item in its current round (trg_file_comment_link_review). */
  commentAllowed(reviewId: string, itemId: string | null, round: number | null, userId: string, fileId: string): string | null {
    const r = this.reviews.find((x) => x.id === reviewId)
    if (!r) return 'Review not found'
    const admin = this.world.user(userId)?.admin ?? false
    if (userId !== r.requestedBy && !this.responses.some((x) => x.reviewId === r.id && x.reviewerId === userId) && !admin) {
      return 'Only the requester and the reviewers can comment in a review'
    }
    if (round !== null && round !== r.currentRound) return 'Comments can only be added to the current round'
    if (itemId && !this.items.some((i) => i.id === itemId && i.reviewId === r.id && i.fileId === fileId)) {
      return 'That item is not this file in this review'
    }
    return null
  }

  /** Whether `userId` is the requester or a not-withdrawn reviewer of the review (file_comment_set_resolved, schema 512). */
  mayResolveIn(reviewId: string, userId: string): boolean {
    const r = this.reviews.find((x) => x.id === reviewId)
    if (!r) return false
    const mine = this.responses.filter((x) => x.reviewId === r.id && x.reviewerId === userId)
    return userId === r.requestedBy || (mine.length > 0 && mine.every((x) => !x.withdrawnAt))
  }

  /** Who a comment in the review notifies (trg_file_comment_notify_review, schema 514): the requester and the current round's reviewers not withdrawn. */
  commentAudience(reviewId: string): { orgId: string; open: boolean; priority: string; recipients: string[] } | null {
    const r = this.reviews.find((x) => x.id === reviewId)
    if (!r) return null
    const reviewers = this.responses.filter((x) => x.reviewId === r.id && x.roundNumber === r.currentRound && !x.withdrawnAt).map((x) => x.reviewerId)
    return { orgId: r.orgId, open: r.status === 'pending' || r.status === 'kicked_back', priority: r.priority, recipients: [r.requestedBy, ...reviewers] }
  }

  currentRound(reviewId: string): number | null {
    return this.reviews.find((x) => x.id === reviewId)?.currentRound ?? null
  }
}
