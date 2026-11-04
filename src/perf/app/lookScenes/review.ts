/**
 * ui-look review scenes (`review-*`, `reviews-*`, `toggle-*`, `gate-*`) and the actor switch.
 *
 * Every scene starts from the same state: `reviews.reset()`, then (unless it is an empty-world
 * scene) `seedBase()`, which builds a handful of reviews through the review RPCs themselves, acting
 * as their requesters and reviewers. A scene then adds its own state the same way and puts the app
 * on the screen to look at. Data lives in lookReviewFixtures.ts, the RPCs in lookReviewModel.ts.
 *
 * To add a scene: write a function here and add it to the record `reviewScenes` returns. Build
 * review state with `request` / `decide` / `resubmit` (they call the model as the right person),
 * then call one of the `show*` helpers. Never set review state directly.
 */
import { t } from '@/lib/i18n'
import type { usePDMStore } from '@/stores/pdmStore'
import type { LocalFile } from '@/stores/types'
import type { User } from '@/types/pdm'
import type { ReviewPackageDraftItem } from '@/types/reviewPackageDraft'

import type { PerfBackend } from '../backend'
import type { LookPersonKey, LookReviews } from '../lookReviewBackend'
import {
  LOOK_REVIEW_FILE_IDS,
  LOOK_REVIEW_FILES,
  LOOK_REVIEW_FOLDER,
  LOOK_REVIEW_TEAMS,
  lookReviewPath,
  lookReviewVersionId,
} from '../lookReviewFixtures'

type Store = typeof usePDMStore
type Decision = 'approved' | 'approved_with_comments' | 'changes_requested' | 'rejected'
type TeamKey = keyof typeof LOOK_REVIEW_TEAMS

const DAY = 86_400_000
const dueIn = (days: number) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10)
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function until<T>(read: () => T | null | undefined | false, timeoutMs = 8000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = read()
    if (value) return value
    if (Date.now() > deadline) throw new Error('look: timed out waiting for the review scene')
    await sleep(50)
  }
}

/** The first visible button whose text starts with `label`. */
function buttonByText(label: string): HTMLButtonElement | null {
  const buttons = Array.from(document.querySelectorAll('button'))
  return buttons.find((b) => (b.textContent ?? '').trim().startsWith(label) && b.offsetParent !== null) ?? null
}

async function clickButton(label: string): Promise<void> {
  const button = await until(() => buttonByText(label))
  button.click()
  await sleep(300)
}

