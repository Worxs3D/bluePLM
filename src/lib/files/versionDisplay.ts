import type { LocalFile } from '@/stores/types'

export type VersionDisplayKind = 'none' | 'rolledBack' | 'modified' | 'moved' | 'outdated' | 'synced'

export interface VersionDisplay {
  kind: VersionDisplayKind
  /** The "local/server" label, e.g. "3/2" for a file edited on top of version 2. */
  text: string
  serverVersion: number | null
  /** The version on disk, where the label shows one that differs from the server's. */
  localVersion?: number
}

/** The version label the file browser shows for a file (VersionHistoryDropdown). */
export function describeVersion(
  file: Pick<LocalFile, 'isDirectory' | 'pdmData' | 'diffStatus' | 'localVersion' | 'localActiveVersion'>,
): VersionDisplay {
  const serverVersion = file.pdmData?.version || null
  if (file.isDirectory || !serverVersion) {
    return { kind: 'none', text: '-/-', serverVersion }
  }
  if (file.localActiveVersion !== undefined && file.localActiveVersion !== serverVersion) {
    return {
      kind: 'rolledBack',
      text: `${file.localActiveVersion}/${serverVersion}`,
      serverVersion,
      localVersion: file.localActiveVersion,
    }
  }
  if (file.diffStatus === 'modified') {
    return { kind: 'modified', text: `${serverVersion + 1}/${serverVersion}`, serverVersion }
  }
  if (file.diffStatus === 'moved') {
    return { kind: 'moved', text: `${serverVersion}/${serverVersion}`, serverVersion }
  }
  if (file.diffStatus === 'outdated') {
    return {
      kind: 'outdated',
      text: `${file.localVersion ?? '?'}/${serverVersion}`,
      serverVersion,
      localVersion: file.localVersion,
    }
  }
  return { kind: 'synced', text: `${serverVersion}/${serverVersion}`, serverVersion }
}
