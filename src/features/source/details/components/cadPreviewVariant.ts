import type { CadPreviewMode } from '@/types/CadPreviewMode'

interface CadPreviewAvailability {
  mode: CadPreviewMode
  solidWorks: boolean
  hasThumbnail: boolean
  eDrawingsInstalled: boolean
}

export type CadPreviewVariant =
  | 'datacard'
  | 'embedded'
  | 'external'
  | 'missing-edrawings'
  | 'thumbnail'
  | 'external-fallback'
  | 'unavailable'

export function resolveCadPreviewVariant({
  mode,
  solidWorks,
  hasThumbnail,
  eDrawingsInstalled,
}: CadPreviewAvailability): CadPreviewVariant {
  if (solidWorks) return mode === 'edrawings-embedded' ? 'embedded' : 'datacard'
  if (mode === 'edrawings-embedded') return 'embedded'
  if (mode === 'edrawings') return eDrawingsInstalled ? 'external' : 'missing-edrawings'
  if (hasThumbnail) return 'thumbnail'
  return eDrawingsInstalled ? 'external-fallback' : 'unavailable'
}
