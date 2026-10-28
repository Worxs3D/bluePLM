/**
 * Review package pipeline (drawing reviews, schema 107).
 *
 * - `stageVersionClosure` / `fetchMergedClosure` + `stageFiles`: file versions and their
 *   dependency closures on disk at vault-relative paths, deduplicated, resumable.
 * - `ensureDrawingPdf`: the stored PDF of a drawing version, generated once on a machine with
 *   SOLIDWORKS.
 * - `resolveReviewItemPreview`: what the review viewer shows for an item.
 * - Manifest writer and the pure layout/merge helpers.
 *
 * Commands: `download-review-package` and `generate-review-pdfs`
 * (`src/lib/commands/handlers/reviewPackage.ts`).
 */

export * from './types'
export { mergeClosures, groupByContentHash } from './closure'
export {
  sanitizeFolderName,
  sanitizePathSegment,
  packageRelativePath,
  joinLocalPath,
  isDrawingPath,
  isPdfPath,
  isRetargetable,
} from './layout'
export {
  buildManifest,
  manifestToCsv,
  manifestToJson,
  MANIFEST_CSV,
  MANIFEST_JSON,
} from './manifest'
export { fetchMergedClosure, stageFiles, stageVersionClosure, STAGE_CONCURRENCY } from './stage'
export {
  ensureDrawingPdf,
  pdfRenderUnavailableReason,
  resolveReviewItemPreview,
  downloadPdfToCache,
} from './pdf'
export { chooseReviewPackageDestination } from './destination'
