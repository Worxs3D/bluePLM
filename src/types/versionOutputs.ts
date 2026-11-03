/**
 * Outputs of a checked-in file version (schema 505): the drawing PDF (`drawing_pdf_render`) and
 * the STEP, IGES, STL and DXF exports (`file_version_output`), in one shape. Each is generated from
 * the version's staged closure, stored content-addressed in the vault bucket and never changes
 * (an administrator may replace one). A copy on disk is the user's own file, not an output.
 */

/** What an output is. `pdf` lives in drawing_pdf_render; the rest in file_version_output. */
export type VersionOutputKind = 'pdf' | 'step' | 'iges' | 'stl' | 'dxf'

/** The kinds file_version_output holds. */
export type ModelOutputKind = Exclude<VersionOutputKind, 'pdf'>

export const VERSION_OUTPUT_KINDS: readonly VersionOutputKind[] = ['pdf', 'step', 'iges', 'stl', 'dxf']
export const MODEL_OUTPUT_KINDS: readonly ModelOutputKind[] = ['step', 'iges', 'stl', 'dxf']

export interface VersionOutput {
  /** file_version_output.id, or drawing_pdf_render.id for a PDF. */
  id: string
  kind: VersionOutputKind
  fileId: string
  fileVersionId: string
  /** The configuration exported; null = the one the version was saved in (always null for a PDF). */
  configuration: string | null
  /** SHA-256 of the output in the vault bucket. */
  storageHash: string
  fileSize: number
  /** The name it was generated under; null for a PDF (named when saved). */
  fileName: string | null
  /** Whether it was generated against exact reference versions. Null when not stated. */
  closureExact: boolean | null
  generatedBy: string | null
  generatedAt: string
}

/** Arguments of file_version_output_record(). */
export interface RecordVersionOutputInput {
  fileVersionId: string
  kind: ModelOutputKind
  configuration?: string | null
  storageHash: string
  fileSize: number
  /** A plain file name, no folder. */
  fileName: string
  closureExact?: boolean | null
}

export interface RecordVersionOutputResult {
  /** False when the same hash was already recorded (a retry). */
  recorded: boolean
  /** True when an administrator replaced a different recorded output. */
  replaced: boolean
  storageHash: string
  id: string | null
}

/** Why file_version_output_record() refused. */
export type VersionOutputErrorCode = 'OUTPUT_EXISTS' | 'NOT_UPLOADER' | 'NO_EDIT_PERMISSION' | 'UNKNOWN'

/** `organization.settings.outputs` (5.5.0). */
export interface OrgOutputSettings {
  /** Generate outputs in the background after a successful check-in. Unset kinds are on. */
  auto_on_checkin?: {
    /** The drawing PDF of each checked-in drawing. Default true. */
    pdf?: boolean
    /** A STEP of each checked-in part and assembly (saved configuration). Default true. */
    step?: boolean
  }
}