/** Type into an input the way a user does, so React's onChange runs. */
function typeInto(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

export interface ReviewLookApi {
  /** Switch the signed-in user (store, RPC actor, auth session) and deliver their notifications. */
  actAs(key: string): Promise<void>
  scenes: Record<string, () => Promise<void>>
  /** For `--eval`: the backend control (model, checkInNewVersion, renderPdf, addComment, fail, ...). */
  reviews: LookReviews
  /** Check in a new version of a review file and show it in the file list. Returns the version id. */
  checkIn(fileName: string, options?: { pdf?: boolean }): Promise<string>
  /** Review ids by scenario name from the last reset (`housing`, `impeller`, ...). */
  ids: Record<string, string>
}

export function createReviewLook(store: Store, backend: PerfBackend, reviews: LookReviews): ReviewLookApi {
  const { db } = backend
  const ids: Record<string, string> = {}
  const vaultRoot = () => store.getState().vaultPath ?? ''
  const fileId = (name: string) => LOOK_REVIEW_FILE_IDS[name]

  // A review moved a file to another state: the file list shows it.
  reviews.onFileState = (id, stateName) => {
    store.setState((s) => ({
      files: s.files.map((f) => (f.pdmData?.id === id ? { ...f, pdmData: { ...f.pdmData, state: stateName } } : f)),
    }))
  }

  // -------------------------------------------------------------------------
  // Acting as someone
  // -------------------------------------------------------------------------

  const storeUser = (userId: string): User => {
    const row = db.rows('app_user').find((u) => u.id === userId)
    if (!row) throw new Error(`look: no user ${userId}`)
    const current = store.getState().user
    return {
      ...(current ?? { custom_avatar_url: null, job_title: null, created_at: '2026-01-01T00:00:00.000Z', last_sign_in_at: null }),
      id: String(row.id),
      email: String(row.email),
      full_name: (row.full_name as string | null) ?? null,
      avatar_url: (row.avatar_url as string | null) ?? null,
      custom_avatar_url: null,
      org_id: (row.org_id as string | null) ?? null,
      role: row.role === 'admin' ? 'admin' : row.role === 'viewer' ? 'viewer' : 'engineer',
    } as User
  }

  /** The signed-in user in the store and the fake, at once. */
  const applyUser = (userId: string) => {
    reviews.setActor(userId)
    const teams = db.rows('team_member')
      .filter((m) => m.user_id === userId)
      .map((m) => db.rows('team').find((x) => x.id === m.team_id))
      .filter((x) => !!x)
      .map((x) => ({ id: String(x!.id), name: String(x!.name), color: String(x!.color), icon: String(x!.icon) }))
    store.setState({ user: storeUser(userId), userTeams: teams })
    store.getState().requestReviewQueueRefresh()
  }

  const actAs = async (key: string) => {
    const known = ['author', 'sam', 'alex', 'olive']
    if (!known.includes(key)) throw new Error(`look: unknown person "${key}"; use ${known.join(', ')}`)
    const userId = reviews.personId(key as LookPersonKey)
    applyUser(userId)
    // The notification channel resubscribes for the new user; then their unseen rows arrive.
    await until(() => db.subscribedChannels().includes(`notifications:${userId}`), 4000).catch(() => null)
    await sleep(200)
    for (const row of reviews.takeUndelivered(userId)) db.emitRealtime('notification', 'INSERT', row)
  }

  /** Run `fn` as `key` without touching the store (scene setup). */
  const as = <T>(key: LookPersonKey, fn: () => T): T => reviews.as(key, fn)

  // -------------------------------------------------------------------------
  // Building review state through the RPCs
  // -------------------------------------------------------------------------

  interface RequestSpec {
    files: Array<[string, number?]>
    reviewers?: LookPersonKey[]
    teams?: TeamKey[]
    title?: string
    message?: string
    mode?: 'all' | 'any'
    priority?: 'low' | 'normal' | 'high' | 'urgent'
    due?: number
  }

  const versionOf = (name: string, n?: number) => lookReviewVersionId(name, n ?? LOOK_REVIEW_FILES.find((f) => f.name === name)!.version)

  const request = (by: LookPersonKey, spec: RequestSpec): string =>
    as(by, () => {
      const out = reviews.model.request({
        p_file_version_ids: spec.files.map(([name, n]) => versionOf(name, n)),
        p_reviewer_ids: (spec.reviewers ?? []).map((k) => reviews.personId(k)),
        p_team_ids: (spec.teams ?? []).map((k) => LOOK_REVIEW_TEAMS[k].id),
        p_title: spec.title ?? null,
        p_message: spec.message ?? null,
        p_mode: spec.mode ?? 'all',
        p_priority: spec.priority ?? 'normal',
        p_due_date: spec.due === undefined ? null : dueIn(spec.due),
      })
      return String(out.review_id)
    })

  const itemOf = (reviewId: string, name: string) => {
    const id = reviews.model.itemIdForFile(reviewId, fileId(name))
    if (!id) throw new Error(`look: ${name} is not in review ${reviewId}`)
    return id
  }

  const decide = (by: LookPersonKey, reviewId: string, decisions: Array<[string, Decision, string?]>) =>
    as(by, () =>
      reviews.model.respond({
        p_review_id: reviewId,
        p_decisions: decisions.map(([name, decision, comment]) => ({ item_id: itemOf(reviewId, name), decision, comment: comment ?? null })),
      }),
    )

  const checkIn = async (name: string, options?: { pdf?: boolean }) => {
    const id = await reviews.checkInNewVersion(name, options)
    const row = db.rows('file').find((f) => f.id === fileId(name))
    store.setState((s) => ({
      files: s.files.map((f) =>
        f.pdmData?.id === fileId(name) && row
          ? { ...f, pdmData: { ...f.pdmData, version: Number(row.version), content_hash: String(row.content_hash) }, localHash: String(row.content_hash) }
          : f,
      ),
    }))
    return id
  }

  const resubmit = async (reviewId: string, names: string[], note: string) => {
    const versions = new Map<string, string>()
    for (const name of names) versions.set(name, await checkIn(name))
    as('author', () =>
      reviews.model.resubmit({
        p_review_id: reviewId,
        p_items: names.map((name) => ({ item_id: itemOf(reviewId, name), file_version_id: versions.get(name) })),
        p_note: note,
      }),
    )
  }

  /** The base world: open, overdue, kicked-back, approved, cancelled and orphaned reviews, and markups. */
  const seedBase = () => {
    // Olive loses the vault for a moment: her open review is left with nobody to decide (schema 108).
    ids.nobodyLeft = request('author', { files: [['PMP-2003.SLDDRW']], reviewers: ['olive'], title: 'Shaft seal drawing', due: 4 })
    reviews.setVaultAccess('olive', false)
    reviews.setVaultAccess('olive', true)

    ids.seal = request('author', { files: [['PMP-2003.SLDPRT']], reviewers: ['olive'], title: 'Seal carrier, first article' })
    decide('olive', ids.seal, [['PMP-2003.SLDPRT', 'approved_with_comments', 'Fine to release; deburr note added on the shop traveller.']])

    ids.cancelled = request('author', { files: [['PMP-2000.SLDASM']], reviewers: ['sam'], title: 'Pump assembly, first look' })
    as('author', () => reviews.model.cancel({ p_review_id: ids.cancelled, p_reason: 'Superseded by the full drawing package.' }))

    ids.kickback = request('author', { files: [['PMP-2002.SLDPRT']], reviewers: ['sam'], title: 'Impeller, balance holes', priority: 'high' })
    decide('sam', ids.kickback, [['PMP-2002.SLDPRT', 'changes_requested', 'Balance holes are on the wrong PCD: they should sit on 42 mm, not 40.']])

    ids.housing = request('author', {
      files: [['PMP-2001.SLDDRW'], ['PMP-2001.SLDPRT']],
      reviewers: ['sam', 'alex'],
      title: 'Pump housing, rev C',
      message: 'Outlet wall thickness changed; please check section A-A and the bore tolerance.',
      priority: 'high',
      due: 3,
    })
    ids.impeller = request('author', { files: [['PMP-2002.SLDDRW']], teams: ['mechanical'], mode: 'any', priority: 'urgent', due: -2, title: 'Impeller drawing' })
    ids.flange = request('sam', { files: [['PMP-2004.SLDDRW']], reviewers: ['author', 'olive'], title: 'Mounting flange', due: 0 })
    ids.pumpCheck = request('alex', { files: [['PMP-2000.SLDDRW', 3]], reviewers: ['author', 'sam'], title: 'Pump assembly drawing, interim check', priority: 'urgent', due: -1 })

    // Markups on the housing drawing, round 1: two open pins, a reply, one resolved.
    const drawing = itemOf(ids.housing, 'PMP-2001.SLDDRW')
    const first = reviews.addComment({ reviewId: ids.housing, itemId: drawing, fileName: 'PMP-2001.SLDDRW', user: 'sam', text: 'Outlet wall looks thin at section A-A. Is 2.5 mm the minimum?', at: [330, 250] })
    reviews.addComment({ reviewId: ids.housing, itemId: drawing, fileName: 'PMP-2001.SLDDRW', user: 'author', text: 'It is 2.8 mm after this change; the callout is on the section.', parentId: first })
    reviews.addComment({ reviewId: ids.housing, itemId: drawing, fileName: 'PMP-2001.SLDDRW', user: 'alex', text: 'Bore has no tolerance. H7?', at: [720, 300] })
    reviews.addComment({ reviewId: ids.housing, itemId: drawing, fileName: 'PMP-2001.SLDDRW', user: 'sam', text: 'Title block says 304; the model is 316.', at: [960, 660], resolved: true })
    reviews.addComment({ reviewId: ids.seal, itemId: itemOf(ids.seal, 'PMP-2003.SLDPRT'), fileName: 'PMP-2003.SLDPRT', user: 'olive', text: 'Deburr note added on the traveller.' })
  }

  // The review files as the vault load gave them, so every scene starts from the same rows (a scene
  // may check in a version or mark a local copy modified).
  const originalFiles = new Map<string, LocalFile>()
  const restoreFiles = () => {
    const reviewFileIds = new Set(Object.values(LOOK_REVIEW_FILE_IDS))
    const files = store.getState().files
    if (originalFiles.size === 0) {
      for (const f of files) if (f.pdmData?.id && reviewFileIds.has(f.pdmData.id)) originalFiles.set(f.path, f)
      return
    }
    store.setState({ files: files.map((f) => originalFiles.get(f.path) ?? f) })
  }

  const reset = (base = true) => {
    for (const key of Object.keys(ids)) delete ids[key]
    restoreFiles()
    reviews.reset()
    applyUser(reviews.personId('author'))
    if (base) seedBase()
    // The base world's notifications are history; only what a scene does next is announced.
    for (const key of ['author', 'sam', 'alex', 'olive'] as const) reviews.takeUndelivered(reviews.personId(key))
    // Drafts are per user and persisted: start every scene without one.
    store.setState({ reviewPackageDrafts: {}, activeReviewId: null, activeReviewItemId: null })
  }

  // -------------------------------------------------------------------------
  // Putting the app on screen
  // -------------------------------------------------------------------------

  const showExplorer = (options: { pane?: boolean; tabs?: boolean } = {}) => {
    const state = store.getState()
    state.closeSettings()
    store.setState({
      activeView: 'explorer',
      sidebarWidth: 260,
      detailsPanelVisible: false,
      rightPanelVisible: options.pane ?? true,
      rightPanelWidth: 380,
      ...(options.tabs ? {} : { rightPanelTabs: [] }),
    })
    state.setCurrentFolder(LOOK_REVIEW_FOLDER)
    if (options.pane) store.getState().setReviewPackagePaneOpen(true)
  }

  const draftItem = (name: string, n?: number): ReviewPackageDraftItem => {
    const spec = LOOK_REVIEW_FILES.find((f) => f.name === name)!
    const latest = Number(db.rows('file').find((f) => f.id === fileId(name))?.version ?? spec.version)
    const version = n ?? latest
    const row = db.rows('file_version').find((v) => v.id === lookReviewVersionId(name, version))
    return {
      fileId: fileId(name),
      fileVersionId: lookReviewVersionId(name, version),
      version,
      revision: (row?.revision as string | null) ?? spec.revision,
      state: 'In Review',
      fileName: name,
      filePath: `${LOOK_REVIEW_FOLDER}/${name}`,
      extension: spec.extension,
      vaultId: String(db.rows('file').find((f) => f.id === fileId(name))?.vault_id ?? ''),
      latestVersion: latest,
    }
  }

  interface DraftSpec {
    files: Array<[string, number?]>
    reviewers?: LookPersonKey[]
    teams?: TeamKey[]
    title?: string
    message?: string
    mode?: 'all' | 'any'
    priority?: 'low' | 'normal' | 'high' | 'urgent'
    due?: number
  }

  const setDraft = (spec: DraftSpec) => {
    const s = store.getState()
    s.clearReviewPackageDraft()
    s.addReviewPackageItems(spec.files.map(([name, n]) => draftItem(name, n)))
    for (const k of spec.reviewers ?? []) s.toggleReviewPackageReviewer(reviews.personId(k))
    for (const k of spec.teams ?? []) s.toggleReviewPackageTeam(LOOK_REVIEW_TEAMS[k].id)
    s.updateReviewPackageDraft({
      ...(spec.title !== undefined ? { title: spec.title } : {}),
      ...(spec.message !== undefined ? { message: spec.message } : {}),
      ...(spec.mode ? { mode: spec.mode } : {}),
      ...(spec.priority ? { priority: spec.priority } : {}),
      ...(spec.due !== undefined ? { dueDate: dueIn(spec.due) } : {}),
    })
  }

  const fullDraft: DraftSpec = {
    files: [['PMP-2000.SLDDRW'], ['PMP-2000.SLDASM'], ['PMP-2003.SLDDRW']],
    reviewers: ['sam', 'alex'],
    teams: ['quality'],
    title: 'Pump assembly, rev B release',
    message: 'Full drawing package for the rev B build. The seal drawing still needs its PDF.',
    priority: 'high',
    due: 5,
  }

  const select = (names: string[]) => store.getState().setSelectedFiles(names.map((n) => lookReviewPath(vaultRoot(), n)))

  /** Open the Reviews view, optionally on a review (and one of its files), with comments shown. */
  const showReviews = async (reviewId?: string, fileName?: string, bucket?: string) => {
    const state = store.getState()
    state.closeSettings()
    store.setState({ activeView: 'reviews', sidebarWidth: 340, reviewCommentsVisible: true, rightPanelVisible: false })
    state.setActiveReviewId(reviewId ?? null, reviewId && fileName ? itemOf(reviewId, fileName) : null)
    state.requestReviewQueueRefresh()
    // The queue's bucket is the sidebar's own state and outlives a scene: always choose one.
    await clickButton(t(`reviewQueue.bucket.${bucket ?? 'awaiting_me'}`))
    await sleep(600)
  }

  const openContextMenu = async (name: string) => {
    const target = await until(() =>
      Array.from(document.querySelectorAll('span, div, td'))
        .filter((el) => el.childElementCount === 0 && el.textContent?.trim().toLowerCase() === name.toLowerCase())
        .at(-1),
    )
    const box = target.getBoundingClientRect()
    target.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: box.left + 10, clientY: box.top + box.height / 2 }),
    )
    await sleep(300)
  }

  const kickBackHousing = () => {
    decide('sam', ids.housing, [
      ['PMP-2001.SLDDRW', 'changes_requested', 'Wall at A-A still reads 2.5 mm; add the 2.8 mm callout and the bore tolerance.'],
      ['PMP-2001.SLDPRT', 'approved'],
    ])
    decide('alex', ids.housing, [['PMP-2001.SLDDRW', 'approved'], ['PMP-2001.SLDPRT', 'approved']])
  }

  const housingRound2 = async () => {
    kickBackHousing()
    await resubmit(ids.housing, ['PMP-2001.SLDDRW'], 'Added the 2.8 mm callout on A-A and H7 on the bore.')
  }

  const scenes: Record<string, () => Promise<void>> = {
    // --- Flow start: the project folder, the pane in the right panel, nothing in it -------------
    'review-flow-start': async () => {
      reset()
      showExplorer({ pane: true })
    },

    // --- Builder pane (right panel) --------------------------------------------------------------
    'review-pane-empty': async () => {
      reset(false)
      showExplorer({ pane: true })
    },
    'review-pane-empty-lists': async () => {
      reset()
      showExplorer({ pane: true })
    },
    'review-pane-empty-selection': async () => {
      reset()
      showExplorer({ pane: true })
      select(['PMP-2000.SLDDRW', 'PMP-2000.SLDASM', 'PMP-2003.SLDDRW'])
    },
    'review-pane-empty-error': async () => {
      reset()
      reviews.fail(['review_list_queue', 'review_count_badge', 'review_list_open_for_files'])
      showExplorer({ pane: true })
    },
    'review-pane-draft': async () => {
      reset()
      showExplorer({ pane: true })
      setDraft(fullDraft)
    },
    'review-pane-draft-warnings': async () => {
      reset()
      showExplorer({ pane: true })
      setDraft({ files: [['PMP-2002.SLDDRW'], ['PMP-2001.SLDDRW', 2], ['PMP-2003.SLDDRW'], ['PMP-2004.SLDDRW'], ['PMP-2000.SLDDRW']], reviewers: ['sam'], teams: ['electrical'] })
      // The local copy of the pump drawing has edits that are not in any version.
      store.setState((s) => ({ files: s.files.map((f) => (f.pdmData?.id === fileId('PMP-2000.SLDDRW') ? { ...f, diffStatus: 'modified' as const } : f)) }))
    },
    'review-pane-draft-blocked': async () => {
      reset()
      showExplorer({ pane: true })
      setDraft({ files: fullDraft.files, title: fullDraft.title })
    },
    // Submit refused: Olive was named but cannot see the vault (REVIEWER_NO_VAULT_ACCESS).
    'review-pane-error': async () => {
      reset()
      reviews.setVaultAccess('olive', false)
      showExplorer({ pane: true })
      setDraft({ ...fullDraft, reviewers: ['sam', 'olive'], teams: [] })
      await clickButton(t('reviewBuilder.submit'))
    },
    // Sent, with the Quality team's only member left out (no vault access).
    'review-pane-sent': async () => {
      reset()
      reviews.setVaultAccess('olive', false)
      showExplorer({ pane: true })
      setDraft(fullDraft)
      await clickButton(t('reviewBuilder.submit'))
    },
    'review-pane-reviewer-search': async () => {
      reset()
      reviews.setVaultAccess('olive', false)
      showExplorer({ pane: true })
      setDraft({ files: fullDraft.files })
      const input = await until(() => document.querySelector<HTMLInputElement>(`input[placeholder="${t('reviewBuilder.reviewers.search')}"]`))
      input.focus()
      typeInto(input, 'o')
    },
    'review-menu': async () => {
      reset()
      showExplorer({ pane: false })
      select(['PMP-2000.SLDDRW', 'PMP-2000.SLDASM'])
      await sleep(300)
      await openContextMenu('PMP-2000.SLDDRW')
    },

    // --- The top-bar right-pane toggle in each view (hover it with --hover) ---------------------
    'toggle-explorer-tabs': async () => {
      reset()
      showExplorer({ pane: false, tabs: true })
      store.setState({ rightPanelVisible: true })
      select(['PMP-2001.SLDDRW'])
    },
    'toggle-explorer-no-tabs': async () => {
      reset()
      showExplorer({ pane: false })
      store.setState({ rightPanelVisible: true })
    },
    'toggle-reviews-none': async () => {
      reset()
      await showReviews()
    },
    'toggle-reviews-review': async () => {
      reset()
      await actAs('sam')
      await showReviews(ids.housing, 'PMP-2001.SLDDRW')
    },
    'toggle-reviews-review-builder': async () => {
      reset()
      await showReviews(ids.housing, 'PMP-2001.SLDDRW')
      setDraft({ files: [['PMP-2000.SLDDRW']] })
      store.getState().setReviewPackagePaneOpen(true)
    },
    'toggle-workflows': async () => {
      reset()
      store.getState().closeSettings()
      store.setState({ activeView: 'workflows', rightPanelVisible: true })
    },

    // --- Reviews page: queue -----------------------------------------------------------------------
    'reviews-overview': async () => {
      reset()
      await actAs('sam')
      await showReviews()
    },
    'reviews-overview-empty': async () => {
      reset(false)
      await actAs('alex')
      await showReviews()
    },
    // Awaiting the author: an urgent overdue package, one due today, and a workflow gate.
    'reviews-queue-awaiting': async () => {
      reset()
      await showReviews()
    },
    'reviews-queue-requested': async () => {
      reset()
      await showReviews(undefined, undefined, 'requested_by_me')
    },
    'reviews-queue-teams': async () => {
      reset()
      await actAs('sam')
      await showReviews(undefined, undefined, 'my_teams')
    },
    'reviews-queue-done': async () => {
      reset()
      await showReviews(undefined, undefined, 'done')
    },
    ...Object.fromEntries(
      (['awaiting_me', 'requested_by_me', 'my_teams', 'done'] as const).map((bucket) => [
        `reviews-queue-empty-${bucket.replace(/_/g, '-')}`,
        async () => {
          reset(false)
          await actAs('alex')
          await showReviews(undefined, undefined, bucket)
        },
      ]),
    ),
    'reviews-queue-error': async () => {
      reset()
      reviews.fail(['review_list_queue'])
      await showReviews()
    },
    // More than one page (50) awaiting Sam.
    'reviews-queue-load-more': async () => {
      reset()
      for (let i = 1; i <= 54; i++) {
        request('author', { files: [[i % 2 ? 'PMP-2001.SLDPRT' : 'PMP-2002.SLDPRT']], reviewers: ['sam'], title: `Batch check ${String(i).padStart(2, '0')}`, due: i % 9 })
      }
      await actAs('sam')
      await showReviews()
    },
    'reviews-bulk': async () => {
      reset()
      await actAs('sam')
      await showReviews()
      const boxes = await until(() => {
        const found = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
        return found.length >= 3 ? found : null
      })
      for (const box of boxes.slice(0, 3)) box.click()
    },

    // --- Reviews page: one review ------------------------------------------------------------------
    'review-detail-reviewer': async () => {
      reset()
      await actAs('sam')
      await showReviews(ids.housing, 'PMP-2001.SLDDRW')
    },
    'review-detail-not-owed-decided': async () => {
      reset()
      decide('sam', ids.housing, [['PMP-2001.SLDDRW', 'approved']])
      await actAs('sam')
      await showReviews(ids.housing, 'PMP-2001.SLDDRW')
    },
    'review-detail-not-owed-any': async () => {
      reset()
      decide('alex', ids.impeller, [['PMP-2002.SLDDRW', 'approved_with_comments', 'Blade fillet note is fine as drawn.']])
      await actAs('sam')
      await showReviews(ids.impeller, 'PMP-2002.SLDDRW')
    },
    'review-detail-not-owed-carried': async () => {
      reset()
      await housingRound2()
      await actAs('sam')
      await showReviews(ids.housing, 'PMP-2001.SLDPRT')
    },
    'review-detail-not-owed-reviewer': async () => {
      reset()
      await actAs('olive')
      await showReviews(ids.housing, 'PMP-2001.SLDDRW')
    },
    'review-detail-done': async () => {
      reset()
      decide('sam', ids.housing, [['PMP-2001.SLDDRW', 'approved'], ['PMP-2001.SLDPRT', 'approved']])
      await actAs('sam')
      await showReviews(ids.housing, 'PMP-2001.SLDDRW')
    },
    'review-detail-activity': async () => {
      reset()
      await housingRound2()
      await showReviews(ids.housing, 'PMP-2001.SLDDRW', 'requested_by_me')
    },
    'review-detail-author-kickback': async () => {
      reset()
      kickBackHousing()
      await showReviews(ids.housing, 'PMP-2001.SLDDRW', 'requested_by_me')
    },
    'review-detail-rejected': async () => {
      reset()
      ids.rejected = request('author', { files: [['PMP-2003.SLDDRW']], reviewers: ['alex'], title: 'Seal drawing, alternative' })
      decide('alex', ids.rejected, [['PMP-2003.SLDDRW', 'rejected', 'We are keeping the lip seal; this variant is not needed.']])
      await showReviews(ids.rejected, 'PMP-2003.SLDDRW', 'done')
    },
    'review-resubmit': async () => {
      reset()
      kickBackHousing()
      await checkIn('PMP-2001.SLDDRW')
      await showReviews(ids.housing, 'PMP-2001.SLDDRW', 'requested_by_me')
      await clickButton(t('reviewDetail.resubmit.button'))
    },
    'review-resubmit-missing-pdf': async () => {
      reset()
      kickBackHousing()
      await checkIn('PMP-2001.SLDDRW', { pdf: false })
      await showReviews(ids.housing, 'PMP-2001.SLDDRW', 'requested_by_me')
      await clickButton(t('reviewDetail.resubmit.button'))
    },
    'review-resubmit-no-newer': async () => {
      reset()
      kickBackHousing()
      await showReviews(ids.housing, 'PMP-2001.SLDDRW', 'requested_by_me')
      await clickButton(t('reviewDetail.resubmit.button'))
    },
    'review-detail-round2': async () => {
      reset()
      await housingRound2()
      await actAs('sam')
      await showReviews(ids.housing, 'PMP-2001.SLDDRW')
    },
    // `all` mode, partly decided: Sam approved both files, Alex has not decided yet.
    'review-detail-partial': async () => {
      reset()
      decide('sam', ids.housing, [['PMP-2001.SLDDRW', 'approved'], ['PMP-2001.SLDPRT', 'approved']])
      await showReviews(ids.housing, 'PMP-2001.SLDDRW', 'requested_by_me')
    },
    // Approved, files still in the review stage: the requester moves the package (hold).
    'review-detail-approved-hold': async () => {
      reset()
      await showReviews(ids.seal, 'PMP-2003.SLDPRT', 'done')
    },
    'review-detail-approved-advance': async () => {
      reset()
      const org = db.rows('organization')[0]
      org.settings = { ...((org.settings as Record<string, unknown> | null) ?? {}), review_stage_on_approval: 'advance' }
      ids.advanced = request('author', { files: [['PMP-2002.SLDDRW']], reviewers: ['alex'], title: 'Impeller drawing, final' })
      decide('alex', ids.advanced, [['PMP-2002.SLDDRW', 'approved']])
      await showReviews(ids.advanced, 'PMP-2002.SLDDRW', 'done')
    },
    'review-detail-released': async () => {
      reset()
      as('author', () => reviews.model.advanceFiles({ p_review_id: ids.seal, p_only_approved: false }))
      await showReviews(ids.seal, 'PMP-2003.SLDPRT', 'done')
    },
    'review-detail-cancelled': async () => {
      reset()
      await showReviews(ids.cancelled, 'PMP-2000.SLDASM', 'done')
    },
    'review-detail-nobody-left': async () => {
      reset()
      await showReviews(ids.nobodyLeft, 'PMP-2003.SLDDRW', 'requested_by_me')
    },
    'review-detail-pdf-pending': async () => {
      reset()
      ids.pending = request('author', { files: [['PMP-2003.SLDDRW']], reviewers: ['sam'], title: 'Seal drawing' })
      await actAs('sam')
      await showReviews(ids.pending, 'PMP-2003.SLDDRW')
    },
    'review-detail-unsupported': async () => {
      reset()
      await actAs('sam')
      await showReviews(ids.housing, 'PMP-2001.SLDPRT')
    },
    // A recorded PDF whose bytes are not in the bucket: the download fails.
    'review-detail-preview-error': async () => {
      reset()
      db.seed('drawing_pdf_render', {
        file_id: fileId('PMP-2003.SLDDRW'), file_version_id: lookReviewVersionId('PMP-2003.SLDDRW', 1), org_id: String(db.rows('organization')[0].id),
        storage_hash: 'e'.repeat(64), file_size: 1000, is_closure_exact: true, generated_by: reviews.personId('author'), generated_at: new Date().toISOString(),
      })
      ids.broken = request('author', { files: [['PMP-2003.SLDDRW']], reviewers: ['sam'], title: 'Seal drawing' })
      await actAs('sam')
      await showReviews(ids.broken, 'PMP-2003.SLDDRW')
    },
    'review-detail-error': async () => {
      reset()
      reviews.fail(['review_get_detail'])
      await actAs('sam')
      await showReviews(ids.housing)
    },
    'review-detail-not-found': async () => {
      reset()
      await actAs('sam')
      await showReviews()
      store.getState().setActiveReviewId('00000000-0000-4000-8000-0000dead0001')
    },

    // --- Comments ----------------------------------------------------------------------------------
    'review-comments-empty': async () => {
      reset()
      await actAs('sam')
      await showReviews(ids.impeller, 'PMP-2002.SLDDRW')
    },
    'review-comments-threads': async () => {
      reset()
      await actAs('sam')
      await showReviews(ids.housing, 'PMP-2001.SLDDRW')
    },
    'review-comments-readonly-closed': async () => {
      reset()
      await showReviews(ids.seal, 'PMP-2003.SLDPRT', 'done')
    },
    'review-comments-load-error': async () => {
      reset()
      await actAs('sam')
      db.failNext('file_comment', 'select', { message: 'The server is unavailable (look scene)', code: '08006' })
      await showReviews(ids.housing, 'PMP-2001.SLDDRW')
    },

    // --- Gate reviews, dialogs, notifications ------------------------------------------------------
    'review-dialogs': async () => {
      reset()
      await showReviews(ids.housing, 'PMP-2001.SLDDRW', 'requested_by_me')
    },
    // The author sent a package; Sam signs in and gets the notification toast and the badge.
    'review-notifications': async () => {
      reset()
      request('author', { files: [['PMP-2000.SLDDRW']], reviewers: ['sam'], title: 'Pump assembly drawing, rev B', priority: 'high', due: 2 })
      showExplorer({ pane: false })
      await actAs('sam')
    },
  }

  return { actAs, scenes, reviews, checkIn, ids }
}
