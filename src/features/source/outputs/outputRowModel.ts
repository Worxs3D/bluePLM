/**
 * What the file list shows for a file's version outputs (5.5.0), and which actions an output row
 * and the file context menu offer. Pure: the file list, the context menu and the tests call it.
 *
 * Under an expanded file there is one row per kind (and configuration): the newest output of that
 * kind across the file's versions (`fileOutputHeads`). One of an older version than the file's
 * latest is out of date (`stale`): its mark generates the kind for the latest version, and the
 * row then moves up to that version instead of a second row appearing. A drawing shows its PDF,
 * STEP (and DXF when generated), a part or assembly its STEP (and IGES/STL when generated). A
 * primary kind (`primaryOutputKinds`) shows as a "Generate" ghost row when the file has none and
 * this user can generate it; any kind shows a spinner while a job for it is queued or running.
 */

// Direct module imports (not the `@/lib/outputs` barrel) keep this pure: no store, no Supabase.
import type { PlannedOutputJob } from '@/lib/outputs/autoQueue'
import {
  isDrawingFile,
  isModelFile,
  outputKindsForPath,
  primaryOutputKinds,
  supportsOutputKind,
} from '@/lib/outputs/kinds'
import { orgExportFilenamePattern, versionOutputFileName } from '@/lib/outputs/naming'
import { outputJobKey, type FileOutputVersion, type OutputJob } from '@/stores/slices/outputsSlice'
import type { LocalFile } from '@/stores/types'
import type { VersionedOutput, VersionOutput, VersionOutputKind } from '@/types/versionOutputs'

/**
 * `ready`: recorded (a generation for the latest version may be running, see `job`). `missing`:
 * none and none on the way. `queued` / `running`: a job will produce it. `failed`: the last job
 * for this version failed or was skipped (`job.detail` says why).
 */
export type OutputRowState = 'ready' | 'missing' | 'queued' | 'running' | 'failed'

export interface OutputRowEntry {
  kind: VersionOutputKind
  output: VersionedOutput | null
  /** The job behind `queued`/`running`/`failed`, or one generating a stale output for the latest version. */
  job: OutputJob | null
  state: OutputRowState
  /** The output is of an older version than the file's latest. */
  stale: boolean
}

export interface OutputRowInputs {
  /** The file's latest version (number and id); undefined until resolved. */
  latest: FileOutputVersion | undefined
  /** The file's newest outputs across its versions; undefined until loaded. */
  heads: readonly VersionedOutput[] | undefined
  jobs: ReadonlyMap<string, OutputJob>
  /** Desktop and allowed to generate (explorer edit or admin): show "Generate" ghost rows. */
  canGenerate: boolean
}

/** The kind a file gets a "Generate" ghost row for first: PDF for drawings, STEP for parts/assemblies. */
export function primaryOutputKind(path: string): VersionOutputKind | null {
  return primaryOutputKinds(path)[0] ?? null
}

export function isActiveJob(job: OutputJob | null | undefined): boolean {
  return job?.status === 'queued' || job?.status === 'running'
}

/** A job is about this version when it targets it, or (still queued) has not resolved one yet. */
function aboutVersion(job: OutputJob, latest: FileOutputVersion | undefined): boolean {
  if (job.fileVersionId === null) return isActiveJob(job)
  return latest !== undefined && job.fileVersionId === latest.fileVersionId
}

/** Whether `output` is of an older version than the file's latest checked-in one. */
export function isStaleOutput(
  output: Pick<VersionedOutput, 'version'>,
  latestVersion: number | null | undefined,
): boolean {
  return !!latestVersion && output.version < latestVersion
}

/** The output rows of one file, in kind order (the heads are already sorted). */
export function fileOutputEntries(
  file: Pick<LocalFile, 'path' | 'isDirectory' | 'pdmData'>,
  inputs: OutputRowInputs,
): OutputRowEntry[] {
  const fileId = file.pdmData?.id
  const latestVersion = file.pdmData?.version
  if (file.isDirectory || !fileId || !latestVersion) return []
  const kinds = outputKindsForPath(file.path)
  if (kinds.length === 0) return []
  const primary = primaryOutputKinds(file.path)
  const entries: OutputRowEntry[] = []

  for (const kind of kinds) {
    const job = inputs.jobs.get(outputJobKey(fileId, kind, null))
    const relevantJob = job && aboutVersion(job, inputs.latest) ? job : null
    const recorded = (inputs.heads ?? []).filter((o) => o.kind === kind && o.fileId === fileId)

    if (recorded.length > 0) {
      for (const output of recorded) {
        // The queue only runs the saved configuration, so a job is about the unconfigured output.
        const working = output.configuration === null && relevantJob && isActiveJob(relevantJob) ? relevantJob : null
        entries.push({ kind, output, job: working, state: 'ready', stale: isStaleOutput(output, latestVersion) })
      }
      continue
    }
    if (relevantJob && isActiveJob(relevantJob)) {
      entries.push({
        kind,
        output: null,
        job: relevantJob,
        state: relevantJob.status === 'running' ? 'running' : 'queued',
        stale: false,
      })
      continue
    }
    if (!primary.includes(kind) || !inputs.canGenerate || inputs.heads === undefined) continue
    const failed = relevantJob && (relevantJob.status === 'failed' || relevantJob.status === 'skipped')
    entries.push({
      kind,
      output: null,
      job: failed ? relevantJob : null,
      state: failed ? 'failed' : 'missing',
      stale: false,
    })
  }
  return entries
}

