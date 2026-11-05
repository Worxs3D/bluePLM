/**
 * "Open with references" on one row of version history (desktop only): the version and the exact
 * versions it references, staged read-only in the version cache and opened in SOLIDWORKS.
 */
import { useState } from 'react'
import { ExternalLink, Loader2 } from 'lucide-react'

import { IconButton } from '@/components/core/ui'
import { t } from '@/lib/i18n'
import { hasDesktop } from '@/lib/platform'
import { isOpenableWithReferences } from '@/lib/versionOpen'

import { openWithReferences } from './openWithReferences'

interface OpenWithReferencesButtonProps {
  fileName: string
  version: { id: string; version: number }
}

export function OpenWithReferencesButton({ fileName, version }: OpenWithReferencesButtonProps) {
  const [busy, setBusy] = useState(false)
  if (!hasDesktop() || !isOpenableWithReferences(fileName)) return null

  const label = busy
    ? t('versionOpen.opening')
    : t('versionOpen.openWithReferencesTitle', { version: version.version })
  return (
    <IconButton
      size="sm"
      label={label}
      disabled={busy}
      icon={busy ? <Loader2 size={14} className="animate-spin" /> : <ExternalLink size={14} />}
      onClick={() => {
        setBusy(true)
        void openWithReferences({ name: fileName, version: version.version, fileVersionId: version.id }).finally(
          () => setBusy(false),
        )
      }}
    />
  )
}
