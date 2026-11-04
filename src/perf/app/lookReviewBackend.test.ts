/**
 * The ui-look review backend's state machine against the rules of 20-change-control.sql: modes,
 * per-reviewer decisions, comment rule, settle, resubmit rounds, cancel, withdrawals, the review
 * stage, and that the results map through the app's own mappers (reviewMapping.ts).
 */
import { beforeEach, describe, expect, it } from 'vitest'

import { buildSyntheticVault, FIXTURE_USER_ID } from '@/lib/loadPipelineFixtures'
import { mapQueuePage, mapReviewDetail, mapReviewWorkflowStatus } from '@/lib/supabase/reviewMapping'

import { createPerfBackend, PERF_ORG_ID, PERF_VAULT_ID, type PerfBackend } from './backend'
import { installLookReviews, type LookReviews } from './lookReviewBackend'
import { LOOK_REVIEW_FILE_IDS, LOOK_REVIEW_PEOPLE, lookReviewVersionId, prepareLookReviewVault } from './lookReviewFixtures'

const SAM = LOOK_REVIEW_PEOPLE.sam.id
const ALEX = LOOK_REVIEW_PEOPLE.alex.id
const OLIVE = LOOK_REVIEW_PEOPLE.olive.id
const DRAWING = 'PMP-2001.SLDDRW'
const PART = 'PMP-2001.SLDPRT'

let backend: PerfBackend
let reviews: LookReviews

async function rpc(name: string, args: Record<string, unknown> = {}) {
  return reviews.rpc(name, args)
}

async function ok(name: string, args: Record<string, unknown> = {}) {
  const { data, error } = await rpc(name, args)
  if (error) throw new Error(`${name}: ${error.message} (${error.hint ?? ''})`)
  return data as Record<string, unknown>
}

async function requestHousing(reviewers: string[] = [SAM, ALEX], mode = 'all'): Promise<string> {
  reviews.setActor(FIXTURE_USER_ID)
  const out = await ok('review_request', {
    p_file_version_ids: [lookReviewVersionId(DRAWING, 3), lookReviewVersionId(PART, 5)],
    p_reviewer_ids: reviewers,
    p_team_ids: [],
    p_title: 'Pump housing',
    p_mode: mode,
    p_priority: 'high',
  })
  return String(out.review_id)
}

async function detail(reviewId: string) {
  return mapReviewDetail(await ok('review_get_detail', { p_review_id: reviewId }))
}

const item = (d: Awaited<ReturnType<typeof detail>>, name: string) => d.items.find((i) => i.file.fileName === name)!.id

async function decide(userId: string, reviewId: string, decisions: Array<[string, string, string?]>) {
  reviews.setActor(userId)
  const d = await detail(reviewId)
  return rpc('review_item_respond', {
    p_review_id: reviewId,
    p_decisions: decisions.map(([name, decision, comment]) => ({ item_id: item(d, name), decision, comment: comment ?? null })),
  })
}

const notificationTypes = (userId: string) =>
  backend.db.rows('notification').filter((n) => n.user_id === userId).map((n) => n.type)

beforeEach(async () => {
  const vault = buildSyntheticVault(60)
  prepareLookReviewVault(vault, 'C:\\Vault', FIXTURE_USER_ID, SAM)
  backend = createPerfBackend(vault)
  reviews = await installLookReviews(backend, { orgId: PERF_ORG_ID, vaultId: PERF_VAULT_ID, userId: FIXTURE_USER_ID })
})