/** Which actions an output row's menu offers. */
export interface OutputMenuItems {
  open: boolean
  saveCopy: boolean
  saveNextToFile: boolean
  copyName: boolean
  /**
   * Generate it for the latest version: only when it is out of date. An up-to-date output is
   * never generated again (only an administrator could replace it; delete it to start over).
   */
  regenerate: boolean
  /** An administrator, or the user who generated it with explorer edit (schema 507). */
  delete: boolean
}

export function outputMenuItems(opts: {
  desktop: boolean
  isAdmin: boolean
  /** Explorer edit or admin. */
  canGenerate: boolean
  /** The output is of an older version than the file's latest. */
  stale: boolean
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
    regenerate: opts.desktop && opts.canGenerate && opts.stale && !opts.busy,
    delete: (opts.isAdmin || !!opts.isGeneratorWithEdit) && !opts.busy,
  }
}

/**
 * The kinds "Generate PDF" / "Generate STEP" apply to in this selection (checked-in files only): a
 * drawing has both (its STEP is of the model it shows), a part or assembly STEP.
 */
export function generateMenuKinds(files: readonly LocalFile[]): { pdf: number; step: number; drawings: number } {
  let pdf = 0
  let step = 0
  let drawings = 0
  for (const f of files) {
    if (f.isDirectory || !f.pdmData?.id || !f.pdmData.version) continue
    if (isDrawingFile(f.path)) {
      pdf++
      step++
      drawings++
    } else if (isModelFile(f.path)) step++
  }
  return { pdf, step, drawings }
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

/**
 * The files of `files` that need `kind` generated (the toolbar's Generate on a selection or a
 * folder): checked in, able to have the kind, and with no output of it for their latest version.
 * A file whose outputs are not loaded is included (the queue reuses a recorded output, so it costs
 * a lookup, not an export); one with a job already queued or running is not.
 */
export function filesNeedingOutput(
  files: readonly LocalFile[],
  kind: VersionOutputKind,
  heads: ReadonlyMap<string, readonly VersionedOutput[]>,
  jobs: ReadonlyMap<string, OutputJob>,
): LocalFile[] {
  const seen = new Set<string>()
  return files.filter((f) => {
    const id = f.pdmData?.id
    const version = f.pdmData?.version
    if (f.isDirectory || !id || !version || seen.has(id) || !supportsOutputKind(f.path, kind)) return false
    if (!primaryOutputKinds(f.path).includes(kind)) return false
    seen.add(id)
    if (isActiveJob(jobs.get(outputJobKey(id, kind, null)))) return false
    const known = heads.get(id)
    if (!known) return true
    const head = known.find((o) => o.kind === kind && o.configuration === null)
    return !head || isStaleOutput(head, version)
  })
}

/** The files a folder holds: directly (`recursive` false) or at any depth. Relative paths, '/'. */
export function filesInFolder(
  files: readonly LocalFile[],
  folder: string,
  recursive: boolean,
): LocalFile[] {
  const prefix = folder ? `${folder.replace(/\\/g, '/').replace(/\/$/, '')}/` : ''
  return files.filter((f) => {
    if (f.isDirectory) return false
    const rel = f.relativePath.replace(/\\/g, '/')
    if (!rel.startsWith(prefix)) return false
    return recursive || !rel.slice(prefix.length).includes('/')
  })
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

/** What the outputs loader has to read. */
export interface OutputsToLoad {
  /** Expanded files whose latest version id is not known (or the file moved on to a newer version). */
  resolve: Array<{ fileId: string; version: number }>
  /**
   * Files whose newest outputs are not loaded, were read at an older version of the file, or that
   * were just expanded (read again).
   */
  heads: string[]
}

/**
 * Expanded drawings (`expandedDrawingRefs`) and parts/assemblies (`expandedConfigFiles`), and the
 * drawings the Outputs column shows (`columnPaths`), to read outputs for. A file id in `inFlight` is skipped.
 * `headsAt` is the file version each file's heads were read at. Pure.
 */
export function outputsToLoad(
  files: readonly LocalFile[],
  expanded: ReadonlySet<string>,
  previouslyExpanded: ReadonlySet<string>,
  versions: ReadonlyMap<string, FileOutputVersion>,
  heads: ReadonlyMap<string, unknown>,
  headsAt: ReadonlyMap<string, number>,
  inFlight: ReadonlySet<string>,
  columnPaths: ReadonlySet<string> = new Set(),
): OutputsToLoad {
  const resolve: OutputsToLoad['resolve'] = []
  const load = new Set<string>()
  for (const file of files) {
    if (file.isDirectory) continue
    const isExpanded = expanded.has(file.path)
    if (!isExpanded && !columnPaths.has(file.path)) continue
    const id = file.pdmData?.id
    const version = file.pdmData?.version
    if (!id || !version || inFlight.has(id) || outputKindsForPath(file.path).length === 0) continue
    if (isExpanded) {
      const known = versions.get(id)
      if (!known || known.version !== version) resolve.push({ fileId: id, version })
    }
    const justExpanded = isExpanded && !previouslyExpanded.has(file.path)
    if (!heads.has(id) || headsAt.get(id) !== version || justExpanded) load.add(id)
  }
  return { resolve, heads: [...load] }
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
  'NO_MODEL',
] as const

export function outputReasonKey(code: string): string {
  return `source.outputs.reason_${code}`
}
