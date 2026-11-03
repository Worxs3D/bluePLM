/**
 * Export file names from the organization's filename pattern (Settings > Export,
 * `export_settings.filename_pattern`), as the SOLIDWORKS service names its exports
 * (`FormatExportFilename`): tokens are replaced case-insensitively, characters Windows refuses in
 * a file name become `_`, and the extension is added. Pure, so the settings preview, saved copies
 * of version outputs and tests all name files the same way.
 *
 * One difference from the service: a token with no value takes one separator next to it along,
 * so `{filename}_{config}` names a drawing PDF `Part1.pdf`, not `Part1_.pdf`.
 */

/** The values a pattern can use. Missing or blank values are dropped with their separator. */
export interface OutputNameValues {
  filename?: string | null
  config?: string | null
  partNumber?: string | null
  tab?: string | null
  revision?: string | null
  description?: string | null
  /** The date and time `{date}`, `{time}` and `{datetime}` show; default now. */
  now?: Date
}

/** Tokens in the order the settings page lists them, with the value each one reads. */
export const OUTPUT_NAME_TOKENS = [
  '{filename}',
  '{config}',
  '{partNumber}',
  '{number}',
  '{tab}',
  '{tabNumber}',
  '{revision}',
  '{rev}',
  '{description}',
  '{desc}',
  '{date}',
  '{time}',
  '{datetime}',
] as const

export type OutputNameToken = (typeof OUTPUT_NAME_TOKENS)[number]

/** The sample values the settings page previews a pattern with. */
export const SAMPLE_OUTPUT_NAME_VALUES: OutputNameValues = {
  filename: 'Part1',
  config: 'Config-A',
  partNumber: 'BR-101011',
  tab: '394',
  revision: 'A',
  description: 'Thruster',
  now: new Date(2026, 0, 1, 14, 30, 0),
}

const pad = (n: number) => String(n).padStart(2, '0')

function tokenValue(token: string, values: OutputNameValues): string {
  const now = values.now ?? new Date()
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  const time = `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`
  switch (token.toLowerCase()) {
    case '{filename}':
      return values.filename?.trim() ?? ''
    case '{config}':
      return values.config?.trim() ?? ''
    case '{partnumber}':
    case '{number}':
      return values.partNumber?.trim() ?? ''
    case '{tab}':
    case '{tabnumber}':
      return values.tab?.trim() ?? ''
    case '{revision}':
    case '{rev}':
      return values.revision?.trim() ?? ''
    case '{description}':
    case '{desc}':
      return values.description?.trim() ?? ''
    case '{date}':
      return date
    case '{time}':
      return time
    case '{datetime}':
      return `${date}_${time}`
    default:
      return token
  }
}

const TOKEN_RE = new RegExp(
  OUTPUT_NAME_TOKENS.map((t) => t.replace(/[{}]/g, '\\$&')).join('|'),
  'gi',
)
const SEPARATOR = /[_\-. ]/
// Path.GetInvalidFileNameChars() on Windows: control characters and these.
// eslint-disable-next-line no-control-regex
const INVALID_FILE_NAME_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g

/** The longest base name (before the extension) an output file name gets. */
export const OUTPUT_NAME_MAX_BASE = 150

/** The extension with its dot, lower case: `step` and `.STEP` both give `.step`. */
export function normalizeExtension(extension: string): string {
  const e = extension.trim().replace(/^\.+/, '').toLowerCase()
  return e ? `.${e}` : ''
}

/** The pattern with its tokens replaced; no sanitizing, no extension. */
export function applyOutputNamePattern(pattern: string, values: OutputNameValues): string {
  let out = ''
  let last = 0
  for (const match of pattern.matchAll(TOKEN_RE)) {
    const start = match.index ?? 0
    const value = tokenValue(match[0], values)
    let literal = pattern.slice(last, start)
    last = start + match[0].length
    if (value === '') {
      // Drop one separator with the empty token: the one before it, else the one after it.
      if (literal.length > 0 && SEPARATOR.test(literal[literal.length - 1])) {
        literal = literal.slice(0, -1)
      } else if (SEPARATOR.test(pattern[last] ?? '')) {
        last += 1
      }
    }
    out += literal + value
  }
  return out + pattern.slice(last)
}

/**
 * The file name an export gets: the pattern applied, invalid characters replaced, the extension
 * added unless the name already ends with it. Falls back to `{filename}` when the pattern gives
 * nothing, and to `output` when that is blank too. The base is cut to `OUTPUT_NAME_MAX_BASE`
 * characters, so a long description cannot make a path Windows refuses.
 */
export function outputFileName(
  pattern: string | null | undefined,
  values: OutputNameValues,
  extension: string,
): string {
  const ext = normalizeExtension(extension)
  const clean = (s: string) => s.replace(INVALID_FILE_NAME_CHARS, '_').trim().replace(/[. ]+$/, '')
  let base = clean(applyOutputNamePattern(pattern?.trim() || '{filename}', values))
  if (ext && base.toLowerCase().endsWith(ext)) base = base.slice(0, -ext.length)
  if (!base) base = clean(values.filename ?? '') || 'output'
  if (base.length > OUTPUT_NAME_MAX_BASE) base = clean(base.slice(0, OUTPUT_NAME_MAX_BASE)) || 'output'
  return `${base}${ext}`
}

/** The file name without its folder and extension (`a/b/Part1.SLDPRT` gives `Part1`). */
export function baseNameOf(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? path
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}
