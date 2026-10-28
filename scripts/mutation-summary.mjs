// Merges the per-shard Stryker JSON reports from .github/workflows/nightly.yml into one report and
// writes what a reader needs from it:
//   reports/mutation/summary.md     job summary: score per target and per file, worst survivors
//   reports/mutation/survivors.json every surviving mutant with its original code (for triage)
//   reports/mutation/mutation.json  the merged report (mutation-testing-report-schema)
//   reports/mutation/index.html     the merged report as a self-contained HTML page
//
// Usage: node scripts/mutation-summary.mjs [reports/mutation]
// Reads every <dir>/<shard>/mutation.json. Reporting only; it never fails on a low score.
/* global process, console */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const root = process.argv[2] ?? 'reports/mutation'

// The targets the ratchet is proposed against (.cursor/plans/test-mutation-report.md). A file
// belongs to the first prefix it starts with.
const TARGETS = [
  'src/lib/metadata/',
  'src/lib/supabase/files/',
  'src/hooks/useLoadFiles/',
  'src/lib/commands/handlers/',
  'src/lib/realign/',
  'src/lib/vaultTransfer/',
  'src/stores/slices/filesSlice.ts',
  'electron/handlers/fs.ts',
  'electron/handlers/solidworks.ts',
  'api/routes/',
  'src/hooks/useRealtimeSubscriptions.ts',
  'src/hooks/realtimeLocalWrites.ts',
  'src/stores/serverLocationUpdate.ts',
  'src/stores/serverPdmUpdate.ts',
]

const shards = existsSync(root)
  ? readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(root, d.name, 'mutation.json')))
      .map((d) => d.name)
      .sort()
  : []
if (shards.length === 0) {
  writeFileSync(join(root, 'summary.md'), '## Mutation testing\n\nNo shard reports found.\n')
  console.log('No shard reports found under', root)
  process.exit(0)
}

/** @type {{ schemaVersion: string, thresholds: object, files: Record<string, any>, config?: object }} */
let merged
for (const shard of shards) {
  const report = JSON.parse(readFileSync(join(root, shard, 'mutation.json'), 'utf8'))
  if (!merged) merged = { ...report, files: {} }
  for (const [name, data] of Object.entries(report.files)) {
    const file = name.replace(/\\/g, '/')
    // A file split across shards by line range arrives once per shard, each with its own mutants.
    const seen = merged.files[file]
    merged.files[file] = seen ? { ...seen, mutants: [...seen.mutants, ...data.mutants] } : data
  }
}

function emptyCounts() {
  return { killed: 0, timeout: 0, survived: 0, noCoverage: 0, ignored: 0, errors: 0 }
}
function add(counts, status) {
  if (status === 'Killed') counts.killed++
  else if (status === 'Timeout') counts.timeout++
  else if (status === 'Survived') counts.survived++
  else if (status === 'NoCoverage') counts.noCoverage++
  else if (status === 'Ignored') counts.ignored++
  else counts.errors++
}
function detected(c) {
  return c.killed + c.timeout
}
function valid(c) {
  return detected(c) + c.survived + c.noCoverage
}
/** Mutation score: detected / (detected + survived + no coverage). */
function score(c) {
  return valid(c) === 0 ? null : (100 * detected(c)) / valid(c)
}
/** Covered score: the same over mutants some test executed. Separates "untested" from "tested weakly". */
function coveredScore(c) {
  const covered = detected(c) + c.survived
  return covered === 0 ? null : (100 * detected(c)) / covered
}
function pct(n) {
  return n === null ? 'n/a' : `${n.toFixed(1)}%`
}

