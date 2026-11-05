/**
 * Version history: "References frozen" on a released version whose closure is exact (every child
 * is the version recorded at check-in, and the database keeps those versions). A released version
 * whose closure is approximate or reaches outside the vault says so instead. Nothing for an
 * unreleased version, and nothing while the closure is read or when it cannot be read.
 */
import { useEffect, useState } from 'react'
import { Lock } from 'lucide-react'

import { StatusText } from '@/components/core/ui'
import { t } from '@/lib/i18n'
import { log } from '@/lib/logger'
import { getFreezeStatus, type FreezeStatus } from '@/lib/versionOpen'

interface ReferencesFrozenMarkProps {
  fileVersionId: string
  released: boolean
}

export function ReferencesFrozenMark({ fileVersionId, released }: ReferencesFrozenMarkProps) {
  const [status, setStatus] = useState<FreezeStatus | null>(null)

  useEffect(() => {
    setStatus(null)
    if (!released) return
    let live = true
    getFreezeStatus(fileVersionId)
      .then((s) => {
        if (live) setStatus(s)
      })
      .catch((error: unknown) => {
        log.warn('[VersionOpen]', 'Freeze status unreadable', { fileVersionId, error: String(error) })
      })
    return () => {
      live = false
    }
  }, [fileVersionId, released])

  if (!released || !status) return null
  if (status === 'frozen') {
    return (
      <StatusText tone="success" icon={<Lock size={12} />} title={t('versionOpen.frozenTitle')}>
        {t('versionOpen.frozen')}
      </StatusText>
    )
  }
  return (
    <StatusText tone="warning" title={t(`versionOpen.${status}Title`)}>
      {t(`versionOpen.${status}`)}
    </StatusText>
  )
}
