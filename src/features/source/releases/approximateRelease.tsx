/**
 * Before a release (gap 12 c): when assemblies or drawings being released are at versions whose
 * references are approximate (checked in before exact reference tracking), the release would not
 * freeze them, so the user is asked first. Resolves true to go on (nothing to warn about, or
 * "Release anyway"), false on cancel.
 *
 * Like the forced-release warning, the dialog opens in its own React root on `document.body`: the
 * context menu that asked for it closes as soon as an item is clicked.
 */
import { createRoot } from 'react-dom/client'

import { findApproximateReleases, type ApproximateRelease } from '@/lib/versionOpen'
import type { LocalFile } from '@/stores/types'

import { ApproximateReleaseDialog } from './ApproximateReleaseDialog'

function askAboutApproximateReleases(files: readonly ApproximateRelease[]): Promise<boolean> {
  return new Promise((resolve) => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    let settled = false
    const finish = (go: boolean) => {
      if (settled) return
      settled = true
      // Unmounting from inside this root's own event handler is deferred, as React requires.
      setTimeout(() => {
        root.unmount()
        host.remove()
      }, 0)
      resolve(go)
    }
    root.render(
      <ApproximateReleaseDialog files={files} onCancel={() => finish(false)} onConfirm={() => finish(true)} />,
    )
  })
}

/** Check the files about to be released and, when some would not freeze, ask. */
export async function confirmApproximateReleases(files: readonly LocalFile[]): Promise<boolean> {
  const candidates = files
    .filter((f) => !f.isDirectory && f.pdmData?.id)
    .map((f) => ({ name: f.name, fileId: f.pdmData!.id, version: f.pdmData?.version ?? null }))
  const approximate = await findApproximateReleases(candidates)
  if (approximate.length === 0) return true
  return askAboutApproximateReleases(approximate)
}
