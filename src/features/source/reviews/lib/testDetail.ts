/**
 * Builders for review details and queue rows in unit tests. Not used by the app.
 */

import type {
  ReviewDetail,
  ReviewItemDetail,
  ReviewItemRound,
  ReviewQueueRow,
  ReviewUser,
  ReviewerAssignment,
} from '@/types/reviews'

export const ME = 'u-me'
export const SAM: ReviewUser = {
  id: 'u-sam',
  email: 'sam@example.com',
  fullName: 'Sam Rivera',
  avatarUrl: null,
}
export const KIM: ReviewUser = {
  id: 'u-kim',
  email: 'kim@example.com',
  fullName: 'Kim Li',
  avatarUrl: null,
}
export const MEUSER: ReviewUser = {
  id: ME,
  email: 'me@example.com',
  fullName: 'Me Myself',
  avatarUrl: null,
}

export function testRow(extra: Partial<ReviewQueueRow> = {}): ReviewQueueRow {
  return {
    kind: 'package',
    id: 'r1',
    title: 'Bracket set',
    status: 'open',
    priority: 'normal',
    dueDate: null,
    overdue: false,
    mode: 'all',
    round: 1,
    requestedBy: SAM,
    requestedAt: '2026-11-01T10:00:00Z',
    completedAt: null,
    teamId: null,
    itemCount: 4,
    itemsDecided: 1,
    itemsOwedByMe: 0,
    reviewersOwing: null,
    reviewersWithdrawn: null,
    preview: null,
    gate: null,
    cursor: 'c1',
    ...extra,
  }
}

export function testRound(extra: Partial<ReviewItemRound> = {}): ReviewItemRound {
  return {
    roundNumber: 1,
    fileVersionId: 'fv1',
    version: 5,
    revision: 'B',
    carriedForward: false,
    outcome: 'pending',
    decidedAt: null,
    decisions: [],
    ...extra,
  }
}

export function testItem(id: string, extra: Partial<ReviewItemDetail> = {}): ReviewItemDetail {
  return {
    id,
    fileId: `f-${id}`,
    vaultId: 'v1',
    sortOrder: 0,
    outcome: 'pending',
    addedInRound: 1,
    file: {
      fileName: `${id}.slddrw`,
      filePath: `Drawings/${id}.slddrw`,
      extension: '.slddrw',
      partNumber: null,
      description: null,
      latestVersion: 5,
      deleted: false,
    },
    version: {
      fileVersionId: `fv-${id}`,
      version: 5,
      revision: 'B',
      contentHash: 'h',
      fileSize: 1,
      state: null,
      createdAt: null,
      createdBy: null,
      referencesRecorded: true,
    },
    pdf: null,
    rounds: [testRound({ fileVersionId: `fv-${id}` })],
    ...extra,
  }
}

export function reviewer(
  user: ReviewUser,
  extra: Partial<ReviewerAssignment> = {},
): ReviewerAssignment {
  return {
    user,
    roundNumber: 1,
    status: 'pending',
    viaTeamId: null,
    respondedAt: null,
    withdrawnReason: null,
    ...extra,
  }
}

export function testDetail(
  extra: {
    review?: Partial<ReviewDetail['review']>
    items?: ReviewItemDetail[]
    reviewers?: ReviewerAssignment[]
    me?: Partial<ReviewDetail['me']>
  } = {},
): ReviewDetail {
  return {
    review: {
      id: 'r1',
      title: 'Bracket set',
      rawTitle: 'Bracket set',
      message: null,
      status: 'open',
      priority: 'normal',
      dueDate: null,
      overdue: false,
      mode: 'all',
      currentRound: 1,
      teamId: null,
      requestedBy: SAM,
      requestedAt: '2026-11-01T10:00:00Z',
      completedAt: null,
      cancelledBy: null,
      cancelledAt: null,
      cancelReason: null,
      ...extra.review,
    },
    items: extra.items ?? [testItem('a'), testItem('b', { sortOrder: 1 })],
    rounds: [
      {
        roundNumber: 1,
        openedBy: SAM.id,
        openedAt: '2026-11-01T10:00:00Z',
        note: null,
        closedAt: null,
        outcome: null,
      },
    ],
    reviewers: extra.reviewers ?? [reviewer(MEUSER), reviewer(KIM)],
    me: {
      userId: ME,
      isRequester: false,
      isReviewer: true,
      isAdmin: false,
      owedItemIds: [],
      canRespond: true,
      canCancel: false,
      canResubmit: false,
      canEditMeta: false,
      ...extra.me,
    },
  }
}
