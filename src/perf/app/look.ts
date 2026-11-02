/**
 * `window.__blueplmLook`: what `scripts/ui-look` drives inside a ui-look boot (perf build,
 * `?look=1`). It puts the app into a named scene through the store actions the UI itself calls,
 * and the runner screenshots the result. Never part of a release build.
 */
import type { usePDMStore } from '@/stores/pdmStore'

import { lookVaultAuditReport } from './lookFixtures'

type Store = typeof usePDMStore

export interface LookControl {
  /** Scene names `scene()` accepts. */
  scenes(): string[]
  /** Put the app into a scene. Throws on an unknown name. */
  scene(name: string): Promise<void>
  /** The store, for one-off setup from a runner `--eval`. */
  store: Store
}

declare global {
  interface Window {
    __blueplmLook?: LookControl
  }
}

function openVaultAudit(store: Store): void {
  store.setState({ vaultAuditOpenRequested: true })
  store.getState().openSettings('solidworks')
}

function auditRunBase(store: Store) {
  const state = store.getState()
  return {
    id: `look-run-${Date.now()}`,
    startedAt: Date.now() - 163_000,
    scope: state.vaultAuditScope,
    artifactPath: null,
    error: null,
    cancelRequested: false,
  }
}

export function installLook(store: Store): void {
  const scenes: Record<string, () => void> = {
    'vault-audit-scope': () => {
      store.getState().clearVaultAuditRun()
      openVaultAudit(store)
    },
    'vault-audit-folder': () => {
      store.getState().clearVaultAuditRun()
      store.getState().setVaultAuditScope({ kind: 'folder', folderPath: '' })
      openVaultAudit(store)
    },
    'vault-audit-running': () => {
      store.setState({
        vaultAuditRun: {
          ...auditRunBase(store),
          startedAt: Date.now() - 74_000,
          state: 'running',
          progress: { completed: 182, total: 412, message: '' },
          report: null,
        },
      })
      openVaultAudit(store)
    },
    'vault-audit-results': () => {
      const vaultPath = store.getState().vaultPath ?? 'C:\\Vault'
      store.setState({
        vaultAuditRun: {
          ...auditRunBase(store),
          state: 'complete',
          progress: { completed: 412, total: 412, message: '' },
          report: lookVaultAuditReport(vaultPath),
        },
      })
      openVaultAudit(store)
    },
  }

  window.__blueplmLook = {
    scenes: () => Object.keys(scenes),
    store,
    async scene(name) {
      const set = scenes[name]
      if (!set) throw new Error(`unknown scene "${name}"; scenes: ${Object.keys(scenes).join(', ')}`)
      set()
      // Two frames, so the scene is committed and painted before the runner screenshots it.
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    },
  }
}
