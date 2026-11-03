/**
 * What the file list shows for a file's version outputs (5.5.0), and which actions an output row
 * and the file context menu offer. Pure: the file list, the context menu and the tests call it.
 *
 * Under an expanded file the rows are the outputs of the file's latest checked-in version: a
 * drawing's PDF (and DXF when generated), a part's or assembly's STEP (and IGES/STL when
 * generated). The primary kind (PDF, STEP) shows as a "Generate" ghost row when it is missing and
 * this user can generate it; any kind shows a spinner while a job for it is queued or running.
 */

// Direct module imports (not the `@/lib/outputs` barrel) keep this pure: no store, no Supabase.
import type { PlannedOutputJob } from '@/lib/outputs/autoQueue'
import { isDrawingFile, isModelFile, outputKindsForPath, supportsOutputKind } from '@/lib/outputs/kinds'
import { orgExportFilenamePattern, versionOutputFileName } from '@/lib/outputs/naming'
import { outputJobKey, type FileOutputVersion, type OutputJob } from '@/stores/slices/outputsSlice'
import type { LocalFile } from '@/stores/types'
import type { VersionOutput, VersionOutputKind } from '@/types/versionOutputs'

/**
 * `ready`: recorded (a regeneration may be running, see `job`). `missing`: none and none on the
 * way. `queued` / `running`: a job will produce it. `failed`: the last job for this version failed
 * or was skipped (`job.detail` says why).
 */
export type OutputRowState = 'ready' | 'missing' | 'queued' | 'running' | 'failed'

export interface OutputRowEntry {
  kind: VersionOutputKind
  output: VersionOutput | null
  /** The job behind `queued`/`running`/`failed`, or a regeneration of a ready output. */
  job: OutputJob | null
  state: OutputRowState
}

export interface OutputRowInputs {
  /** The version whose outputs are shown; undefined until resolved. */
  latest: FileOutputVersion | undefined
  /** That version's outputs; undefined until loaded. */
  outputs: readonly VersionOutput[] | undefined
  jobs: ReadonlyMap<string, OutputJob>
  /** Desktop and allowed to generate (explorer edit or admin): show "Generate" ghost rows. */
  canGenerate: boolean
}

/** The kind a file gets a "Generate" ghost row for: PDF for drawings, STEP for parts/assemblies. */
export function primaryOutputKind(path: string): VersionOutputKind | null {
  if (isDrawingFile(path)) return 'pdf'
  if (isModelFile(path)) return 'step'
  return null
}

function isActive(job: OutputJob | null | undefined): boolean {
  return job?.status === 'queued' || job?.status === 'running'
}

/** A job is about this version when it targets it, or (still queued) has not resolved one yet. */
function aboutVersion(job: OutputJob, latest: FileOutputVersion | undefined): boolean {
  if (job.fileVersionId === null) return isActive(job)
  return latest !== undefined && job.fileVersionId === latest.fileVersionId
}

/** The output rows of one file, in kind order (the outputs list is already sorted). */
export function fileOutputEntries(
  file: Pick<LocalFile, 'path' | 'isDirectory' | 'pdmData'>,
  inputs: OutputRowInputs,
): OutputRowEntry[] {
  const fileId = file.pdmData?.id
  if (file.isDirectory || !fileId || !file.pdmData?.version) return []
  const kinds = outputKindsForPath(file.path)
  if (kinds.length === 0) return []
  const primary = primaryOutputKind(file.path)
  const entries: OutputRowEntry[] = []

  for (const kind of kinds) {
    const job = inputs.jobs.get(outputJobKey(fileId, kind, null))
    const relevantJob = job && aboutVersion(job, inputs.latest) ? job : null
    const recorded = (inputs.outputs ?? []).filter((o) => o.kind === kind && o.fileId === fileId)

    if (recorded.length > 0) {
      for (const output of recorded) {
        // The queue only runs the saved configuration, so a job is about the unconfigured output.
        const regenerating = output.configuration === null && relevantJob && isActive(relevantJob) ? relevantJob : null
        entries.push({ kind, output, job: regenerating, state: 'ready' })
      }
      continue
    }
    if (relevantJob && isActive(relevantJob)) {
      entries.push({ kind, output: null, job: relevantJob, state: relevantJob.status === 'running' ? 'running' : 'queued' })
      continue
    }
    if (kind !== primary || !inputs.canGenerate || inputs.outputs === undefined) continue
    const failed = relevantJob && (relevantJob.status === 'failed' || relevantJob.status === 'skipped')
    entries.push({ kind, output: null, job: failed ? relevantJob : null, state: failed ? 'failed' : 'missing' })
  }
  return entries
}

/** Which actions an output row's menu offers. */
export interface OutputMenuItems {
  open: boolean
  saveCopy: boolean
  saveNextToFile: boolean
  copyName: boolean
  /** Replacing a recorded output is an administrator's (file_version_output_record). */
  regenerate: boolean
  /** An administrator, or the user who generated it with explorer edit (schema 507). */
  delete: boolean
}

