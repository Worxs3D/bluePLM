/**
 * Which organization's native extensions run, and when the cache is pruned.
 *
 * Every request (activate for an org, refresh, sign-out) takes a generation
 * number and runs on one serial chain together with the fetch and the loader
 * sync. A request that has been overtaken by a newer one does nothing when its
 * turn comes, and a fetch that finishes after a newer request started is
 * dropped, so a slow fetch for org A can never activate A's extensions after a
 * switch to org B or a sign-out.
 *
 * Switching org deactivates everything first: an extension must not stay active
 * across orgs just because both orgs installed the same package.
 *
 * The desktop cache is pruned only after a successful fetch of the current
 * org's rows, keeping every package that org references. Sign-out never prunes:
 * it says nothing about which packages the next session will need.
 */

import type { OrgNativeExtensionRow } from '@/types/nativeExtensions'

export interface SessionDeps {
  fetchRows(orgId: string): Promise<OrgNativeExtensionRow[]>
  sync(rows: readonly OrgNativeExtensionRow[]): Promise<void>
  deactivateAll(): Promise<void>
  setRows(rows: OrgNativeExtensionRow[]): void
  prune(keepShas: string[]): Promise<void>
  onError(error: unknown): void
}

export class NativeExtensionSession {
  private generation = 0
  private chain: Promise<void> = Promise.resolve()
  private currentOrg: string | null = null

  constructor(private readonly deps: SessionDeps) {}

  /** The org whose extensions are (being) run, or null. */
  get orgId(): string | null {
    return this.currentOrg
  }

  /**
   * Run the org's enabled native extensions (sign-in, org switch, a settings
   * change, a realtime notice). Resolves when this request has been handled or
   * skipped because a newer one overtook it.
   */
  activate(orgId: string): Promise<void> {
    const generation = ++this.generation
    return this.enqueue(async () => {
      if (generation !== this.generation) return
      if (this.currentOrg !== orgId) {
        await this.deps.deactivateAll()
        this.deps.setRows([])
        this.currentOrg = orgId
      }
      const rows = await this.deps.fetchRows(orgId)
      if (generation !== this.generation) return
      this.deps.setRows(rows)
      await this.deps.sync(rows)
      if (generation !== this.generation) return
      await this.deps.prune(rows.map((row) => row.sha256))
    })
  }

  /** Sign-out (or no org): stop everything. Never prunes. */
  deactivate(): Promise<void> {
    const generation = ++this.generation
    return this.enqueue(async () => {
      if (generation !== this.generation) return
      this.currentOrg = null
      this.deps.setRows([])
      await this.deps.deactivateAll()
    })
  }

  private enqueue(work: () => Promise<void>): Promise<void> {
    const run = this.chain.then(work).catch((error: unknown) => this.deps.onError(error))
    this.chain = run
    return run
  }
}