function originalText(source, location) {
  const lines = source.split('\n')
  const { start, end } = location
  if (start.line === end.line) return lines[start.line - 1]?.slice(start.column - 1, end.column - 1) ?? ''
  const first = lines[start.line - 1]?.slice(start.column - 1) ?? ''
  return `${first} …`
}
function oneLine(text, max = 80) {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

const total = emptyCounts()
const byTarget = new Map(TARGETS.map((t) => [t, emptyCounts()]))
const byFile = []
const survivors = []
for (const [file, data] of Object.entries(merged.files)) {
  const counts = emptyCounts()
  for (const mutant of data.mutants) {
    add(counts, mutant.status)
    if (mutant.status === 'Survived' || mutant.status === 'NoCoverage') {
      survivors.push({
        file,
        line: mutant.location.start.line,
        status: mutant.status,
        mutator: mutant.mutatorName,
        original: oneLine(originalText(data.source, mutant.location), 200),
        replacement: oneLine(mutant.replacement ?? '', 200),
        coveredBy: mutant.coveredBy?.length ?? 0,
      })
    }
  }
  for (const k of Object.keys(total)) total[k] += counts[k]
  const target = TARGETS.find((t) => file.startsWith(t))
  if (target) for (const k of Object.keys(counts)) byTarget.get(target)[k] += counts[k]
  byFile.push({ file, counts })
}

const row = (name, c) =>
  `| ${name} | ${pct(score(c))} | ${pct(coveredScore(c))} | ${c.killed} | ${c.timeout} | ${c.survived} | ${c.noCoverage} | ${c.ignored} |`
const header = [
  '| | Score | Covered score | Killed | Timeout | Survived | No coverage | Ignored |',
  '|---|---|---|---|---|---|---|---|',
]

const md = [
  '## Mutation testing (not gated)',
  '',
  `Shards: ${shards.join(', ')}. Score = (killed + timeout) / (killed + timeout + survived + no coverage).`,
  'Covered score leaves out mutants no test executes. Full report: the `mutation-report` artifact (`index.html`).',
  '',
  '### By target',
  '',
  ...header,
  ...TARGETS.filter((t) => valid(byTarget.get(t)) > 0).map((t) => row(`\`${t}\``, byTarget.get(t))),
  row('**Total**', total),
  '',
  '### By file (lowest score first)',
  '',
  ...header,
  ...byFile
    .filter((f) => valid(f.counts) > 0)
    .sort((a, b) => score(a.counts) - score(b.counts) || valid(b.counts) - valid(a.counts))
    .map((f) => row(`\`${f.file}\``, f.counts)),
  '',
]

// Survivors a test executed are the interesting ones: the line runs and nothing notices the change.
// The summary shows the first few per file, worst files first; survivors.json has all of them.
const SURVIVORS_PER_FILE = 8
const covered = survivors.filter((s) => s.status === 'Survived')
const perFile = new Map()
for (const s of covered) perFile.set(s.file, [...(perFile.get(s.file) ?? []), s])
md.push(`### Surviving mutants (${covered.length} covered survivors; up to ${SURVIVORS_PER_FILE} per file)`, '')
for (const [file, list] of [...perFile.entries()].sort((a, b) => b[1].length - a[1].length)) {
  md.push(`<details><summary><code>${file}</code>: ${list.length}</summary>`, '', '| Line | Mutator | Original | Mutant |', '|---|---|---|---|')
  for (const s of list.slice(0, SURVIVORS_PER_FILE)) {
    const cell = (t) => `\`${oneLine(t, 70).replace(/\|/g, '\\|').replace(/`/g, "'")}\``
    md.push(`| ${s.line} | ${s.mutator} | ${cell(s.original)} | ${cell(s.replacement)} |`)
  }
  md.push('', '</details>', '')
}

let summary = md.join('\n')
// GitHub caps a step summary at 1 MiB.
if (summary.length > 900_000) summary = `${summary.slice(0, 900_000)}\n\n…truncated; see the artifact.\n`
writeFileSync(join(root, 'summary.md'), summary)
writeFileSync(join(root, 'survivors.json'), JSON.stringify(survivors, null, 1))
writeFileSync(join(root, 'mutation.json'), JSON.stringify(merged))

const require = createRequire(import.meta.url)
const elements = readFileSync(require.resolve('mutation-testing-elements/dist/mutation-test-elements.js'), 'utf8')
const json = JSON.stringify(merged).replace(/</g, '\\u003c')
writeFileSync(
  join(root, 'index.html'),
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>BluePLM mutation report</title>
<script>${elements.replace(/<\/script/gi, '<\\/script')}</script></head>
<body><mutation-test-report-app title-postfix="BluePLM"></mutation-test-report-app>
<script>document.querySelector('mutation-test-report-app').report = ${json};</script></body></html>\n`,
)

console.log(`Mutation score ${pct(score(total))} over ${valid(total)} mutants; ${covered.length} covered survivors.`)
// The job log is what a reader without artifact access (the nightly maintainer routine) can see:
// the files with the most covered survivors, and the lines they are on.
const LOGGED_FILES = 40
console.log(`Covered survivors by file (top ${LOGGED_FILES}): file, count, lines`)
for (const [file, list] of [...perFile.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, LOGGED_FILES)) {
  const lines = [...new Set(list.map((s) => s.line))].sort((a, b) => a - b)
  console.log(`  ${file}  ${list.length}  ${lines.join(',')}`)
}
