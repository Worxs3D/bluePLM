import { describe, expect, it } from 'vitest'

import { FakeSupabase } from './fakeSupabase'

describe('FakeSupabase.holdRpc (a slow server, for the render harness)', () => {
  it('keeps a call open, without running its handler, until it is released', async () => {
    const db = new FakeSupabase()
    let runs = 0
    db.defineRpc('review_request', () => {
      runs++
      return 'review-1'
    })
    db.holdRpc('review_request')
    expect(db.heldRpcNames()).toEqual(['review_request'])

    let settled = false
    const call = db.client.rpc('review_request', { p_file_version_ids: ['v1'] }).then((result) => {
      settled = true
      return result
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(settled).toBe(false)
    expect(runs).toBe(0)

    db.releaseRpc('review_request')
    await expect(call).resolves.toMatchObject({ data: 'review-1', error: null })
    expect(runs).toBe(1)
    expect(db.heldRpcNames()).toEqual([])

    // Released: later calls run at once.
    await expect(db.client.rpc('review_request', { p_file_version_ids: ['v1'] })).resolves.toMatchObject({
      data: 'review-1',
    })
  })

  it('releases every held RPC when no name is given', async () => {
    const db = new FakeSupabase()
    db.defineRpc('review_request', () => 'a')
    db.defineRpc('review_cancel', () => 'b')
    db.holdRpc('review_request')
    db.holdRpc('review_cancel')
    const calls = Promise.all([
      db.client.rpc('review_request', { p_file_version_ids: ['v1'] }),
      db.client.rpc('review_cancel', { p_review_id: 'r1' }),
    ])
    db.releaseRpc()
    await expect(calls).resolves.toMatchObject([{ data: 'a' }, { data: 'b' }])
  })
})
