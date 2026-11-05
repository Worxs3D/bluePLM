#!/usr/bin/env node
// Concurrency on real Postgres: what PGlite's single connection cannot show.
//
//   DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/postgres node scripts/sql-concurrency.mjs [--apply-migrations]
//
// Run by verify.yml's sql-concurrency job against the harness (harness/docker-compose.yml) after
// the 5.0 baseline is installed. --apply-migrations first applies every numbered migration above
// the database's schema_release_version() (each in its own transaction, as the app's runner does)
// and requires verify_and_stamp_schema() to stamp with no problems.
//
// Then, in a throwaway organization (removed at the end):
//   1. Order numbers (supply_order_create, schema 513): several connections create orders at the
//      same moment, first all blocked behind one transaction holding the organization's counter row
//      (so they really contend), then freely in parallel. The numbers must be unique and gap-free,
//      and the counter must equal the highest.
//   2. Output requests (version_output_request_claim, schema 515): several workers claim at once
//      (some one at a time, some several), touching each claim, each claim held open for a moment so
//      the transactions overlap. No request may be claimed twice, and every one must be claimed. Then
//      every worker hands one of its claims back (version_output_request_release) and all claim
//      again at once: each released request is claimed exactly once more, on its second attempt.
//
// Exit 0 = every check passed, 1 = a check failed, 2 = could not connect or apply.
import { randomUUID } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import pg from 'pg'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MIGRATIONS = resolve(ROOT, 'supabase', 'migrations')
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:55432/postgres'
const APPLY = process.argv.includes('--apply-migrations')

const WORKERS = 8
const ORDERS_PER_WORKER = 20
const REQUEST_FILES = 20 // x 3 kinds = 60 requests
// Even workers claim several at a time, odd ones one at a time (as the desktop worker does).
const claimLimit = (i) => (i % 2 === 0 ? 4 : 1)

const failures = []
function check(ok, what) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
  if (!ok) failures.push(what)
}

async function connect() {
  const client = new pg.Client({ connectionString: DATABASE_URL })
  await client.connect()
  return client
}

/** A connection acting as a signed-in user (the authenticated role, auth.uid() = id). */
async function connectAs(userId) {
  const c = await connect()
  await c.query('SET ROLE authenticated')
  await c.query(
    `SELECT set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claims', $2, false)`,
    [userId, JSON.stringify({ sub: userId, role: 'authenticated' })],
  )
  return c
}

async function applyMigrations(owner) {
  const current = (await owner.query('SELECT schema_release_version() AS v')).rows[0].v
  const files = readdirSync(MIGRATIONS)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f) && Number(f.slice(0, 4)) > Math.max(500, current))
    .sort()
  console.log(`schema ${current}; applying ${files.length} migration(s)`)
  for (const f of files) {
    const sql = readFileSync(resolve(MIGRATIONS, f), 'utf8')
    const noTransaction = sql.startsWith('-- blueplm:no-transaction')
    try {
      if (!noTransaction) await owner.query('BEGIN')
      await owner.query(sql)
      if (!noTransaction) await owner.query('COMMIT')
      console.log(`  applied ${f}`)
    } catch (e) {
      if (!noTransaction) await owner.query('ROLLBACK').catch(() => {})
      throw new Error(`${f}: ${e.message}`)
    }
  }
  const v = (await owner.query('SELECT verify_and_stamp_schema() AS v')).rows[0].v
  const problems = Array.isArray(v?.problems) ? v.problems : []
  for (const p of problems) console.log(`  problem: ${JSON.stringify(p)}`)
  check(v?.stamped === true && problems.length === 0, `migrations verify and stamp ${v?.version}`)
}

