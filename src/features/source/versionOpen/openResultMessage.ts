/**
 * What the user is told after "Open with references": one toast per open, its tone and sentence.
 * Pure (apart from `t()`), so every outcome is pinned by a test.
 */

import { t } from '@/lib/i18n'
import { SW_SERVICE_VERSION_RETARGET_REFERENCES } from '@/lib/swServiceVersion'
import type { OpenVersionResult, VersionOpenProgress } from '@/lib/versionOpen'

export type OpenToastTone = 'success' | 'warning' | 'error' | 'info'

const k = (name: string) => `versionOpen.${name}`

function counted(base: 'missing' | 'conflicts' | 'retargetFailed', count: number): string | null {
  if (count <= 0) return null
  return count === 1 ? t(k(`${base}One`)) : t(k(`${base}Many`), { count })
}

/** At most this many open documents are named in the "close them first" message. */
const NAMED_DOCUMENTS = 3

function fileNameOf(path: string): string {
  return path.replace(/\\/g, '/').split('/').pop() || path
}

export function describeOpenResult(
  result: OpenVersionResult,
  file: { name: string; version: number },
): { tone: OpenToastTone; message: string } {
  const vars = { name: file.name, version: file.version }
  switch (result.status) {
    case 'opened': {
      const notes = [
        counted('missing', result.missing),
        counted('conflicts', result.conflicts),
        counted('retargetFailed', result.retargetFailed),
      ].filter((n): n is string => n !== null)
      const main = result.approximate ? t(k('openedApproximate'), vars) : t(k('opened'), vars)
      const clean = !result.approximate && notes.length === 0 && result.retargetMissing === 0
      return { tone: clean ? 'success' : 'warning', message: [main, ...notes].join(' ') }
    }
    case 'same_name_open': {
      const names = [...new Set(result.documents.map(fileNameOf))]
      const shown = names.slice(0, NAMED_DOCUMENTS).join(', ') + (names.length > NAMED_DOCUMENTS ? ', …' : '')
      return { tone: 'warning', message: t(k('sameNameOpen'), { files: shown }) }
    }
    case 'needs_service':
      return {
        tone: 'warning',
        message:
          result.reason === 'service_outdated'
            ? t(k('needsServiceOutdated'), { version: SW_SERVICE_VERSION_RETARGET_REFERENCES })
            : t(k('needsServiceOffline')),
      }
    case 'unsupported':
      return { tone: 'info', message: t(k('unsupported')) }
    case 'cancelled':
      return { tone: 'info', message: t(k('cancelled')) }
    case 'failed':
      return { tone: 'error', message: t(k('failed'), { ...vars, error: result.error }) }
  }
}

const PHASE_KEY: Record<VersionOpenProgress['phase'], string> = {
  resolving: 'progressResolving',
  checking: 'progressChecking',
  downloading: 'progressDownloading',
  retargeting: 'progressRetargeting',
  opening: 'progressOpening',
}

export function progressStatus(phase: VersionOpenProgress['phase']): string {
  return t(k(PHASE_KEY[phase]))
}
