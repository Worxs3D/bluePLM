/**
 * The file routes that change state: checkout, check-in, undo-checkout, soft
 * delete, state changes. Each runs through the real auth plugin and route code
 * against FakeSupabase (see api/test/routeHarness.ts), and the assertions read
 * what landed in the fake, not only the status code.
 */

import { createHash } from 'node:crypto'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  createRouteHarness,
  OTHER_ORG_ID,
  ORG_ID,
  PERSONAS,
  VAULT_ID,
  type RouteHarness,
} from '../test/routeHarness.js'

const FILE_ID = '00000000-0000-4000-8000-0000000000f1'
const MISSING_ID = '00000000-0000-4000-8000-0000000000f9'
const ENGINEER = PERSONAS.engineer.id
const VIEWER = PERSONAS.viewer.id

/** What `execute_transition_to_legacy_state` answers; NO_WORKFLOW means unmanaged. */
let transitionAnswer: Record<string, unknown>

let harness: RouteHarness

beforeEach(async () => {
  harness = await createRouteHarness()
  transitionAnswer = { success: false, error_code: 'NO_WORKFLOW' }
  harness.fake.defineRpc('execute_transition_to_legacy_state', () => transitionAnswer)
  harness.fake.seed('files', {
    id: FILE_ID,
    org_id: ORG_ID,
    vault_id: VAULT_ID,
    file_path: 'Parts/Bracket.SLDPRT',
    file_name: 'Bracket.SLDPRT',
    extension: '.SLDPRT',
    created_by: ENGINEER,
    content_hash: 'a'.repeat(64),
    file_size: 10,
    state: 'wip',
  })
})

afterEach(async () => {
  await harness.close()
})

const file = () => harness.fake.row('files', FILE_ID)

function lockBy(userId: string) {
  Object.assign(file(), {
    checked_out_by: userId,
    checked_out_at: harness.fake.isoNow(),
    checked_out_file_path: file().file_path,
    checked_out_file_name: file().file_name,
  })
}

