import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { activateBackend } from './backend'
import { decideMdbWorkflowReview, getMdbAvailableTransitions, getMdbMyWorkflowReviews, saveMdbConfig } from './mdb'

describe('MDB workflow transition seam', () => {
  const storage = new Map<string, string>()

  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
    })
  })

  afterEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('calls the server route expected by the workflow client', async () => {
    activateBackend('mdb')
    saveMdbConfig({ version: 1, serverUrl: 'https://mdb.example.test', accessToken: 'session' })
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ transitions: [{
        transition_id: 'transition-1', transition_name: 'Release', to_state_id: 'state-2',
        to_state_name: 'Released', to_state_color: '#0f0', has_gates: false,
        user_can_transition: true,
      }] }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(getMdbAvailableTransitions('file-1')).resolves.toEqual([expect.objectContaining({
      transition_id: 'transition-1', has_gates: false, user_can_transition: true,
    })])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'https://mdb.example.test/files/file-1/available-transitions',
    )
  })

  it('preserves the exact mine and decision review contracts', async () => {
    activateBackend('mdb')
    saveMdbConfig({ version: 1, serverUrl: 'https://mdb.example.test', accessToken: 'session' })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ reviews: [{
        review_id: 'review-1', file_id: 'file-1', file_name: 'drawing', file_path: 'drawing.txt',
        gate_id: null, gate_name: null, gate_type: null, transition_id: 'transition-1',
        transition_name: 'Release', from_state_name: 'Draft', to_state_name: 'Released',
        requested_by: 'user-1', requested_by_email: 'owner@example.test', requested_at: '2026-01-01T00:00:00Z', checklist_items: [],
      }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: {
        success: true, requires_review: false, new_state_id: 'state-2', new_state_name: 'Released', new_revision: '2', error_code: null, error_message: null,
      } }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getMdbMyWorkflowReviews()).resolves.toEqual([expect.objectContaining({ review_id: 'review-1', gate_id: null })])
    await expect(decideMdbWorkflowReview('review-1', 'approved', 'looks good', { verified: true })).resolves.toMatchObject({ new_state_id: 'state-2' })
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://mdb.example.test/workflow-reviews/mine')
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe('https://mdb.example.test/workflow-reviews/review-1/decision')
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: 'POST', body: JSON.stringify({ decision: 'approved', comment: 'looks good', checklistResponses: { verified: true } }) })
  })
})
