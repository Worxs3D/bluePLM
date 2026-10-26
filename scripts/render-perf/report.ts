/**
 * Compare a render-performance result with the history kept on the `perf-results` branch and
 * write the summary table. Exits 1 when a large change is found (the nightly shows red; nothing
 * is blocked), 0 otherwise.
 *
 *   npx tsx scripts/render-perf/report.ts --result perf-out/result.json --history <dir> --summary perf-out/summary.md
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { compare, markdownTable, type RenderPerfResult } from './compare'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const resultPath = arg('result') ?? 'perf-out/result.json'
const historyDir = arg('history')
const summaryPath = arg('summary') ?? 'perf-out/summary.md'

const current = JSON.parse(readFileSync(resultPath, 'utf8')) as RenderPerfResult & {
  unmodelled?: Array<[string, number]>
  topSelfTime?: Record<string, Array<[string, number]>>
  heapByStep?: Record<string, number>
  retained?: Array<{ stack: string; MB: number }>
}
const history: RenderPerfResult[] =
  historyDir && existsSync(historyDir)
    ? readdirSync(historyDir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => JSON.parse(readFileSync(join(historyDir, f), 'utf8')) as RenderPerfResult)
    : []

const comparison = compare(current, history)
let summary = markdownTable(comparison, current)
if (current.topSelfTime && Object.keys(current.topSelfTime).length) {
  summary += '\n\n<details><summary>Where the main thread went (self time by trace event, first repetition)</summary>\n'
  for (const [scenario, top] of Object.entries(current.topSelfTime)) {
    summary += `\n**${scenario}**: ${top.map(([name, ms]) => `${name} ${Math.round(ms)} ms`).join(', ')}\n`
  }
  summary += '\n</details>'
}
if (current.retained?.length) {
  const steps = Object.entries(current.heapByStep ?? {})
    .sort((a, b) => b[1] - a[1])
    .map(([step, mb]) => `${step} ${mb} MB`)
    .join(', ')
  summary +=
    '\n\n<details><summary>Long session: what holds the heap</summary>\n\n' +
    (steps ? `Retained per step (every 10th cycle, after a forced GC): ${steps}\n\n` : '') +
    'Live at the end, by allocation stack (sampling heap profile, innermost first):\n\n' +
    current.retained.map((r) => `- ${r.MB} MB: \`${r.stack}\``).join('\n') +
    '\n\n</details>'
}
if (current.unmodelled?.length) {
  summary +=
    '\n\n<details><summary>Calls the perf boot answered inertly (top 20)</summary>\n\n' +
    current.unmodelled
      .slice(0, 20)
      .map(([call, n]) => `- \`${call.replace(/\s+/g, ' ').slice(0, 160)}\` x${n}`)
      .join('\n') +
    '\n\n</details>'
}
writeFileSync(summaryPath, summary + '\n')
process.stdout.write(summary + '\n')
process.exit(comparison.failed ? 1 : 0)
