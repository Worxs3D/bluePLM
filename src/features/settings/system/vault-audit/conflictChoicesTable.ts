/**
 * The conflict choices as a table that can leave the app and come back.
 *
 * A colleague who works through a long conflict list on their own machine used to be able to hand
 * the result over only as screenshots, and the person applying it had to click every choice again.
 * "Copy choices" writes the conflict category as tab-separated text, which pastes into a
 * spreadsheet or a message as it is; "Paste choices" reads such a table back and sets the same
 * choices on screen. Pasting only selects: nothing is written until the usual Write button, so the
 * checkout, verification and check-in rules of the two writers are unchanged.
 *
 * ## What a pasted line has to prove
 *
 * - **The file.** By its vault path, with either slash and with the screen's ` / ` separators. A
 *   path that is longer or shorter by leading folders still matches when only one file fits, and a
 *   bare file name matches when only one conflicting file has that name. Anything else is skipped.
 * - **The value.** A line naming a field (and a configuration, for configuration fields) must name
 *   a conflict that is still in the scan. A line with no field names the whole file, which only
 *   "Use BluePLM" can mean, since that writer is per file anyway.
 * - **That nothing moved.** When the table carries the two values, as a copied one does, both must
 *   still be what the scan holds (spacing aside). A choice made against other values is not a
 *   choice about these, so it is skipped rather than applied.
 * - **One direction per file.** "Use BluePLM" rewrites the whole document, so a file with lines in
 *   both directions is skipped whole instead of guessing which line was meant.
 *
 * Header names, field names and choice words are fixed English tokens, not translated text: the
 * table is an interchange format and must read the same on every machine that pastes it.
 */

import type { OwnedField } from '@/lib/metadata/divergence'
import type { VaultAuditFinding } from '@/types/vaultAudit'

export type ConflictChoice = 'blueplm' | 'file'

export const CHOICES_TABLE_HEADER = [
  'File',
  'Configuration',
  'Field',
  'BluePLM value',
  'File value',
  'Choice',
] as const

const CHOICE_TOKEN: Record<ConflictChoice, string> = { blueplm: 'BluePLM', file: 'File' }

const FIELD_TOKEN: Record<OwnedField, string> = {
  part_number: 'part number',
  description: 'description',
  revision: 'revision',
  config_tab: 'configuration tab',
  config_description: 'configuration description',
}

const FIELD_ALIASES: Record<string, OwnedField> = {
  'part number': 'part_number',
  'item number': 'part_number',
  description: 'description',
  revision: 'revision',
  'configuration tab': 'config_tab',
  'config tab': 'config_tab',
  tab: 'config_tab',
  'configuration description': 'config_description',
  'config description': 'config_description',
}

type Column = 'path' | 'configuration' | 'field' | 'databaseValue' | 'fileValue' | 'choice'

const COLUMN_ALIASES: Record<string, Column> = {
  file: 'path',
  path: 'path',
  'file path': 'path',
  configuration: 'configuration',
  config: 'configuration',
  field: 'field',
  'blueplm value': 'databaseValue',
  blueplm: 'databaseValue',
  'database value': 'databaseValue',
  'file value': 'fileValue',
  choice: 'choice',
  use: 'choice',
  decision: 'choice',
}

// ============================================
// Formatting
// ============================================

/** Tabs and line breaks would split a cell; a quote is escaped the way a spreadsheet does it. */
function formatCell(value: string | null): string {
  const flat = (value ?? '').replace(/[\t\r\n]+/g, ' ')
  return flat.includes('"') ? `"${flat.replace(/"/g, '""')}"` : flat
}

export interface ConflictChoiceState {
  /** Files whose documents take BluePLM's values (the per-file push selection). */
  bluePlmFileIds: ReadonlySet<string>
  /** Conflict findings whose file value goes into BluePLM. */
  fileFindingIds: ReadonlySet<string>
}

