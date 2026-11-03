#!/usr/bin/env node
// Runs before `npm run dev` (the `predev` hook). Brings this checkout up to date with origin/main so a
// dev session sees work other sessions have landed, and lists recent worktrees whose work has not
// landed yet (that work cannot reach this checkout until it is merged to main).
//
// It never blocks dev: every failure is reported and the script exits 0. It only fast-forwards, so it
// cannot create a merge or touch uncommitted edits (git refuses a fast-forward that would overwrite
// them). Set BLUEPLM_DEV_NO_SYNC=1 to skip it.

import { execFileSync, spawnSync } from 'node:child_process'
import path from 'node:path'

const RECENT_DAYS = 14

if (process.env.BLUEPLM_DEV_NO_SYNC === '1') process.exit(0)

const git = (args, cwd) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

const tryGit = (args, cwd) => {
  try {
    return git(args, cwd)
  } catch {
    return null
  }
}

function syncMain() {
  const branch = tryGit(['rev-parse', '--abbrev-ref', 'HEAD'])
  if (branch !== 'main') {
    console.log(`[dev-sync] on '${branch}', not main: not pulling`)
    return
  }
  if (tryGit(['fetch', '--quiet', 'origin', 'main']) === null) {
    console.log('[dev-sync] fetch failed (offline?): running with the local main')
    return
  }
  const before = git(['rev-parse', 'HEAD'])
  const behind = Number(tryGit(['rev-list', '--count', 'HEAD..origin/main']) ?? 0)
  if (behind === 0) {
    console.log('[dev-sync] main is up to date with origin')
    return
  }
  try {
    git(['merge', '--ff-only', '--quiet', 'origin/main'])
  } catch (err) {
    const detail = String(err.stderr ?? err.message).split('\n').slice(0, 6).join('\n')
    console.log(`[dev-sync] origin/main is ${behind} commit(s) ahead but could not fast-forward:\n${detail}`)
    return
  }
  console.log(`[dev-sync] pulled ${behind} commit(s) from origin/main`)
  const changed = git(['diff', '--name-only', before, 'HEAD']).split('\n')
  if (changed.includes('package-lock.json')) {
    console.log('[dev-sync] package-lock.json changed: running npm install')
    spawnSync('npm', ['install', '--no-audit', '--no-fund'], { stdio: 'inherit', shell: true })
  }
}

function reportUnlandedWorktrees() {
  const list = tryGit(['worktree', 'list', '--porcelain'])
  if (!list) return
  const root = path.resolve(git(['rev-parse', '--show-toplevel']))
  const worktreesDir = path.join(root, '.claude', 'worktrees')
  const cutoff = Date.now() / 1000 - RECENT_DAYS * 86400
  const rows = []
  for (const block of list.split(/\n\n+/)) {
    const wt = block.match(/^worktree (.+)$/m)?.[1]
    if (!wt || !path.resolve(wt).startsWith(worktreesDir)) continue
    const head = block.match(/^HEAD (\w+)$/m)?.[1]
    const branch = block.match(/^branch refs\/heads\/(.+)$/m)?.[1] ?? 'detached'
    if (!head) continue
    const when = Number(tryGit(['log', '-1', '--format=%ct', head]) ?? 0)
    const dirty = (tryGit(['status', '--porcelain'], wt) ?? '').length > 0
    if (when < cutoff && !dirty) continue
    const ahead = Number(tryGit(['rev-list', '--count', `main..${head}`]) ?? 0)
    if (ahead === 0 && !dirty) continue
    const parts = []
    if (ahead > 0) parts.push(`${ahead} commit(s) not on main`)
    if (dirty) parts.push('uncommitted edits')
    rows.push(`  ${path.basename(wt)} [${branch}]: ${parts.join(', ')}`)
  }
  if (rows.length > 0) {
    console.log('[dev-sync] not in this dev build yet (not landed on main):')
    for (const row of rows) console.log(row)
  }
}

try {
  syncMain()
  reportUnlandedWorktrees()
} catch (err) {
  console.log(`[dev-sync] skipped: ${err.message}`)
}
process.exit(0)