async function seed(owner, ids) {
  const { org, vault, users, files, versions, suffix } = ids
  await owner.query('BEGIN')
  for (const [i, u] of users.entries()) {
    await owner.query(
      `INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
      [u, `race-${i}-${suffix}@concurrency.test`],
    )
  }
  await owner.query(`INSERT INTO organization (id, name, slug) VALUES ($1, 'Concurrency', $2)`, [org, `race-${suffix}`])
  for (const [i, u] of users.entries()) {
    await owner.query(
      `INSERT INTO app_user (id, email, org_id, role) VALUES ($1, $2, $3, 'admin')
       ON CONFLICT (id) DO UPDATE SET org_id = EXCLUDED.org_id, role = EXCLUDED.role`,
      [u, `race-${i}-${suffix}@concurrency.test`, org],
    )
  }
  await owner.query(`INSERT INTO vault (id, org_id, name, slug, created_by) VALUES ($1, $2, 'Race', $3, $4)`, [
    vault,
    org,
    `race-${suffix}`,
    users[0],
  ])
  for (let i = 0; i < files.length; i++) {
    const h = (i + 1).toString(16).padStart(64, '0')
    await owner.query(
      `INSERT INTO file (id, org_id, vault_id, file_path, file_name, extension, content_hash, version, created_by)
       VALUES ($1, $2, $3, $4, $5, '.sldprt', $6, 1, $7)`,
      [files[i], org, vault, `race/p${i}.sldprt`, `p${i}.sldprt`, h, users[0]],
    )
    await owner.query(
      `INSERT INTO file_version (id, file_id, version, revision, content_hash, file_size, created_by)
       VALUES ($1, $2, 1, 'A', $3, 100, $4)`,
      [versions[i], files[i], h, users[0]],
    )
  }
  await owner.query('COMMIT')
}

async function waitForLockWaiters(owner, n) {
  const deadline = Date.now() + 10_000
  for (;;) {
    const r = await owner.query(
      `SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE wait_event_type = 'Lock' AND query LIKE '%supply_order_create%' AND pid <> pg_backend_pid()`,
    )
    if (r.rows[0].n >= n) return r.rows[0].n
    if (Date.now() > deadline) return r.rows[0].n
    await new Promise((res) => setTimeout(res, 50))
  }
}

async function raceNumbering(owner, workers, org) {
  // The counter row exists after the first order.
  await workers[0].query(`SELECT supply_order_create('first')`)

  // 1. Everyone waits behind one transaction holding the counter row, then goes at once.
  const holder = await connect()
  await holder.query('BEGIN')
  await holder.query('SELECT 1 FROM supply_order_number_counter WHERE org_id = $1 FOR UPDATE', [org])
  const blocked = workers.map((w, i) => w.query(`SELECT supply_order_create($1)`, [`blocked ${i}`]))
  const waiting = await waitForLockWaiters(owner, workers.length)
  check(waiting >= workers.length, `${workers.length} creates wait on the counter row (saw ${waiting})`)
  await holder.query('COMMIT')
  await holder.end()
  await Promise.all(blocked)

  // 2. Free-running: every worker creates orders back to back, all workers at once.
  await Promise.all(
    workers.map(async (w, i) => {
      for (let j = 0; j < ORDERS_PER_WORKER; j++) await w.query(`SELECT supply_order_create($1)`, [`w${i} o${j}`])
    }),
  )

  const total = 1 + workers.length + workers.length * ORDERS_PER_WORKER
  const rows = (
    await owner.query('SELECT sequence, order_number FROM supply_order WHERE org_id = $1 ORDER BY sequence', [org])
  ).rows
  const sequences = rows.map((r) => r.sequence)
  check(rows.length === total, `${total} orders created (found ${rows.length})`)
  check(
    sequences.every((s, i) => s === i + 1),
    'order sequences are 1..n with no gap and no repeat',
  )
  check(new Set(rows.map((r) => r.order_number)).size === rows.length, 'order numbers are unique')
  const counter = (await owner.query('SELECT last_sequence FROM supply_order_number_counter WHERE org_id = $1', [org])).rows[0]
  check(counter?.last_sequence === total, `the counter ends at ${total} (is ${counter?.last_sequence})`)
}

async function raceClaims(owner, workers, ids) {
  const items = ids.versions.flatMap((v) => ['step', 'iges', 'stl'].map((kind) => ({ file_version_id: v, kind })))
  const created = (await workers[0].query('SELECT version_output_request_create($1::jsonb) AS r', [JSON.stringify(items)]))
    .rows[0].r
  check(created.created === items.length, `${items.length} output requests created (${created.created})`)

  const claimedBy = new Map() // request id -> worker indexes
  await Promise.all(
    workers.map(async (w, i) => {
      for (;;) {
        await w.query('BEGIN')
        const got = (await w.query('SELECT id FROM version_output_request_claim($1)', [claimLimit(i)])).rows
        for (const r of got) await w.query('SELECT version_output_request_touch($1)', [r.id])
        await w.query('SELECT pg_sleep(0.05)')
        await w.query('COMMIT')
        for (const r of got) claimedBy.set(r.id, [...(claimedBy.get(r.id) ?? []), i])
        if (got.length === 0) break
      }
    }),
  )

  const twice = [...claimedBy.values()].filter((by) => by.length > 1).length
  check(twice === 0, `no request claimed twice (${twice} were)`)
  check(claimedBy.size === items.length, `every request claimed once (${claimedBy.size} of ${items.length})`)
  const workersUsed = new Set([...claimedBy.values()].flat()).size
  console.log(`  ${workersUsed} of ${workers.length} workers claimed requests`)
  const state = (
    await owner.query(
      `SELECT status, count(*)::int AS n FROM version_output_request WHERE org_id = $1 GROUP BY status ORDER BY status`,
      [ids.org],
    )
  ).rows
  check(state.length === 1 && state[0].status === 'claimed' && state[0].n === items.length, `all requests are claimed (${JSON.stringify(state)})`)

  // Each worker that holds a claim hands one back, then everyone claims again at once.
  const released = []
  await Promise.all(
    workers.map(async (w, i) => {
      const mine = [...claimedBy.entries()].find(([, by]) => by[0] === i)
      if (!mine) return
      const r = (await w.query('SELECT version_output_request_release($1) AS r', [mine[0]])).rows[0].r
      if (r.changed) released.push(mine[0])
    }),
  )
  check(released.length > 0, `${released.length} claims handed back`)
  const reclaimed = new Map()
  await Promise.all(
    workers.map(async (w, i) => {
      for (;;) {
        await w.query('BEGIN')
        const got = (await w.query('SELECT id, attempts FROM version_output_request_claim($1)', [claimLimit(i)])).rows
        await w.query('SELECT pg_sleep(0.05)')
        await w.query('COMMIT')
        for (const r of got) reclaimed.set(r.id, [...(reclaimed.get(r.id) ?? []), r.attempts])
        if (got.length === 0) break
      }
    }),
  )
  check(
    reclaimed.size === released.length && released.every((id) => reclaimed.get(id)?.length === 1),
    `every handed-back request claimed exactly once more (${reclaimed.size} of ${released.length})`,
  )
  check([...reclaimed.values()].every((a) => a.length === 1 && a[0] === 2), 'each re-claim is the second attempt')
}

/**
 * Best effort, children first: deleting the organization alone trips 0502's realtime tombstones,
 * which insert rows naming the organization being deleted. The harness is thrown away anyway.
 */
async function cleanup(owner, ids) {
  const steps = [
    ['DELETE FROM version_output_request WHERE org_id = $1', [ids.org]],
    ['DELETE FROM supply_order WHERE org_id = $1', [ids.org]],
    ['DELETE FROM file WHERE org_id = $1', [ids.org]],
    ['DELETE FROM vault WHERE org_id = $1', [ids.org]],
    ['DELETE FROM realtime_tombstone WHERE org_id = $1', [ids.org]],
    ['DELETE FROM app_user WHERE id = ANY ($1::uuid[])', [ids.users]],
    ['DELETE FROM auth.users WHERE id = ANY ($1::uuid[])', [ids.users]],
    ['DELETE FROM organization WHERE id = $1', [ids.org]],
  ]
  for (const [sql, params] of steps) {
    await owner.query(sql, params).catch((e) => console.error(`cleanup (${sql}): ${e.message}`))
  }
}

async function main() {
  let owner
  try {
    owner = await connect()
  } catch (e) {
    console.error(`cannot connect: ${e.message}`)
    return 2
  }
  try {
    if (APPLY) {
      try {
        await applyMigrations(owner)
      } catch (e) {
        console.error(`migration failed: ${e.message}`)
        return 2
      }
    }

    const suffix = randomUUID().slice(0, 8)
    const ids = {
      suffix,
      org: randomUUID(),
      vault: randomUUID(),
      users: Array.from({ length: WORKERS }, () => randomUUID()),
      files: Array.from({ length: REQUEST_FILES }, () => randomUUID()),
      versions: Array.from({ length: REQUEST_FILES }, () => randomUUID()),
    }
    await seed(owner, ids)
    const workers = await Promise.all(ids.users.map((u) => connectAs(u)))
    try {
      await raceNumbering(owner, workers, ids.org)
      await raceClaims(owner, workers, ids)
    } finally {
      await Promise.all(workers.map((w) => w.end().catch(() => {})))
      await cleanup(owner, ids)
    }
  } catch (e) {
    console.error(`error: ${e.stack ?? e.message}`)
    failures.push(e.message)
  } finally {
    await owner.end().catch(() => {})
  }
  if (failures.length > 0) {
    console.error(`${failures.length} check(s) failed`)
    return 1
  }
  console.log('all concurrency checks passed')
  return 0
}

process.exit(await main())