/** Every conflict in the list, one per line, with the choice made on screen or a blank cell. */
export function formatConflictChoicesTable(
  findings: readonly VaultAuditFinding[],
  state: ConflictChoiceState,
): string {
  const conflicts = findings
    .filter((finding) => finding.resolution === 'choose-a-side')
    .sort(
      (a, b) =>
        a.relativePath.localeCompare(b.relativePath) ||
        (a.configuration ?? '').localeCompare(b.configuration ?? '') ||
        a.field.localeCompare(b.field),
    )

  const lines = [CHOICES_TABLE_HEADER.join('\t')]
  for (const finding of conflicts) {
    const choice: ConflictChoice | null = state.bluePlmFileIds.has(finding.fileId)
      ? 'blueplm'
      : state.fileFindingIds.has(finding.id)
        ? 'file'
        : null
    lines.push(
      [
        formatCell(finding.relativePath),
        formatCell(finding.configuration),
        FIELD_TOKEN[finding.field],
        formatCell(finding.databaseValue),
        formatCell(finding.fileValue),
        choice ? CHOICE_TOKEN[choice] : '',
      ].join('\t'),
    )
  }
  return lines.join('\n')
}

// ============================================
// Parsing
// ============================================

export interface ParsedChoiceLine {
  /** 1-based line number in the pasted text, for the skipped list. */
  line: number
  path: string
  configuration: string | null
  /** Null when the line names the whole file. */
  field: OwnedField | null
  /** Undefined when the table has no such column, so there is nothing to check against. */
  databaseValue?: string
  fileValue?: string
  choice: ConflictChoice
}

export type ChoiceLineError =
  | 'no-header'
  | 'no-file-column'
  | 'no-choice-column'
  | 'unreadable-line'
  | 'unknown-field'
  | 'unknown-choice'

export interface ParsedChoicesTable {
  lines: ParsedChoiceLine[]
  errors: Array<{ line: number; error: ChoiceLineError; text: string }>
}

const QUOTED = /^"((?:[^"]|"")*)"$/

function unquote(cell: string): string {
  const trimmed = cell.trim()
  const match = QUOTED.exec(trimmed)
  return match ? match[1].replace(/""/g, '"') : trimmed
}

/** Tab-separated (a spreadsheet or a copied table) or a Markdown pipe table. */
function splitLine(text: string): string[] | null {
  if (text.includes('\t')) return text.split('\t').map(unquote)
  const trimmed = text.trim()
  if (trimmed.startsWith('|')) {
    return trimmed.replace(/^\|/, '').replace(/\|$/, '').split('|').map(unquote)
  }
  return null
}

function isMarkdownRule(text: string): boolean {
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(text.trim())
}

function keyOf(cell: string): string {
  return cell.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')
}

function parseField(cell: string): OwnedField | null | 'unknown' {
  const key = keyOf(cell)
  if (key === '' || key === '*') return null
  return FIELD_ALIASES[key] ?? 'unknown'
}

