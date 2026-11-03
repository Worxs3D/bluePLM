/**
 * How a version output is named when it is saved: the organization's export filename pattern
 * (Settings > Export, `export_settings.filename_pattern`) with the file's metadata. Pure.
 */

import { DEFAULT_EXPORT_SETTINGS, type ExportSettings } from '@/types/pdm'
import type { VersionOutput } from '@/types/versionOutputs'

import { baseNameOf, outputFileName, type OutputNameValues } from './fileName'
import { outputExtension } from './kinds'

/** The organization's export filename pattern, or the app default. */
export function orgExportFilenamePattern(
  organization: { settings?: { export_settings?: Partial<ExportSettings> } | null } | null | undefined,
): string {
  const pattern = organization?.settings?.export_settings?.filename_pattern
  return typeof pattern === 'string' && pattern.trim() ? pattern : DEFAULT_EXPORT_SETTINGS.filename_pattern
}

/** What a saved copy's name is built from, besides the output itself. */
export interface OutputSourceInfo {
  /** The source file's name or path (`Part1.SLDPRT`); its base name is `{filename}`. */
  sourceFileName: string
  partNumber?: string | null
  tab?: string | null
  revision?: string | null
  description?: string | null
}

/** The name a copy of `output` gets under `pattern`, e.g. `BR-101011_RevA.step`. */
export function versionOutputFileName(
  output: Pick<VersionOutput, 'kind' | 'configuration'>,
  source: OutputSourceInfo,
  pattern: string,
  now?: Date,
): string {
  const values: OutputNameValues = {
    filename: baseNameOf(source.sourceFileName),
    config: output.configuration,
    partNumber: source.partNumber,
    tab: source.tab,
    revision: source.revision,
    description: source.description,
    now,
  }
  return outputFileName(pattern, values, outputExtension(output.kind))
}