describe('POST /files/:id/checkout', () => {
  it('locks the file to the caller with the lock message and logs it', async () => {
    const response = await harness.inject({
      method: 'POST',
      url: `/files/${FILE_ID}/checkout`,
      persona: 'engineer',
      payload: { message: 'fixing the hole pattern' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ success: true, file: { id: FILE_ID, checked_out_by: ENGINEER } })
    expect(file()).toMatchObject({
      checked_out_by: ENGINEER,
      lock_message: 'fixing the hole pattern',
      checked_out_by_machine_name: 'API',
      checked_out_file_path: 'Parts/Bracket.SLDPRT',
    })
    expect(harness.fake.rows('activity')).toEqual([
      expect.objectContaining({ file_id: FILE_ID, action: 'checkout', user_id: ENGINEER }),
    ])
  })

  it('accepts a call with no body, since every field is optional', async () => {
    const response = await harness.inject({ method: 'POST', url: `/files/${FILE_ID}/checkout`, persona: 'engineer' })

    expect(response.statusCode).toBe(200)
    expect(file()).toMatchObject({ checked_out_by: ENGINEER, lock_message: null })
  })

  it('refuses a file someone else holds and leaves their lock alone', async () => {
    lockBy(VIEWER)

    const response = await harness.inject({
      method: 'POST',
      url: `/files/${FILE_ID}/checkout`,
      persona: 'engineer',
      payload: {},
    })

    expect(response.statusCode).toBe(409)
    expect(file().checked_out_by).toBe(VIEWER)
  })

  it('answers 404 for an unknown file', async () => {
    const response = await harness.inject({
      method: 'POST',
      url: `/files/${MISSING_ID}/checkout`,
      persona: 'engineer',
      payload: {},
    })

    expect(response.statusCode).toBe(404)
  })

  it('rejects an id that is not a uuid before touching the database', async () => {
    const response = await harness.inject({ method: 'POST', url: '/files/not-a-uuid/checkout', persona: 'engineer' })

    expect(response.statusCode).toBe(400)
    expect(harness.writes()).toEqual([])
  })
})

describe('POST /files/:id/checkin', () => {
  it('stores new content by hash, bumps the version and releases the lock', async () => {
    lockBy(ENGINEER)
    const content = Buffer.from('new geometry')
    const hash = createHash('sha256').update(content).digest('hex')

    const response = await harness.inject({
      method: 'POST',
      url: `/files/${FILE_ID}/checkin`,
      persona: 'engineer',
      payload: { comment: 'moved holes', content: content.toString('base64') },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ success: true, contentChanged: true })
    expect(harness.fake.hasObject(`vault/${ORG_ID}/${hash.slice(0, 2)}/${hash}`)).toBe(true)
    expect(file()).toMatchObject({
      checked_out_by: null,
      content_hash: hash,
      file_size: content.length,
      version: 2,
    })
    expect(harness.fake.rows('file_versions')).toEqual([
      expect.objectContaining({ file_id: FILE_ID, version: 2, content_hash: hash, comment: 'moved holes' }),
    ])
  })

  it('accepts a call with no body and releases the lock without a new version', async () => {
    lockBy(ENGINEER)

    const response = await harness.inject({ method: 'POST', url: `/files/${FILE_ID}/checkin`, persona: 'engineer' })

    expect(response.statusCode).toBe(200)
    expect(file()).toMatchObject({ checked_out_by: null, version: 1 })
    expect(harness.fake.rows('file_versions')).toEqual([])
  })

  it('refuses a caller who does not hold the lock and writes no version', async () => {
    lockBy(VIEWER)

    const response = await harness.inject({
      method: 'POST',
      url: `/files/${FILE_ID}/checkin`,
      persona: 'engineer',
      payload: { content_hash: 'b'.repeat(64), file_size: 11 },
    })

    expect(response.statusCode).toBe(403)
    expect(file()).toMatchObject({ checked_out_by: VIEWER, version: 1, content_hash: 'a'.repeat(64) })
    expect(harness.fake.rows('file_versions')).toEqual([])
  })
})

describe('POST /files/:id/undo-checkout', () => {
  it('lets an admin release a lock someone else holds', async () => {
    lockBy(ENGINEER)

    const response = await harness.inject({
      method: 'POST',
      url: `/files/${FILE_ID}/undo-checkout`,
      persona: 'teamAdmin',
    })

    expect(response.statusCode).toBe(200)
    expect(file()).toMatchObject({ checked_out_by: null, checked_out_file_path: null })
  })

  it('refuses a non-admin who does not hold the lock', async () => {
    lockBy(ENGINEER)

    const response = await harness.inject({ method: 'POST', url: `/files/${FILE_ID}/undo-checkout`, persona: 'viewer' })

    expect(response.statusCode).toBe(403)
    expect(file().checked_out_by).toBe(ENGINEER)
  })

  it('answers 404, not 500, for an unknown file', async () => {
    const response = await harness.inject({
      method: 'POST',
      url: `/files/${MISSING_ID}/undo-checkout`,
      persona: 'engineer',
    })

    expect(response.statusCode).toBe(404)
    expect(response.json()).toMatchObject({ error: 'NOT_FOUND' })
  })
})

describe('DELETE /files/:id', () => {
  it('soft-deletes and bumps updated_at for delta sync', async () => {
    const before = file().updated_at

    const response = await harness.inject({ method: 'DELETE', url: `/files/${FILE_ID}`, persona: 'engineer' })

    expect(response.statusCode).toBe(200)
    expect(file().deleted_by).toBe(ENGINEER)
    expect(file().deleted_at).toEqual(expect.any(String))
    expect(file().updated_at).not.toBe(before)
  })

  it('refuses a file someone else has checked out', async () => {
    lockBy(VIEWER)

    const response = await harness.inject({ method: 'DELETE', url: `/files/${FILE_ID}`, persona: 'engineer' })

    expect(response.statusCode).toBe(409)
    expect(file().deleted_at).toBeNull()
  })

  it('answers 404 for a file in another organization and leaves it alone', async () => {
    file().org_id = OTHER_ORG_ID

    const response = await harness.inject({ method: 'DELETE', url: `/files/${FILE_ID}`, persona: 'engineer' })

    expect(response.statusCode).toBe(404)
    expect(file().deleted_at).toBeNull()
  })
})

describe('PATCH /files/:id/metadata', () => {
  it('writes the state column directly for a file on no workflow', async () => {
    const response = await harness.inject({
      method: 'PATCH',
      url: `/files/${FILE_ID}/metadata`,
      persona: 'engineer',
      payload: { state: 'in_review' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ success: true, file: { id: FILE_ID, state: 'in_review' } })
    expect(file()).toMatchObject({ state: 'in_review', state_changed_by: ENGINEER, updated_by: ENGINEER })
  })

  it('refuses to change the state of a checked-out file, as /release does', async () => {
    lockBy(VIEWER)

    const response = await harness.inject({
      method: 'PATCH',
      url: `/files/${FILE_ID}/metadata`,
      persona: 'engineer',
      payload: { state: 'released' },
    })

    expect(response.statusCode).toBe(409)
    expect(file().state).toBe('wip')
    expect(harness.writes()).toEqual([])
  })

  it('answers 404 for an unknown file and writes nothing', async () => {
    const response = await harness.inject({
      method: 'PATCH',
      url: `/files/${MISSING_ID}/metadata`,
      persona: 'engineer',
      payload: { state: 'released' },
    })

    expect(response.statusCode).toBe(404)
    expect(harness.writes()).toEqual([])
  })

  it('answers 404 for a file in another organization', async () => {
    file().org_id = OTHER_ORG_ID

    const response = await harness.inject({
      method: 'PATCH',
      url: `/files/${FILE_ID}/metadata`,
      persona: 'engineer',
      payload: { state: 'released' },
    })

    expect(response.statusCode).toBe(404)
    expect(file().state).toBe('wip')
  })

  it('answers 202 and leaves the row when the workflow opens reviews', async () => {
    transitionAnswer = { success: false, requires_review: true }

    const response = await harness.inject({
      method: 'PATCH',
      url: `/files/${FILE_ID}/metadata`,
      persona: 'engineer',
      payload: { state: 'released' },
    })

    expect(response.statusCode).toBe(202)
    expect(response.json()).toEqual({ success: true, requires_review: true })
    expect(file().state).toBe('wip')
  })

  it('maps a workflow refusal onto its status and does not fall back to the column write', async () => {
    transitionAnswer = { success: false, error_code: 'ROLE_REQUIRED', error_message: 'Needs a reviewer' }

    const response = await harness.inject({
      method: 'PATCH',
      url: `/files/${FILE_ID}/metadata`,
      persona: 'engineer',
      payload: { state: 'released' },
    })

    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({ message: 'Needs a reviewer' })
    expect(file().state).toBe('wip')
  })

  it('rejects a state outside the enum', async () => {
    const response = await harness.inject({
      method: 'PATCH',
      url: `/files/${FILE_ID}/metadata`,
      persona: 'engineer',
      payload: { state: 'approved' },
    })

    expect(response.statusCode).toBe(400)
    expect(file().state).toBe('wip')
  })
})

describe('POST /files/:id/release', () => {
  it('releases a file on no workflow and reports the previous state', async () => {
    const response = await harness.inject({ method: 'POST', url: `/files/${FILE_ID}/release`, persona: 'engineer' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ success: true, previous_state: 'wip', file: { state: 'released' } })
    expect(file().state).toBe('released')
  })

  it('refuses a checked-out file', async () => {
    lockBy(ENGINEER)

    const response = await harness.inject({ method: 'POST', url: `/files/${FILE_ID}/release`, persona: 'engineer' })

    expect(response.statusCode).toBe(409)
    expect(file().state).toBe('wip')
  })

  it('refuses a file that is already released', async () => {
    file().state = 'released'

    const response = await harness.inject({ method: 'POST', url: `/files/${FILE_ID}/release`, persona: 'engineer' })

    expect(response.statusCode).toBe(400)
  })
})
