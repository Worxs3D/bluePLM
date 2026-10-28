/**
 * Compare one nightly render-performance result with the last runs on main.
 *
 * Every metric is "lower is better". A metric is flagged only when it moves a lot: more than
 * `ratio` (25%) above the median of the last `window` main runs AND by more than its absolute
 * floor, so a 3 ms task becoming 5 ms is not news. Heap growth over the long session also has a
 * fixed ceiling that applies with or without history. Pure, unit-tested.
 */

export interface MetricSpec {
  key: string
  label: string
  unit: string
  /** Smallest absolute increase worth flagging. */
  floor: number
  /** Fails above this regardless of history. */
  ceiling?: number
}

export const METRICS: MetricSpec[] = [
  { key: 'coldStart.launchToLoadedMs', label: 'Cold start: launch to vault looks loaded', unit: 'ms', floor: 500 },
  { key: 'coldStart.navigationToLoadedMs', label: 'Cold start: page start to vault looks loaded', unit: 'ms', floor: 500 },
  { key: 'coldStart.longTasks', label: 'Cold start: long tasks', unit: '', floor: 3 },
  { key: 'coldStart.totalBlockingMs', label: 'Cold start: total blocking time', unit: 'ms', floor: 200 },
  { key: 'coldStart.scriptingMs', label: 'Cold start: scripting', unit: 'ms', floor: 300 },
  { key: 'coldStart.layoutMs', label: 'Cold start: layout + style', unit: 'ms', floor: 100 },
  { key: 'coldStart.paintMs', label: 'Cold start: paint', unit: 'ms', floor: 100 },
  { key: 'search.settleMs', label: 'Search all 30k: to idle', unit: 'ms', floor: 150 },
  { key: 'search.totalBlockingMs', label: 'Search all 30k: total blocking time', unit: 'ms', floor: 100 },
  { key: 'scroll.p95FrameMs', label: 'Scroll 30k rows: p95 frame', unit: 'ms', floor: 8 },
  { key: 'scroll.droppedFrames', label: 'Scroll 30k rows: dropped frames', unit: '', floor: 30 },
  { key: 'scroll.totalBlockingMs', label: 'Scroll 30k rows: total blocking time', unit: 'ms', floor: 100 },
  { key: 'scroll.scriptingMs', label: 'Scroll 30k rows: scripting', unit: 'ms', floor: 300 },
  { key: 'scroll.layoutMs', label: 'Scroll 30k rows: layout + style', unit: 'ms', floor: 150 },
  { key: 'scroll.paintMs', label: 'Scroll 30k rows: paint', unit: 'ms', floor: 150 },
  { key: 'tree.settleMs', label: 'Expand deep tree: to idle', unit: 'ms', floor: 100 },
  { key: 'tree.totalBlockingMs', label: 'Expand deep tree: total blocking time', unit: 'ms', floor: 100 },
  { key: 'select.medianClickMs', label: 'Select a file: click to idle (median)', unit: 'ms', floor: 30 },
  { key: 'select.totalBlockingMs', label: 'Select files: total blocking time', unit: 'ms', floor: 100 },
  { key: 'realtime.settleMs', label: 'Realtime burst of 500: to idle', unit: 'ms', floor: 150 },
  { key: 'realtime.totalBlockingMs', label: 'Realtime burst of 500: total blocking time', unit: 'ms', floor: 100 },
  { key: 'session.heapGrowthMB', label: 'Long session: heap growth', unit: 'MB', floor: 8, ceiling: 64 },
  { key: 'session.heapSlopeMBPer10Min', label: 'Long session: heap growth rate', unit: 'MB/10 min', floor: 4, ceiling: 16 },
  { key: 'session.totalBlockingMs', label: 'Long session: total blocking time', unit: 'ms', floor: 1000 },
]

export interface RenderPerfResult {
  schema: 1
  sha: string
  ref: string
  runId: string
  date: string
  fileCount: number
  reps: number
  sessionMinutes: number
  /** Medians across repetitions (the long session runs once). */
  metrics: Record<string, number>
  /** The machine it ran on. Hosted runners vary: one commit measured scroll TBT 134 ms and 11.6 s. */
  runner?: { cpu: string; cores: number }
}

/** History runs on the same CPU model needed before the baseline uses only those. */
export const SAME_RUNNER_MIN = 3

