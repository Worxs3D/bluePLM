/**
 * Reference extraction after check-in, moved out of `checkin.ts`.
 *
 * After a successful check-in, the references of each checked-in assembly and drawing are read
 * from the SOLIDWORKS service and written twice, in the background (never blocking or failing the
 * check-in):
 * - `file_references` (current set per file, for Contains / Where-Used), as before.
 * - `file_version_references` for the version just created (schema 107), so a review package can
 *   resolve the drawing and its parts at matching versions. See
 *   `src/lib/reviewPackage/checkinVersionReferences.ts`.
 */

import type { LocalFile } from '../../../stores/pdmStore'
import { upsertFileReferences } from '../../supabase'
import type { SWReference } from '../../supabase/files/mutations'
import { swRefsToFileReferences } from '../../solidworks/referenceRows'
import type { SWServiceReference } from '../../solidworks/types'
import { recordCheckedInVersionReferences } from '../../reviewPackage/checkinVersionReferences'
import { log } from '@/lib/logger'

/** File types that have references to extract (assemblies reference components, drawings reference models). */
export const REFERENCE_FILE_EXTENSIONS = ['.sldasm', '.slddrw']

/** Drawing extensions (need special handling for reference type). */
export const DRAWING_EXTENSIONS = ['.slddrw']

/** Normalize a file path for cross-source comparison (SolidWorks vs file system) */
const normalizePath = (p: string) => p.toLowerCase().replace(/\\/g, '/')

function logCheckin(
  level: 'info' | 'warn' | 'error' | 'debug',
  message: string,
  context: Record<string, unknown>,
) {
  log[level]('[Checkin]', message, context)
}

/**
 * Extract and store references after a successful check-in.
 * This populates the file_references table for Contains/Where-Used queries.
 *
 * Handles both:
 * - Assemblies: Component references (parts and sub-assemblies)
 * - Drawings: Model references (the parts/assemblies the drawing documents)
 *
 * @param file - The checked-in assembly or drawing file
 * @param orgId - Organization ID
 * @param vaultId - Vault ID
 * @param vaultRootPath - Optional local vault root path for better path matching
 * @returns Promise that resolves when extraction is complete (non-blocking to check-in)
 */
export async function extractAndStoreReferences(
  file: LocalFile,
  orgId: string,
  vaultId: string,
  vaultRootPath?: string,
): Promise<void> {
  // Process assemblies and drawings (both have references to extract)
  if (!REFERENCE_FILE_EXTENSIONS.includes(file.extension.toLowerCase())) {
    return
  }

  const fileId = file.pdmData?.id
  if (!fileId) {
    logCheckin('debug', 'Skipping reference extraction - no file ID', { fileName: file.name })
    return
  }

  // Check if SolidWorks service is running
  const status = await window.electronAPI?.solidworks?.getServiceStatus?.()
  if (!status?.data?.running) {
    logCheckin('debug', 'Skipping reference extraction - SW service not running', {
      fileName: file.name,
    })
    return
  }

  const isDrawing = DRAWING_EXTENSIONS.includes(file.extension.toLowerCase())

  try {
    logCheckin('debug', 'Extracting file references', {
      fileName: file.name,
      fullPath: file.path,
      isDrawing,
    })

    // Call SolidWorks service to get references
    const result = await window.electronAPI?.solidworks?.getReferences?.(file.path)

    if (!result?.success || !result.data?.references) {
      logCheckin('debug', 'No references returned from SW service', {
        fileName: file.name,
        isDrawing,
        error: result?.error,
      })
      return
    }

    const swRefs = result.data.references as SWServiceReference[]

    logCheckin('debug', 'Got references from SW service', {
      fileName: file.name,
      isDrawing,
      count: swRefs.length,
      firstRef: swRefs[0]?.fileName,
    })

    // The shared mapper expands drawing configurations. Assemblies retain their existing component
    // semantics because the service response does not include the parent file type.
    const referenceTypesByPath = new Map(
      swRefs.map((ref) => [normalizePath(ref.path), ref.fileType.toLowerCase()]),
    )
    const references: SWReference[] = swRefsToFileReferences(swRefs).map((reference) => {
      const fileType = referenceTypesByPath.get(normalizePath(reference.childFilePath))
      const referenceType: SWReference['referenceType'] =
        isDrawing || (fileType !== 'assembly' && fileType !== 'part') ? 'reference' : 'component'

      return { ...reference, referenceType }
    })

    // Store references in database (pass vault root for better path matching)
    const upsertResult = await upsertFileReferences(
      orgId,
      vaultId,
      fileId,
      references,
      vaultRootPath,
    )

    if (upsertResult.success) {
      logCheckin('info', 'Stored file references', {
        fileName: file.name,
        isDrawing,
        inserted: upsertResult.inserted,
        updated: upsertResult.updated,
        deleted: upsertResult.deleted,
        skipped: upsertResult.skipped,
        skippedReasons: upsertResult.skippedReasons,
      })
    } else {
      logCheckin('warn', 'Failed to store file references', {
        fileName: file.name,
        isDrawing,
        error: upsertResult.error,
      })
    }

    // The same references, against the version this check-in created. Independent of the
    // current-set write above; never throws.
    await recordCheckedInVersionReferences(file, references, vaultRootPath)
  } catch (error) {
    // Non-fatal - reference extraction failure shouldn't block check-in
    logCheckin('warn', 'Reference extraction failed', {
      fileName: file.name,
      isDrawing,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