function parseChoice(cell: string): ConflictChoice | null | 'unknown' {
  const key = keyOf(cell)
    .replace(/^use (the )?/, '')
    .replace(/[’']s value$/, '')
    .replace(/ value$/, '')
  if (key === '') return null
  if (key === 'blueplm') return 'blueplm'
  if (key === 'file') return 'file'
  return 'unknown'
}

export function parseConflictChoicesTable(text: string): ParsedChoicesTable {
  const rawLines = text.split(/\r?\n/)
  const lines: ParsedChoiceLine[] = []
  const errors: ParsedChoicesTable['errors'] = []

  let columns: Map<Column, number> | null = null

  for (const [index, raw] of rawLines.entries()) {
    const lineNumber = index + 1
    if (raw.trim() === '' || isMarkdownRule(raw)) continue

    const cells = splitLine(raw)

    if (!columns) {
      const header = new Map<Column, number>()
      cells?.forEach((cell, position) => {
        const column = COLUMN_ALIASES[keyOf(cell)]
        if (column && !header.has(column)) header.set(column, position)
      })
      if (!cells || !header.has('path') || !header.has('choice')) {
        errors.push({
          line: lineNumber,
          error:
            !cells || header.size === 0
              ? 'no-header'
              : !header.has('path')
                ? 'no-file-column'
                : 'no-choice-column',
          text: raw,
        })
        // Without a header nothing below can be read, so one error is enough.
        columns = new Map()
        continue
      }
      columns = header
      continue
    }

    if (columns.size === 0) continue
    if (!cells) {
      errors.push({ line: lineNumber, error: 'unreadable-line', text: raw })
      continue
    }

    const cellOf = (column: Column): string | undefined => {
      const position = columns?.get(column)
      return position === undefined ? undefined : (cells[position] ?? '')
    }

    const choice = parseChoice(cellOf('choice') ?? '')
    if (choice === null) continue
    if (choice === 'unknown') {
      errors.push({ line: lineNumber, error: 'unknown-choice', text: raw })
      continue
    }

    const field = parseField(cellOf('field') ?? '')
    if (field === 'unknown') {
      errors.push({ line: lineNumber, error: 'unknown-field', text: raw })
      continue
    }

    const path = cellOf('path') ?? ''
    if (path.trim() === '') {
      errors.push({ line: lineNumber, error: 'unreadable-line', text: raw })
      continue
    }

    const configuration = (cellOf('configuration') ?? '').trim()
    lines.push({
      line: lineNumber,
      path,
      configuration: configuration === '' ? null : configuration,
      field,
      databaseValue: cellOf('databaseValue'),
      fileValue: cellOf('fileValue'),
      choice,
    })
  }

  if (!columns && errors.length === 0) {
    errors.push({ line: 1, error: 'no-header', text: rawLines[0] ?? '' })
  }

  return { lines, errors }
}

// ============================================
// Matching
// ============================================

export type ChoiceSkipReason =
  | 'no-such-file'
  | 'ambiguous-file'
  | 'no-such-value'
  | 'value-changed'
  | 'needs-field'
  | 'mixed-choices'
  | 'not-available'

export interface ConflictChoicesPlan {
  bluePlmFileIds: string[]
  fileFindingIds: string[]
  /** Files the plan touches, in either direction, so the caller can clear their other side. */
  touchedFileIds: string[]
  skipped: Array<{ line: number; path: string; reason: ChoiceSkipReason }>
}

export interface ConflictChoiceRules {
  /** Whether "Use BluePLM" may be chosen from this conflict (not held by someone else, and so on). */
  canUseBluePlm: (finding: VaultAuditFinding) => boolean
  /** Whether "Use file" may be chosen for this conflict. */
  canUseFile: (finding: VaultAuditFinding) => boolean
}

/** Lower case, forward slashes, the screen's ` / ` separators folded, no outer slashes. */
export function normalizeChoicePath(path: string): string {
  return path
    .trim()
    .replace(/\\/g, '/')
    .replace(/\s*\/\s*/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase()
}

function sameValue(cell: string | undefined, value: string | null): boolean {
  if (cell === undefined) return true
  const fold = (text: string) => text.replace(/\s+/g, ' ').trim()
  return fold(cell) === fold(value ?? '')
}

interface FileEntry {
  fileId: string
  path: string
  name: string
  findings: VaultAuditFinding[]
}

function resolveFile(
  path: string,
  files: readonly FileEntry[],
  byPath: ReadonlyMap<string, FileEntry>,
): FileEntry | 'none' | 'ambiguous' {
  const wanted = normalizeChoicePath(path)
  const exact = byPath.get(wanted)
  if (exact) return exact

  const candidates = wanted.includes('/')
    ? files.filter((file) => file.path.endsWith(`/${wanted}`) || wanted.endsWith(`/${file.path}`))
    : files.filter((file) => file.name === wanted)
  if (candidates.length === 1) return candidates[0]
  return candidates.length === 0 ? 'none' : 'ambiguous'
}

function findConflict(
  file: FileEntry,
  field: OwnedField,
  configuration: string | null,
): VaultAuditFinding | null {
  const sameField = file.findings.filter((finding) => finding.field === field)
  const exact = sameField.filter((finding) => (finding.configuration ?? null) === configuration)
  if (exact.length === 1) return exact[0]
  if (configuration === null) return null
  const folded = sameField.filter(
    (finding) => finding.configuration?.toLowerCase() === configuration.toLowerCase(),
  )
  return folded.length === 1 ? folded[0] : null
}

/** Turn pasted lines into the selections they mean, and say why every other line was skipped. */
export function planConflictChoices(
  lines: readonly ParsedChoiceLine[],
  findings: readonly VaultAuditFinding[],
  rules: ConflictChoiceRules,
): ConflictChoicesPlan {
  const files = new Map<string, FileEntry>()
  for (const finding of findings) {
    if (finding.resolution !== 'choose-a-side') continue
    let entry = files.get(finding.fileId)
    if (!entry) {
      entry = {
        fileId: finding.fileId,
        path: normalizeChoicePath(finding.relativePath),
        name: finding.fileName.toLowerCase(),
        findings: [],
      }
      files.set(finding.fileId, entry)
    }
    entry.findings.push(finding)
  }
  const fileList = [...files.values()]
  const byPath = new Map<string, FileEntry>()
  for (const file of fileList) if (!byPath.has(file.path)) byPath.set(file.path, file)

  const skipped: ConflictChoicesPlan['skipped'] = []
  // Per file, the lines that survived matching and what each one picked.
  const accepted = new Map<
    string,
    Array<{ line: ParsedChoiceLine; finding: VaultAuditFinding | null }>
  >()

  for (const line of lines) {
    const skip = (reason: ChoiceSkipReason) =>
      skipped.push({ line: line.line, path: line.path, reason })

    const file = resolveFile(line.path, fileList, byPath)
    if (file === 'none') {
      skip('no-such-file')
      continue
    }
    if (file === 'ambiguous') {
      skip('ambiguous-file')
      continue
    }

    let finding: VaultAuditFinding | null = null
    if (line.field === null) {
      if (line.choice === 'file') {
        skip('needs-field')
        continue
      }
    } else {
      finding = findConflict(file, line.field, line.configuration)
      if (!finding) {
        skip('no-such-value')
        continue
      }
      if (
        !sameValue(line.databaseValue, finding.databaseValue) ||
        !sameValue(line.fileValue, finding.fileValue)
      ) {
        skip('value-changed')
        continue
      }
    }

    const list = accepted.get(file.fileId) ?? []
    list.push({ line, finding })
    accepted.set(file.fileId, list)
  }

  const bluePlmFileIds: string[] = []
  const fileFindingIds: string[] = []
  const touchedFileIds: string[] = []

  for (const [fileId, entries] of accepted) {
    const file = files.get(fileId)
    if (!file) continue
    const choices = new Set(entries.map((entry) => entry.line.choice))
    if (choices.size > 1) {
      for (const entry of entries) {
        skipped.push({ line: entry.line.line, path: entry.line.path, reason: 'mixed-choices' })
      }
      continue
    }

    if (choices.has('blueplm')) {
      if (!file.findings.some(rules.canUseBluePlm)) {
        for (const entry of entries) {
          skipped.push({ line: entry.line.line, path: entry.line.path, reason: 'not-available' })
        }
        continue
      }
      bluePlmFileIds.push(fileId)
      touchedFileIds.push(fileId)
      continue
    }

    let any = false
    for (const entry of entries) {
      if (entry.finding && rules.canUseFile(entry.finding)) {
        if (!fileFindingIds.includes(entry.finding.id)) fileFindingIds.push(entry.finding.id)
        any = true
      } else {
        skipped.push({ line: entry.line.line, path: entry.line.path, reason: 'not-available' })
      }
    }
    if (any) touchedFileIds.push(fileId)
  }

  skipped.sort((a, b) => a.line - b.line)
  return { bluePlmFileIds, fileFindingIds, touchedFileIds, skipped }
}
