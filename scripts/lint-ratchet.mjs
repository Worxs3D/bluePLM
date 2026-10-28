// Lint ratchet: fails when ESLint reports more errors than scripts/lint-baseline.json allows.
//
// `npm run lint` has a backlog of pre-existing errors, so a blocking `eslint .` would fail on its
// first run and be switched off. Leaving it non-blocking let the count grow unseen. This holds the
// line instead: the backlog may shrink, never grow. When it shrinks, lower `errors` in the
// baseline in the same commit so the gain cannot be spent again.
//
//   node scripts/lint-ratchet.mjs
import { readFileSync, appendFileSync } from 'node:fs'
import process from 'node:process'
import { URL } from 'node:url'
import { ESLint } from 'eslint'

const baselinePath = new URL('./lint-baseline.json', import.meta.url)
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'))

const results = await new ESLint().lintFiles(['.'])
const errors = results.reduce((sum, r) => sum + r.errorCount, 0)
const warnings = results.reduce((sum, r) => sum + r.warningCount, 0)

const byRule = new Map()
for (const result of results) {
  for (const message of result.messages) {
    if (message.severity !== 2) continue
    const rule = message.ruleId ?? '(parse error)'
    byRule.set(rule, (byRule.get(rule) ?? 0) + 1)
  }
}
const ruleLines = [...byRule.entries()]
  .sort((a, b) => b[1] - a[1])
  .map(([rule, count]) => `| ${rule} | ${count} |`)

let verdict
if (errors > baseline.errors) {
  verdict = `FAIL: ${errors} lint errors, baseline allows ${baseline.errors}. Fix the new ones (run \`npm run lint\`); do not raise the baseline.`
} else if (errors < baseline.errors) {
  verdict = `OK: ${errors} lint errors, below the baseline of ${baseline.errors}. Lower \`errors\` in scripts/lint-baseline.json to ${errors}.`
} else {
  verdict = `OK: ${errors} lint errors, at the baseline.`
}

const summary = [
  '## Lint ratchet',
  '',
  verdict,
  '',
  `${errors} errors, ${warnings} warnings (warnings are not ratcheted).`,
  '',
  '| Rule | Errors |',
  '|---|---|',
  ...ruleLines,
  '',
].join('\n')

process.stdout.write(summary)
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary)

if (errors > baseline.errors) {
  // Name the files carrying errors so the new ones can be found without a second run.
  const formatter = await new ESLint().loadFormatter('stylish')
  process.stdout.write(await formatter.format(results.filter((r) => r.errorCount > 0).map((r) => ({
    ...r,
    messages: r.messages.filter((m) => m.severity === 2),
    warningCount: 0,
    fixableWarningCount: 0,
  }))))
  process.exit(1)
}
