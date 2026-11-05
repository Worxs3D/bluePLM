/**
 * Whether a pinned version's review PDF exists. Shared by the review pane and the resubmit dialog,
 * which both offer `generate-review-pdfs` for the versions that lack one.
 */

import { log } from '@/lib/logger'
import { getDrawingPdf } from '@/lib/supabase/reviews'

import { itemPreviewKind } from './itemInfo'

export type PdfStatus = 'ready' | 'missing' | 'not_needed' | 'unknown'

export async function loadPdfStatus(item: {
  fileVersionId: string
  extension: string | null
}): Promise<PdfStatus> {
  if (itemPreviewKind(item.extension) !== 'drawing') return 'not_needed'
  try {
    return (await getDrawingPdf(item.fileVersionId)) ? 'ready' : 'missing'
  } catch (error) {
    log.warn('[ReviewPackage]', 'PDF status lookup failed', {
      error,
      fileVersionId: item.fileVersionId,
    })
    return 'unknown'
  }
}