export type Status = 'ok' | 'regressed' | 'improved' | 'over-ceiling' | 'no-history' | 'missing'

export interface Row {
  spec: MetricSpec
  current: number | null
  baseline: number | null
  changePct: number | null
  status: Status
}

export interface Comparison {
  rows: Row[]
  failed: boolean
  historyRuns: number
  /** The CPU model the baseline was restricted to, or null when it mixes machines. */
  sameRunner: string | null
}

function medianOf(values: number[]): number | null {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (!v.length) return null
  const mid = Math.floor(v.length / 2)
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2
}

/** `history` in any order; only main runs other than `current` count, newest `window` of them. */
export function compare(
  current: RenderPerfResult,
  history: readonly RenderPerfResult[],
  options: { window?: number; ratio?: number } = {},
): Comparison {
  const window = options.window ?? 7
  const ratio = options.ratio ?? 0.25
  const main = history.filter(
    (h) => h.ref === 'refs/heads/main' && h.runId !== current.runId && h.fileCount === current.fileCount,
  )
  // Compare like with like once there is enough history from this CPU model; until then, all runs.
  const cpu = current.runner?.cpu
  const sameCpu = cpu ? main.filter((h) => h.runner?.cpu === cpu) : []
  const sameRunner = cpu && sameCpu.length >= SAME_RUNNER_MIN ? cpu : null
  const recent = (sameRunner ? sameCpu : main).sort((a, b) => b.date.localeCompare(a.date)).slice(0, window)

  const rows = METRICS.map((spec): Row => {
    const value = current.metrics[spec.key]
    const cur = Number.isFinite(value) ? value : null
    const baseline = medianOf(recent.map((h) => h.metrics[spec.key]).filter((v) => v !== undefined))
    const changePct =
      cur !== null && baseline !== null && baseline > 0 ? Math.round(((cur - baseline) / baseline) * 1000) / 10 : null
    let status: Status
    if (cur === null) status = 'missing'
    else if (spec.ceiling !== undefined && cur > spec.ceiling) status = 'over-ceiling'
    else if (baseline === null) status = 'no-history'
    else if (cur > baseline * (1 + ratio) && cur - baseline > spec.floor) status = 'regressed'
    else if (cur < baseline * (1 - ratio) && baseline - cur > spec.floor) status = 'improved'
    else status = 'ok'
    return { spec, current: cur, baseline, changePct, status }
  })

  return {
    rows,
    failed: rows.some((r) => r.status === 'regressed' || r.status === 'over-ceiling'),
    historyRuns: recent.length,
    sameRunner,
  }
}

const MARK: Record<Status, string> = {
  ok: 'ok',
  regressed: '**REGRESSED**',
  improved: 'improved',
  'over-ceiling': '**OVER CEILING**',
  'no-history': 'no history',
  missing: 'missing',
}

const fmt = (n: number | null, unit: string) => (n === null ? '-' : `${Math.round(n * 10) / 10}${unit ? ` ${unit}` : ''}`)

export function markdownTable(comparison: Comparison, current: RenderPerfResult): string {
  const lines = [
    `### Render performance (${current.fileCount.toLocaleString('en-US')} files, median of ${current.reps}, ${current.sessionMinutes}-min session)`,
    '',
    `Compared with the median of the last ${comparison.historyRuns} main run(s)${comparison.sameRunner ? ` on ${comparison.sameRunner}` : ` (any runner${current.runner ? `; this one: ${current.runner.cpu}, ${current.runner.cores} cores` : ''})`}. Flagged: over 25% and over the metric's floor, or over a fixed ceiling.`,
    '',
    '| Metric | Now | Baseline | Change | Status |',
    '|---|---:|---:|---:|---|',
  ]
  for (const row of comparison.rows) {
    const change = row.changePct === null ? '-' : `${row.changePct > 0 ? '+' : ''}${row.changePct}%`
    const ceiling = row.spec.ceiling !== undefined ? ` (ceiling ${row.spec.ceiling})` : ''
    lines.push(
      `| ${row.spec.label}${ceiling} | ${fmt(row.current, row.spec.unit)} | ${fmt(row.baseline, row.spec.unit)} | ${change} | ${MARK[row.status]} |`,
    )
  }
  lines.push('', comparison.failed ? 'Result: **large change found** (the nightly fails; nothing is blocked).' : 'Result: no large change.')
  return lines.join('\n')
}
