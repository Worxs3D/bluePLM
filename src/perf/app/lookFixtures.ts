/**
 * Fixture data for ui-look scenes (src/perf/app/look.ts): a finished Vault Metadata Audit whose
 * findings land in every category, built through the same comparison the real scan runs, so the
 * page renders what a real report would give it.
 */
import {
  compareOwnedMetadata,
  summarizeDivergence,
  type ComparedFileType,
  type DatabaseMetadata,
  type FileDivergence,
  type FileMetadata,
} from '@/lib/metadata/divergence'
import { DIVERGENCE_REPORT_SCHEMA_VERSION, type DivergenceReport } from '@/lib/metadata/divergenceScan'

function rowOf(overrides: Partial<DatabaseMetadata> = {}): DatabaseMetadata {
  return {
    partNumber: null,
    description: null,
    revision: null,
    configTabs: {},
    configDescriptions: {},
    hasConfigTabsKey: false,
    hasConfigDescriptionsKey: false,
    ...overrides,
  }
}

let nextId = 0

function compare(
  folder: string,
  fileName: string,
  database: DatabaseMetadata,
  file: FileMetadata,
  fileType: ComparedFileType = 'part',
): FileDivergence {
  nextId += 1
  return compareOwnedMetadata(
    {
      fileId: `look-file-${nextId}`,
      relativePath: `${folder}\\${fileName}`,
      fileName,
      fileType,
    },
    database,
    file,
  )
}

function single(fileProperties: Record<string, string>, configuration: Record<string, string> = {}): FileMetadata {
  return { configurations: ['Default'], fileProperties, configurationProperties: { Default: configuration } }
}

/** One file per situation the audit groups, plus a few repeats so lists have some length. */
function lookFiles(): FileDivergence[] {
  nextId = 0
  const files: FileDivergence[] = []

  // BluePLM holds it, the file does not: write BluePLM's value into the document.
  files.push(
    compare(
      'PRODUCTS\\GRIPPER\\HARDWARE',
      'GR-M14-NUT-PACKED.SLDASM',
      rowOf({ description: 'Nut and O-ring, packed assembly, bagged, M14' }),
      single({}),
      'assembly',
    ),
    compare(
      'PRODUCTS\\GRIPPER\\HARDWARE',
      'GR-M10-WASHER.SLDPRT',
      rowOf({ partNumber: 'GR-M10-WASHER', description: 'Washer, M10, 316 stainless' }),
      single({}),
    ),
  )

  // Both sides hold a value and they differ.
  files.push(
    compare(
      'PRODUCTS\\GRIPPER\\MECHANICAL',
      'GR-SHAFT-DRIVE.SLDPRT',
      rowOf({ partNumber: 'GR-100-SHAFT', description: 'Drive shaft, 8 mm' }),
      single({ 'Base Item Number': 'GR-110-SHAFT', Description: 'Drive shaft, 8 mm, hardened' }),
    ),
    compare(
      'PRODUCTS\\LIGHT\\HOUSING',
      'LT-END-CAP.SLDPRT',
      rowOf({ description: 'End cap, anodised black' }),
      single({ Description: 'End cap, anodized black, rev B' }),
    ),
  )

  // Gone from the record, still in the file's configurations: copy the file's value in.
  files.push(
    compare(
      'PRODUCTS\\LIGHT\\HOUSING',
      'LT-BRACKET.SLDPRT',
      rowOf({ hasConfigTabsKey: true, hasConfigDescriptionsKey: true }),
      {
        configurations: ['Short', 'Long'],
        fileProperties: {},
        configurationProperties: {
          Short: { 'Tab Number': '-001', Description: 'Mounting bracket, short' },
          Long: { 'Tab Number': '-002', Description: 'Mounting bracket, long' },
        },
      },
    ),
  )

  // BluePLM's columns empty, the file still holding both.
  for (const [folder, name, number, description] of [
    ['PRODUCTS\\SENSOR\\ELEC', 'SN-MAIN-PCB-R2.SLDPRT', 'SN-MAIN-PCB-R2', 'Main PCB, sensor head'],
    ['PRODUCTS\\SENSOR\\ELEC', 'SN-CABLE-GLAND.SLDPRT', 'SN-GLAND-M8', 'Cable gland, M8'],
    ['PRODUCTS\\SENSOR\\MECHANICAL', 'SN-WINDOW.SLDPRT', 'SN-WINDOW-50', 'Window, acrylic, 50 mm'],
  ]) {
    files.push(compare(folder, name, rowOf(), single({ 'Base Item Number': number, Description: description })))
  }

  // Lost on both sides: the record names configurations that have no values left anywhere.
  files.push(
    compare(
      'PRODUCTS\\GRIPPER\\SEALS',
      'ORING-NITRILE-70A.SLDPRT',
      rowOf({ configTabs: { '-010': '-010' }, hasConfigTabsKey: true, hasConfigDescriptionsKey: true }),
      {
        configurations: ['-010', '-012'],
        fileProperties: {},
        configurationProperties: { '-010': {}, '-012': {} },
      },
    ),
  )

  // Values BluePLM never held: leave alone.
  for (const [folder, name, suffix] of [
    ['SHARED\\TOOLBOX', 'WASHER-FLAT.SLDPRT', '-001'],
    ['SHARED\\TOOLBOX', 'SCREW-SHCS.SLDPRT', '-004'],
    ['SHARED\\TOOLBOX', 'NUT-HEX.SLDPRT', '-002'],
  ]) {
    files.push(compare(folder, name, rowOf(), single({}, { Description: name.replace('.SLDPRT', ''), Suffix: suffix })))
  }

  return files
}

export function lookVaultAuditReport(vaultPath: string): DivergenceReport {
  const files = lookFiles()
  return {
    schemaVersion: DIVERGENCE_REPORT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    scope: {
      orgId: 'look-org',
      vaultId: null,
      vaultPath,
      pathPrefix: null,
      limit: null,
      includeDrawings: false,
      configurationRecordedOnly: false,
    },
    counts: {
      rowsFetched: 412,
      rowsInScope: 412,
      rowsConsidered: 412,
      rowsSkippedNoConfigurationRecord: 0,
      rowsSkippedByLimit: 0,
      filesCompared: 396,
      filesMissingOnDisk: 14,
      filesUnreadable: 2,
      filesOpenInSolidWorks: 0,
    },
    summary: summarizeDivergence(files),
    files,
    unreadable: [],
    integrity: { filesHashed: 0, breaches: [] },
    readBackTimings: [],
    durationMs: 163_000,
    cancelled: false,
  }
}
