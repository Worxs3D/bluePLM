import { describe, expect, it, vi } from 'vitest'

import { NativeExtensionLoader, type LoaderDeps } from './loader'
import type {
  Disposable,
  NativeExtensionHost,
  NativeExtensionRuntimeState,
  OrgNativeExtensionRow,
} from '@/types/nativeExtensions'

function row(overrides: Partial<OrgNativeExtensionRow> = {}): OrgNativeExtensionRow {
  return {
    orgId: 'org-1',
    extensionId: 'acme.tool',
    version: '1.0.0',
    enabled: true,
    sha256: 'a'.repeat(64),
    packagePath: 'org-1/acme.tool/1.0.0-aaa.bpx',
    manifest: { id: 'acme.tool', name: 'Tool', version: '1.0.0' },
    installedAt: null,
    ...overrides,
  }
}

/** A fake world: modules by URL, states and disposals recorded. */
function harness(modules: Record<string, unknown>) {
  const states = new Map<string, NativeExtensionRuntimeState>()
  const disposed: string[] = []
  const cleared: string[] = []
  const pruned: string[][] = []
  const deps: LoaderDeps = {
    prepare: vi.fn(async (r: OrgNativeExtensionRow) => ({
      clientEntryUrl: `blueplm-ext://${r.sha256}/client/index.js`,
      manifest: r.manifest,
    })),
    importModule: vi.fn(async (url: string) => {
      if (!(url in modules)) throw new Error(`no module at ${url}`)
      return modules[url]
    }),
    createHost: (context) => {
      const host = {
        extension: { id: context.extensionId },
        registerWorkspace: () => {
          const d: Disposable = { dispose: () => disposed.push(context.extensionId) }
          context.track(d)
          return d
        },
      }
      return host as unknown as NativeExtensionHost
    },
    setState: (s) => states.set(s.extensionId, s),
    removeState: (id) => states.delete(id),
    clearRegistrations: (id) => cleared.push(id),
    prune: async (keep) => {
      pruned.push(keep)
    },
  }
  return { deps, states, disposed, cleared, pruned }
}

const urlFor = (sha: string) => `blueplm-ext://${sha}/client/index.js`

describe('NativeExtensionLoader', () => {
  it('activates enabled rows and prunes the cache to the org rows', async () => {
    const activate = vi.fn((host: NativeExtensionHost) => {
      host.registerWorkspace({ id: 'tool', title: 'Tool', icon: 'Box', Workspace: () => null })
    })
    const h = harness({ [urlFor('a'.repeat(64))]: { activate } })
    const loader = new NativeExtensionLoader(h.deps)

    await loader.sync([row(), row({ extensionId: 'acme.off', enabled: false, sha256: 'b'.repeat(64) })])

    expect(activate).toHaveBeenCalledTimes(1)
    expect(h.states.get('acme.tool')?.status).toBe('active')
    expect(h.states.get('acme.off')?.status).toBe('disabled')
    expect(h.pruned.at(-1)).toEqual(['a'.repeat(64), 'b'.repeat(64)])
    expect(loader.activeIds()).toEqual(['acme.tool'])
  })

  it('deactivates and disposes registrations when a row is disabled', async () => {
    const deactivate = vi.fn()
    const h = harness({
      [urlFor('a'.repeat(64))]: {
        activate: (host: NativeExtensionHost) =>
          host.registerWorkspace({ id: 'tool', title: 'Tool', icon: 'Box', Workspace: () => null }),
        deactivate,
      },
    })
    const loader = new NativeExtensionLoader(h.deps)
    await loader.sync([row()])
    await loader.sync([row({ enabled: false })])

    expect(deactivate).toHaveBeenCalledTimes(1)
    expect(h.disposed).toEqual(['acme.tool'])
    expect(h.cleared).toContain('acme.tool')
    expect(h.states.get('acme.tool')?.status).toBe('disabled')
    expect(loader.activeIds()).toEqual([])
  })

  it('reloads when the installed package changes and forgets uninstalled rows', async () => {
    const first = { activate: vi.fn(), deactivate: vi.fn() }
    const second = { activate: vi.fn() }
    const h = harness({ [urlFor('a'.repeat(64))]: first, [urlFor('c'.repeat(64))]: second })
    const loader = new NativeExtensionLoader(h.deps)

    await loader.sync([row()])
    await loader.sync([row({ version: '1.1.0', sha256: 'c'.repeat(64) })])
    expect(first.deactivate).toHaveBeenCalledTimes(1)
    expect(second.activate).toHaveBeenCalledTimes(1)

    await loader.sync([])
    expect(h.states.has('acme.tool')).toBe(false)
    expect(loader.activeIds()).toEqual([])
  })

  it('records an activation failure without throwing, and cleans up', async () => {
    const h = harness({
      [urlFor('a'.repeat(64))]: {
        activate: (host: NativeExtensionHost) => {
          host.registerWorkspace({ id: 'tool', title: 'Tool', icon: 'Box', Workspace: () => null })
          throw new Error('boom')
        },
      },
    })
    const loader = new NativeExtensionLoader(h.deps)
    await expect(loader.sync([row()])).resolves.toBeUndefined()
    expect(h.states.get('acme.tool')).toMatchObject({ status: 'error', error: 'boom' })
    expect(h.disposed).toEqual(['acme.tool'])
    expect(loader.activeIds()).toEqual([])
  })

  it('records a module without activate() as an error', async () => {
    const h = harness({ [urlFor('a'.repeat(64))]: { notActivate: true } })
    await new NativeExtensionLoader(h.deps).sync([row()])
    expect(h.states.get('acme.tool')?.error).toMatch(/activate/)
  })

  it('records a prepare failure (for example a SHA-256 mismatch)', async () => {
    const h = harness({})
    h.deps.prepare = vi.fn(async () => {
      throw new Error('does not match the SHA-256 recorded at install')
    })
    await new NativeExtensionLoader(h.deps).sync([row()])
    expect(h.states.get('acme.tool')?.error).toMatch(/SHA-256/)
    expect(h.deps.importModule).not.toHaveBeenCalled()
  })
})
