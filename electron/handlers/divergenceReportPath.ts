import path from 'path'

/** Subfolder of the logs directory that holds `scan-divergence` artifacts. */
export const DIVERGENCE_REPORT_DIR = 'divergence'

/** The only names the renderer may write: what `writeDivergenceArtifact` generates. */
const REPORT_FILE_NAME = /^divergence-report-[A-Za-z0-9-]+\.json$/

/**
 * Where a divergence report named `fileName` goes, or null when the name is not one the scanner
 * produces. The renderer supplies only a file name, never a directory, so a write through this
 * cannot land anywhere but `<logs>/divergence/`.
 */
export function resolveDivergenceReportPath(logsDir: string, fileName: string): string | null {
  if (!REPORT_FILE_NAME.test(fileName)) return null
  return path.join(logsDir, DIVERGENCE_REPORT_DIR, fileName)
}
