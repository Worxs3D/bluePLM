/**
 * Physical copies of a version output: ordinary local files the user asked for. Checking one in
 * is the user's choice; nothing here records or tracks it.
 *
 * Both download through a signed URL. On the desktop the main process writes the file and checks
 * it against the output's hash (`downloadUrl`), so a copy is never a damaged object; BluePLM Web
 * hands the signed URL to the browser's download.
 */

import { saveUrlAs } from '@/lib/browserDownload'
import { hasDesktop } from '@/lib/platform'
import { getDownloadUrl } from '@/lib/storage'
import type { VersionOutput } from '@/types/versionOutputs'

import { outputExtension } from './kinds'

export type SaveOutputCopyResult =
  | { status: 'saved'; path: string }
  | { status: 'downloaded' }
  | { status: 'canceled' }

export type SaveNextToSourceResult =
  | { status: 'saved'; path: string }
  /** A file with the same name and the same content is already there. */
  | { status: 'exists'; path: string }
  /** A different file with that name is there; pass `overwrite` to replace it. */
  | { status: 'conflict'; path: string }

function dirOf(path: string): string {
  const i = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'))
  return i > 0 ? path.slice(0, i) : path
}

/** `dir` + `name` with the folder's own separator. */
export function siblingPath(sourcePath: string, name: string): string {
  const sep = sourcePath.includes('\\') ? '\\' : '/'
  return `${dirOf(sourcePath)}${sep}${name}`
}

async function signedUrl(orgId: string, output: VersionOutput, fileName?: string): Promise<string> {
  const { url, error } = await getDownloadUrl(
    orgId,
    output.storageHash,
    3600,
    fileName ? { downloadName: fileName } : {},
  )
  if (!url) throw new Error(error ?? 'No download URL for the output')
  return url
}

export type OpenOutputResult = { status: 'opened'; path: string } | { status: 'downloaded' }

/**
 * Open an output: the desktop downloads it into a temp folder of its own (checked against the
 * hash) and opens it in the default app; the web downloads it. Throws on failure.
 */
export async function openVersionOutput(
  orgId: string,
  output: VersionOutput,
  fileName: string,
): Promise<OpenOutputResult> {
  const api = hasDesktop() ? window.electronAPI : undefined
  if (!api) {
    saveUrlAs(await signedUrl(orgId, output, fileName), fileName)
    return { status: 'downloaded' }
  }
  const opened = await api.versionOutputs.open(await signedUrl(orgId, output), fileName, output.storageHash)
  if (!opened.success || !opened.path) throw new Error(opened.error ?? 'Could not open the output')
  return { status: 'opened', path: opened.path }
}

/**
 * Save a copy of an output where the user chooses (desktop: the native Save dialog, starting
 * with `fileName`) or download it (web). Throws on failure.
 */
export async function saveOutputCopy(
  orgId: string,
  output: VersionOutput,
  fileName: string,
): Promise<SaveOutputCopyResult> {
  const api = hasDesktop() ? window.electronAPI : undefined
  if (!api) {
    saveUrlAs(await signedUrl(orgId, output, fileName), fileName)
    return { status: 'downloaded' }
  }
  const ext = outputExtension(output.kind)
  const chosen = await api.showSaveDialog(fileName, [
    { name: ext.toUpperCase(), extensions: [ext] },
    { name: 'All Files', extensions: ['*'] },
  ])
  if (chosen.canceled || !chosen.path) {
    if (chosen.canceled || chosen.success) return { status: 'canceled' }
    throw new Error(chosen.error ?? 'Could not choose where to save')
  }
  const written = await api.downloadUrl(await signedUrl(orgId, output), chosen.path, output.storageHash)
  if (!written.success) throw new Error(written.error ?? 'Could not save the output')
  return { status: 'saved', path: chosen.path }
}

/**
 * Save a copy of an output in the source file's folder under `fileName` (desktop only; the
 * folder is the source's local path). An identical file already there is left alone (`exists`);
 * a different one is replaced only with `overwrite`. Throws on failure or on the web.
 */
export async function saveOutputNextToSource(
  orgId: string,
  output: VersionOutput,
  sourceLocalPath: string,
  fileName: string,
  options: { overwrite?: boolean } = {},
): Promise<SaveNextToSourceResult> {
  const api = hasDesktop() ? window.electronAPI : undefined
  if (!api) throw new Error('Saving next to the file needs the desktop app')
  if (/[\\/]/.test(fileName)) throw new Error('The file name must not contain a folder')
  const target = siblingPath(sourceLocalPath, fileName)
  if (await api.fileExists(target)) {
    const hashed = await api.hashFile(target)
    if (hashed.success && hashed.hash === output.storageHash) return { status: 'exists', path: target }
    if (!options.overwrite) return { status: 'conflict', path: target }
  }
  const written = await api.downloadUrl(await signedUrl(orgId, output), target, output.storageHash)
  if (!written.success) throw new Error(written.error ?? 'Could not save the output')
  return { status: 'saved', path: target }
}