describe('look review backend', () => {
  it('settles an all-mode review only when every reviewer decided, worst decision wins', async () => {
    const id = await requestHousing()
    expect(notificationTypes(SAM)).toEqual(['review_request'])

    expect((await decide(SAM, id, [[DRAWING, 'approved'], [PART, 'approved']])).error).toBeNull()
    reviews.setActor(FIXTURE_USER_ID)
    let d = await detail(id)
    expect(d.review.status).toBe('open')
    expect(d.items.every((i) => i.outcome === 'pending')).toBe(true)

    // A decision other than a plain approval needs a comment.
    const refused = await decide(ALEX, id, [[DRAWING, 'changes_requested']])
    expect(refused.error?.hint).toBe('COMMENT_REQUIRED')

    await decide(ALEX, id, [[DRAWING, 'changes_requested', 'Bore tolerance missing'], [PART, 'approved']])
    reviews.setActor(FIXTURE_USER_ID)
    d = await detail(id)
    expect(d.review.status).toBe('changes_requested')
    expect(Object.fromEntries(d.items.map((i) => [i.file.fileName, i.outcome]))).toEqual({ [DRAWING]: 'changes_requested', [PART]: 'approved' })
    expect(d.me.canResubmit).toBe(true)
    expect(notificationTypes(FIXTURE_USER_ID)).toContain('review_kicked_back')
    // Nothing is owed once the round is closed.
    expect((await decide(SAM, id, [[DRAWING, 'approved']])).error?.hint).toBe('REVIEW_CLOSED')
  })

  it('opens round 2 at a newer version, carries approved items forward, then approves and advances', async () => {
    const id = await requestHousing()
    await decide(SAM, id, [[DRAWING, 'changes_requested', 'Add the wall callout'], [PART, 'approved']])
    await decide(ALEX, id, [[DRAWING, 'approved'], [PART, 'approved']])
    reviews.setActor(FIXTURE_USER_ID)
    const before = await detail(id)

    const same = await rpc('review_resubmit', { p_review_id: id, p_items: [{ item_id: item(before, DRAWING), file_version_id: lookReviewVersionId(DRAWING, 3) }] })
    expect(same.error?.hint).toBe('SAME_VERSION')

    const v4 = await reviews.checkInNewVersion(DRAWING)
    const round = await ok('review_resubmit', { p_review_id: id, p_items: [{ item_id: item(before, DRAWING), file_version_id: v4 }], p_note: 'Callout added' })
    expect(round).toMatchObject({ round: 2, items_to_review: 1, carried_forward: 1 })

    reviews.setActor(SAM)
    const r2 = await detail(id)
    expect(r2.review.currentRound).toBe(2)
    expect(r2.me.owedItemIds).toEqual([item(r2, DRAWING)])
    expect(r2.items.find((i) => i.file.fileName === DRAWING)!.version.version).toBe(4)
    expect(r2.items.find((i) => i.file.fileName === DRAWING)!.pdf).not.toBeNull()

    await ok('review_approve_all_remaining', { p_review_id: id })
    reviews.setActor(ALEX)
    await ok('review_approve_all_remaining', { p_review_id: id, p_comment: 'Looks right now' })

    reviews.setActor(FIXTURE_USER_ID)
    expect((await detail(id)).review.status).toBe('approved')
    let stage = mapReviewWorkflowStatus(await ok('review_get_workflow_status', { p_review_id: id }))
    expect(stage.onApproval).toBe('hold')
    expect(stage.items.every((i) => i.inReviewStage && i.nextStateName === 'Released')).toBe(true)

    expect(await ok('review_advance_files', { p_review_id: id, p_only_approved: false })).toEqual({ moved: 2, skipped: [] })
    stage = mapReviewWorkflowStatus(await ok('review_get_workflow_status', { p_review_id: id }))
    expect(stage.items.map((i) => [i.stateName, i.advancedToStateName])).toEqual([['Released', 'Released'], ['Released', 'Released']])
  })

  it('settles an any-mode item on the first decision', async () => {
    const id = await requestHousing([SAM, ALEX], 'any')
    await decide(ALEX, id, [[DRAWING, 'approved_with_comments', 'Fine'], [PART, 'approved']])
    reviews.setActor(SAM)
    const d = await detail(id)
    expect(d.review.status).toBe('approved')
    expect(d.me.owedItemIds).toEqual([])
  })

  it('lets only the requester or an admin cancel, and tells the reviewers who still owed', async () => {
    const id = await requestHousing()
    reviews.setActor(SAM)
    expect((await rpc('review_cancel', { p_review_id: id })).error?.hint).toBe('FORBIDDEN')
    reviews.setActor(FIXTURE_USER_ID)
    await ok('review_cancel', { p_review_id: id, p_reason: 'Superseded' })
    const d = await detail(id)
    expect(d.review.status).toBe('cancelled')
    expect(d.review.cancelReason).toBe('Superseded')
    expect(notificationTypes(SAM)).toContain('review_cancelled')
  })

  it('withdraws a reviewer who lost the vault and tells the requester nobody is left', async () => {
    const id = await requestHousing([OLIVE])
    reviews.setVaultAccess('olive', false)
    reviews.setActor(FIXTURE_USER_ID)
    const d = await detail(id)
    expect(d.review.status).toBe('open')
    expect(d.reviewers.map((r) => [r.status, r.withdrawnReason])).toEqual([['cancelled', 'lost_vault_access']])
    const removed = backend.db.rows('notification').find((n) => n.type === 'review_reviewer_removed')
    expect(String(removed?.message)).toContain('Nobody is left to decide')
  })

  it('lists queues the app maps: awaiting for reviewers, gate rows, requested and done for the author', async () => {
    const id = await requestHousing()
    reviews.setActor(SAM)
    const awaiting = mapQueuePage(await ok('review_list_queue', { p_bucket: 'awaiting_me' }))
    expect(awaiting.rows.map((r) => [r.id, r.itemsOwedByMe, r.preview?.fileName])).toEqual([[id, 2, DRAWING]])
    expect(await ok('review_count_badge')).toBe(2)

    reviews.setActor(FIXTURE_USER_ID)
    const mine = mapQueuePage(await ok('review_list_queue', { p_bucket: 'awaiting_me' }))
    expect(mine.rows.map((r) => r.kind)).toEqual(['gate'])
    expect(mine.rows[0].gate?.toStateName).toBe('Released')
    expect(mapQueuePage(await ok('review_list_queue', { p_bucket: 'requested_by_me' })).rows.map((r) => r.id)).toEqual([id])

    await ok('review_cancel', { p_review_id: id })
    expect(mapQueuePage(await ok('review_list_queue', { p_bucket: 'done' })).rows.map((r) => r.status)).toEqual(['cancelled'])
    expect(LOOK_REVIEW_FILE_IDS[DRAWING]).toBeTruthy()
  })
})