export function outputMenuItems(opts: {
  desktop: boolean
  isAdmin: boolean
  /** The source has a local folder to save next to (not a moved-away stub). */
  hasLocalFolder: boolean
  /** A job for this output is already queued or running. */
  busy: boolean
  /** The signed-in user generated the output and has explorer edit. */
  isGeneratorWithEdit?: boolean
}): OutputMenuItems {
  return {
    open: true,
    saveCopy: true,
    saveNextToFile: opts.desktop && opts.hasLocalFolder,
    copyName: true,
    regenerate: opts.desktop && opts.isAdmin && !opts.busy,
    delete: (opts.isAdmin || !!opts.isGeneratorWithEdit) && !opts.busy,
  }
}

/** The kinds "Generate PDF" / "Generate STEP" apply to in this selection (checked-in files only). */
export function generateMenuKinds(files: readonly LocalFile[]): { pdf: number; step: number } {
  let pdf = 0
  let step = 0
  for (const f of files) {
    if (f.isDirectory || !f.pdmData?.id || !f.pdmData.version) continue
    if (isDrawingFile(f.path)) pdf++
    else if (isModelFile(f.path)) step++
  }
  return { pdf, step }
}

/** The jobs "Generate <kind>" queues for a selection: checked-in files that can have that kind. */
export function generateJobs(
  files: readonly LocalFile[],
  kind: VersionOutputKind,
  regenerate = false,
): PlannedOutputJob[] {
  const jobs: PlannedOutputJob[] = []
  const seen = new Set<string>()
  for (const f of files) {
    const id = f.pdmData?.id
    const version = f.pdmData?.version
    if (f.isDirectory || !id || !version || seen.has(id) || !supportsOutputKind(f.path, kind)) continue
    seen.add(id)
    jobs.push({ fileId: id, version, kind, fileName: f.name, ...(regenerate ? { regenerate: true } : {}) })
  }
  return jobs
}

/** The name a copy of `output` gets: the organization's export filename pattern with the file's metadata. */
export function outputCopyName(
  output: Pick<VersionOutput, 'kind' | 'configuration'>,
  file: Pick<LocalFile, 'name' | 'pdmData'>,
  organization: Parameters<typeof orgExportFilenamePattern>[0],
  now?: Date,
): string {
  return versionOutputFileName(
    output,
    {
      sourceFileName: file.name,
      partNumber: file.pdmData?.part_number ?? null,
      revision: file.pdmData?.revision ?? null,
      description: file.pdmData?.description ?? null,
    },
    orgExportFilenamePattern(organization),
    now,
  )
}

/** What the outputs loader has to read for the expanded files. */
export interface OutputsToLoad {
  /** Files whose latest version id is not known (or the file moved on to a newer version). */
  resolve: Array<{ fileId: string; version: number }>
  /** Versions whose outputs are not loaded, or whose file was just expanded (read again). */
  load: string[]
}

/**
 * Expanded drawings (`expandedDrawingRefs`) and parts/assemblies (`expandedConfigFiles`) to read
 * outputs for. A file id in `inFlight` is skipped. Pure.
 */
export function outputsToLoad(
  files: readonly LocalFile[],
  expanded: ReadonlySet<string>,
  previouslyExpanded: ReadonlySet<string>,
  versions: ReadonlyMap<string, FileOutputVersion>,
  loaded: ReadonlyMap<string, unknown>,
  inFlight: ReadonlySet<string>,
): OutputsToLoad {
  const resolve: OutputsToLoad['resolve'] = []
  const load = new Set<string>()
  for (const file of files) {
    if (!expanded.has(file.path) || file.isDirectory) continue
    const id = file.pdmData?.id
    const version = file.pdmData?.version
    if (!id || !version || inFlight.has(id) || outputKindsForPath(file.path).length === 0) continue
    const known = versions.get(id)
    if (!known || known.version !== version) {
      resolve.push({ fileId: id, version })
      continue
    }
    if (!loaded.has(known.fileVersionId) || !previouslyExpanded.has(file.path)) load.add(known.fileVersionId)
  }
  return { resolve, load: [...load] }
}

/** Status codes the queue and the library report, each with a `source.outputs.reason_<CODE>` string. */
export const OUTPUT_REASON_CODES = [
  'service_offline',
  'service_outdated',
  'solidworks_not_installed',
  'desktop_only',
  'unsupported',
  'NO_VERSION',
  'SAME_NAME_OPEN',
  'STAGING',
  'RETARGET_FAILED',
  'EXPORT_FAILED',
  'READ_FAILED',
  'UPLOAD_FAILED',
  'OUTPUT_EXISTS',
  'NOT_UPLOADER',
  'NO_EDIT_PERMISSION',
  'NOT_FOUND',
] as const

export function outputReasonKey(code: string): string {
  return `source.outputs.reason_${code}`
}
