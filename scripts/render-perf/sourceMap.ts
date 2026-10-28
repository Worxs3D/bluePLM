/**
 * Resolve a position in a built file to its source, from the file's source map (v3). Enough of the
 * format for the perf build's maps, so the runner can name the code a heap profile points at
 * without adding a dependency.
 */

export interface RawSourceMap {
  version: number
  sources: string[]
  names?: string[]
  mappings: string
  sourceRoot?: string
}

export interface OriginalPosition {
  source: string
  /** 1-based. */
  line: number
  /** 0-based. */
  column: number
  name: string | null
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const DIGIT = new Map([...BASE64].map((c, i) => [c, i]))

/** Base64 VLQ values of one segment. */
export function decodeSegment(segment: string): number[] {
  const values: number[] = []
  let value = 0
  let shift = 0
  for (const ch of segment) {
    const digit = DIGIT.get(ch)
    if (digit === undefined) throw new Error(`source map: bad VLQ character '${ch}'`)
    value += (digit & 31) << shift
    if (digit & 32) {
      shift += 5
      continue
    }
    values.push(value & 1 ? -(value >>> 1) : value >>> 1)
    value = 0
    shift = 0
  }
  return values
}

/** [generatedColumn, sourceIndex, originalLine (0-based), originalColumn, nameIndex?] per line. */
type Segment = [number, number, number, number, number | undefined]

export class SourceMapLookup {
  private readonly lines: Segment[][] = []

  constructor(private readonly map: RawSourceMap) {
    let source = 0
    let line = 0
    let column = 0
    let name = 0
    for (const text of map.mappings.split(';')) {
      const segments: Segment[] = []
      let generated = 0
      for (const raw of text.split(',')) {
        if (!raw) continue
        const v = decodeSegment(raw)
        generated += v[0]
        if (v.length < 4) continue
        source += v[1]
        line += v[2]
        column += v[3]
        let nameIndex: number | undefined
        if (v.length >= 5) {
          name += v[4]
          nameIndex = name
        }
        segments.push([generated, source, line, column, nameIndex])
      }
      this.lines.push(segments)
    }
  }

  /** `line` 1-based, `column` 0-based, as in a stack trace. Null when nothing maps there. */
  lookup(line: number, column: number): OriginalPosition | null {
    const segments = this.lines[line - 1]
    if (!segments?.length) return null
    let lo = 0
    let hi = segments.length - 1
    let found = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (segments[mid][0] <= column) {
        found = mid
        lo = mid + 1
      } else {
        hi = mid - 1
      }
    }
    if (found < 0) return null
    const [, source, origLine, origColumn, nameIndex] = segments[found]
    return {
      source: (this.map.sourceRoot ?? '') + this.map.sources[source],
      line: origLine + 1,
      column: origColumn,
      name: nameIndex === undefined ? null : (this.map.names?.[nameIndex] ?? null),
    }
  }
}
