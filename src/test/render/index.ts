/**
 * What a whole-component render test needs on top of the integration harness (harness.ts).
 *
 * The harness fakes only the electron and service calls the metadata paths make. A pane, a panel
 * or the app shell reaches for many more on mount (watchers, platform, menu events, thumbnails),
 * none of which decide what a test asserts. `lenientElectron` answers those with an inert reply so
 * the component mounts, and keeps a list of them so a test can see what was not modelled. Calls
 * the harness does model still go to the fake.
 *
 * `signedInVault` puts the store in the state the app is in after sign-in and a finished vault
 * load: a connected vault, files loaded, the explorer permissions an engineer holds.
 */
import { vi } from 'vitest'

import { usePDMStore } from '@/stores/pdmStore'
import type { LocalFile } from '@/stores/types'

import { OTHER_USER_ID, VAULT_ID, VAULT_PATH, type Harness } from '../harness'

export const OTHER_USER = {
  id: OTHER_USER_ID,
  email: 'olive@example.com',
  full_name: 'Olive Other',
  avatar_url: null,
}

/** A member that is a function the fake does not implement. */
function inert(name: string): (...args: unknown[]) => unknown {
  // `onX` subscriptions return their unsubscribe; everything else is an IPC call that failed.
  if (/^on[A-Z]/.test(name)) return () => () => {}
  return async () => ({ success: false, error: `${name}: not modelled by the render kit` })
}

/**
 * Wrap `window.electronAPI` so members the fake lacks answer inertly instead of being undefined.
 * Returns the set of members that were answered this way.
 */
export function lenientElectron(h: Harness): Set<string> {
  const unmodelled = new Set<string>()
  const wrap = <T extends object>(target: T, prefix: string): T =>
    new Proxy(target, {
      get(obj, prop, receiver) {
        if (typeof prop !== 'string' || prop === 'then') return Reflect.get(obj, prop, receiver)
        // Read through the raw object first, so the fake's `missing` record stays about the
        // calls the metadata paths make, not about what a mount happens to probe.
        const own = Reflect.has(obj, prop) ? Reflect.get(obj, prop, receiver) : undefined
        if (own !== undefined) {
          return prop === 'solidworks' && typeof own === 'object' ? wrap(own as object, 'solidworks.') : own
        }
        unmodelled.add(`${prefix}${prop}`)
        return inert(prop)
      },
    })
  Object.defineProperty(window, 'electronAPI', {
    value: wrap(h.electron.api as object, ''),
    configurable: true,
    writable: true,
  })
  return unmodelled
}

/** The browser APIs jsdom leaves out that the shell and panes touch on mount. */
export function installDomShims(): void {
  if (!window.matchMedia) {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }))
  }
  if (typeof ResizeObserver === 'undefined') {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
  }
  if (typeof IntersectionObserver === 'undefined') {
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
        takeRecords() {
          return []
        }
      },
    )
  }
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {}
  setViewport(VIEWPORT.width, VIEWPORT.height)
}

const VIEWPORT = { width: 1600, height: 1200 }

/**
 * The size every element reports. jsdom does no layout, so each element is 0 x 0 and a windowed
 * list (`@tanstack/react-virtual` reads the scroll element's offsetHeight) renders no rows at all.
 * Every element reports the viewport instead: the list then renders the rows that fit in it, as
 * it would on screen.
 */
export function setViewport(width: number, height: number): void {
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => width })
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => height })
}

/** Signed in, one vault connected and loaded, explorer permissions of an engineer. */
export function signedInVault(): void {
  usePDMStore.setState({
    connectedVaults: [
      { id: VAULT_ID, name: 'Test Vault', localPath: VAULT_PATH, isExpanded: true, hasCompletedSetup: true },
    ],
    filesLoaded: true,
    isLoading: false,
    currentFolder: '',
    viewMode: 'list',
    userPermissions: { 'module:explorer': ['view', 'create', 'edit', 'delete'] },
  })
}

/** Attach the owner's profile to a file someone else holds, as checkout hydration does. */
export function hydrateOtherCheckout(relativePath: string): void {
  usePDMStore.setState((s) => ({
    files: s.files.map((f) =>
      f.relativePath === relativePath && f.pdmData
        ? { ...f, pdmData: { ...f.pdmData, checked_out_user: OTHER_USER } }
        : f,
    ),
  }))
}

/**
 * `count` committed files in `folder`, each a copy of `template` with its own path, id and
 * metadata. For the size tests: a seeded row per file would be the harness's job, not the
 * component's, and costs seconds.
 */
export function bulkFiles(template: LocalFile, count: number, folder = 'Bulk'): LocalFile[] {
  const files: LocalFile[] = []
  for (let i = 0; i < count; i++) {
    const n = String(i).padStart(4, '0')
    const relativePath = `${folder}/part-${n}${template.extension}`
    files.push({
      ...template,
      name: `part-${n}${template.extension}`,
      relativePath,
      path: `${VAULT_PATH}\\${relativePath.replace(/\//g, '\\')}`,
      pendingMetadata: undefined,
      diffStatus: undefined,
      pdmData: template.pdmData
        ? {
            ...template.pdmData,
            id: `bulk-${n}`,
            file_path: relativePath,
            file_name: `part-${n}${template.extension}`,
            part_number: `BULK-${n}`,
            description: `Bulk part ${n}`,
            checked_out_by: null,
          }
        : undefined,
    })
  }
  files.push({
    name: folder,
    path: `${VAULT_PATH}\\${folder}`,
    relativePath: folder,
    isDirectory: true,
    extension: '',
    size: 0,
    modifiedTime: template.modifiedTime,
  })
  return files
}
