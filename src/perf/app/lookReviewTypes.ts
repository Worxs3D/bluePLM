/**
 * Types and small helpers of the ui-look review model (lookReviewModel.ts): the world it reads,
 * its rows, and the refusal it throws. Never part of a release build.
 */

/** A refusal shaped like `RAISE ... USING ERRCODE, HINT, DETAIL`; the backend turns it into `{ error }`. */
export class ReviewRefusal extends Error {
  constructor(
    message: string,
    readonly sqlState: string,
    readonly hint?: string,
    readonly details?: string,
  ) {
    super(message)
  }
}

export const PRIVILEGE = '42501'
export const PARAMETER = '22023'
export const PREREQUISITE = '55000'

export const refuse = (message: string, sqlState: string, hint?: string, details?: string): never => {
  throw new ReviewRefusal(message, sqlState, hint, details)
}

export type ReviewStatus = 'pending' | 'kicked_back' | 'approved' | 'rejected' | 'cancelled'
export type ItemOutcome = 'pending' | 'approved' | 'changes_requested' | 'rejected'
export type Decision = 'approved' | 'approved_with_comments' | 'changes_requested' | 'rejected'
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
export type JsonObject = { [key: string]: Json }

export interface WorldUser {
  id: string
  email: string
  fullName: string | null
  avatarUrl: string | null
  orgId: string | null
  admin: boolean
}

export interface WorldFile {
  id: string
  orgId: string
  vaultId: string | null
  fileName: string
  filePath: string
  extension: string | null
  partNumber: string | null
  description: string | null
  version: number
  revision: string | null
  deleted: boolean
  checkedOutBy: string | null
}

export interface WorldVersion {
  id: string
  fileId: string
  version: number
  revision: string | null
  contentHash: string
  fileSize: number
  state: string | null
  createdAt: string | null
  createdBy: string | null
  referencesRecorded: boolean
}

export interface WorldPdf {
  fileVersionId: string
  fileId: string
  storageHash: string
  fileSize: number
  closureExact: boolean | null
  generatedBy: string | null
  generatedAt: string
}

export interface WorkflowState {
  id: string
  name: string
  color: string
  isReviewStage: boolean
  reviewApprovedStateId: string | null
  checkoutRequired: boolean
}

export interface WorkflowTransition {
  id: string
  name: string
  fromStateId: string
  toStateId: string
  blockingGate: boolean
}

/** A workflow gate review (`workflow_gate_review`) the awaiting_me bucket lists beside packages. */
export interface GateReview {
  id: string
  orgId: string
  fileId: string
  gateId: string
  gateName: string
  gateType: string | null
  transitionId: string
  requestedBy: string
  requestedAt: string
  reviewerIds: string[]
  checklistItems: Json
  decided: string | null
}

/** What the review RPCs read from outside the review tables. */
export interface ReviewWorld {
  actorId(): string | null
  user(id: string | null): WorldUser | null
  usersOfOrg(orgId: string): WorldUser[]
  canAccessVault(userId: string, vaultId: string | null): boolean
  file(id: string): WorldFile | null
  version(id: string): WorldVersion | null
  pdf(fileVersionId: string): WorldPdf | null
  teamOrg(teamId: string): string | null
  teamReviewerIds(teamId: string): string[]
  teamsOfUser(userId: string): string[]
  orgSettings(orgId: string): Record<string, unknown>
  notify(row: { orgId: string; userId: string; type: string; title: string; message: string; reviewId: string; priority: string; fromUserId: string | null }): void
  /** Move a file to a workflow state, as `workflow_transition_apply` does. */
  applyTransition(fileId: string, transition: WorkflowTransition): void
  now(): string
  uuid(): string
}

export interface ReviewRow {
  id: string
  orgId: string
  vaultId: string | null
  requestedBy: string
  requestedAt: string
  title: string | null
  message: string | null
  status: ReviewStatus
  dueDate: string | null
  priority: string
  teamId: string | null
  mode: 'all' | 'any'
  currentRound: number
  completedAt: string | null
  cancelledBy: string | null
  cancelledAt: string | null
  cancelReason: string | null
  createdAt: string
  updatedAt: string
}

export interface ItemRow {
  id: string
  reviewId: string
  fileId: string
  vaultId: string | null
  fileVersionId: string
  sortOrder: number
  addedInRound: number
  outcome: ItemOutcome
  advancedAt: string | null
  advancedToStateId: string | null
}

export interface RoundRow {
  reviewId: string
  roundNumber: number
  openedBy: string | null
  openedAt: string
  note: string | null
  closedAt: string | null
  outcome: string | null
}

export interface RoundItemRow {
  reviewId: string
  itemId: string
  roundNumber: number
  fileVersionId: string
  isCarriedForward: boolean
  outcome: ItemOutcome
  decidedAt: string | null
}

export interface ResponseRow {
  reviewId: string
  roundNumber: number
  reviewerId: string
  viaTeamId: string | null
  status: ReviewStatus
  respondedAt: string | null
  withdrawnAt: string | null
  withdrawnReason: string | null
  createdAt: string
  seq: number
}

export interface DecisionRow {
  id: string
  reviewId: string
  itemId: string
  roundNumber: number
  reviewerId: string
  decision: Decision
  comment: string | null
  decidedAt: string
  legacy: boolean
  seq: number
}

export const DECISIONS: readonly Decision[] = ['approved', 'approved_with_comments', 'changes_requested', 'rejected']
export const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 }

export const statusLabel = (s: ReviewStatus): string => (s === 'pending' ? 'open' : s === 'kicked_back' ? 'changes_requested' : s)
export const trimmed = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null)
export const uuidArray = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

/** `to_char(ts AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISSUS')` */
export function sortStamp(iso: string): string {
  const d = new Date(iso)
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}${p(d.getUTCMilliseconds(), 3)}000`
}

