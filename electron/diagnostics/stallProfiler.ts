// Main-process stall profiler.
//
// The renderer cannot profile itself while it is blocked, so the main process keeps a V8 CPU
// profile running in rolling windows through the Chrome DevTools protocol. When the renderer
// reports a stall (`diagnostics:renderer-stall`), the profile that covers the blocked period is
// summarised into the session log and saved as a `.cpuprofile` next to the logs, where it opens
// directly in Chrome DevTools / VS Code.
//
// Everything here fails soft: a diagnostics feature must never throw into the app.
// This module does not import `electron` at runtime so it can be unit tested; the window,
// logs folder and logger are injected by `main.ts`.

import fs from 'fs'
import path from 'path'

// ============================================
// Constants
// ============================================

/** Set to `1` to turn the profiler off entirely (no debugger attach, no overhead). */
export const STALL_PROFILER_DISABLE_ENV = 'BLUEPLM_DISABLE_STALL_PROFILER'
/** IPC channel the renderer uses to report a stall. */
export const RENDERER_STALL_CHANNEL = 'diagnostics:renderer-stall'

const DEBUGGER_PROTOCOL_VERSION = '1.3'
/** V8 sampling interval, in microseconds (10 ms). */
const SAMPLING_INTERVAL_US = 10_000
/** Length of one rolling profile window. */
const PROFILE_WINDOW_MS = 25_000
/** Stalls at or under this are ordinary jank and not worth a profile. */
export const STALL_PROFILE_MIN_DURATION_MS = 2_000
/** After acting on a stall, ignore further notices for this long. */
export const STALL_PROFILE_COOLDOWN_MS = 60_000
/** Number of functions listed in the log summary. */
export const TOP_SELF_FUNCTION_COUNT = 15
/** Newest stall profiles kept on disk. */
export const MAX_STALL_PROFILE_FILES = 3
/** Profiles whose JSON exceeds this are not written. */
export const MAX_STALL_PROFILE_BYTES = 20 * 1024 * 1024
/** Longest `source` string accepted from the renderer. */
export const MAX_STALL_SOURCE_LENGTH = 80
/** Upper bound on a believable stall duration (one day); anything larger is a bad payload. */
const MAX_STALL_DURATION_MS = 24 * 60 * 60 * 1000

const MICROSECONDS_PER_MILLISECOND = 1_000
const PERCENT_SCALE = 100
/** Percentages and milliseconds are logged to one decimal place. */
const DECIMAL_SCALE = 10

const STALL_PROFILE_FILE_PREFIX = 'stall-'
const STALL_PROFILE_FILE_SUFFIX = '.cpuprofile'
const STALL_PROFILE_FILE_PATTERN = /^stall-.*\.cpuprofile$/

const ROOT_NODE_NAME = '(root)'
const PROGRAM_NODE_NAME = '(program)'
const IDLE_NODE_NAME = '(idle)'
const GC_NODE_NAME = '(garbage collector)'
const ANONYMOUS_FUNCTION_NAME = '(anonymous)'
/** V8 pseudo-nodes. They are reported as shares and kept out of the "top functions" list. */
const PSEUDO_NODE_NAMES: ReadonlySet<string> = new Set([
  ROOT_NODE_NAME,
  PROGRAM_NODE_NAME,
  IDLE_NODE_NAME,
  GC_NODE_NAME,
])

// ============================================
// Types
// ============================================

export interface CpuProfileNode {
  id: number
  callFrame: { functionName: string; url: string; lineNumber: number; columnNumber?: number; scriptId?: string }
  hitCount?: number
  children?: number[]
}

/** V8 CPUProfile as returned by `Profiler.stop` (times in microseconds). */
export interface CpuProfile {
  nodes: CpuProfileNode[]
  startTime: number
  endTime: number
  samples: number[]
  timeDeltas: number[]
}

export interface TopSelfEntry {
  name: string
  /** `file.js:12`, or an empty string for native frames. */
  location: string
  selfMs: number
  percent: number
}

export interface CpuProfileSummary {
  totalMs: number
  sampleCount: number
  topSelf: TopSelfEntry[]
  gcPercent: number
  idlePercent: number
  programPercent: number
  rootPercent: number
}

export interface RendererStallInfo {
  durationMs: number
  source: string
}

/** The slice of Electron's `webContents.debugger` this module uses. */
export interface StallDebuggerLike {
  isAttached(): boolean
  attach(protocolVersion?: string): void
  detach(): void
  sendCommand(method: string, params?: object): Promise<unknown>
  on(event: 'detach', listener: (event: unknown, reason: string) => void): unknown
  removeListener(event: 'detach', listener: (event: unknown, reason: string) => void): unknown
}

export interface StallWindowLike {
  isDestroyed(): boolean
  webContents: { debugger: StallDebuggerLike }
}

export interface StallProfilerOptions {
  getWindow: () => StallWindowLike | null
  /** Folder for `.cpuprofile` files; created on first write. */
  getLogsDir: () => string
  log: (level: 'info' | 'warn', message: string, data?: unknown) => void
}

export interface StallProfileFile {
  name: string
  mtimeMs: number
}

// ============================================
// Pure helpers
// ============================================

/** True when the kill switch is set. */
export function isStallProfilerDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[STALL_PROFILER_DISABLE_ENV] === '1'
}

/**
 * Validates an IPC payload from the renderer. Returns null for anything that is not a finite,
 * positive duration with a string source. The source is truncated.
 */
export function parseRendererStallPayload(payload: unknown): RendererStallInfo | null {
  if (typeof payload !== 'object' || payload === null) return null
  const { durationMs, source } = payload as { durationMs?: unknown; source?: unknown }
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs)) return null
  if (durationMs <= 0 || durationMs > MAX_STALL_DURATION_MS) return null
  if (typeof source !== 'string') return null
  return { durationMs, source: source.slice(0, MAX_STALL_SOURCE_LENGTH) }
}

/** Last path segment of a script URL, without query or hash. */
function urlBasename(url: string): string {
  const withoutQuery = url.split(/[?#]/)[0] ?? ''
  const segments = withoutQuery.split(/[\\/]/)
  return segments[segments.length - 1] ?? ''
}

/** `basename:line` (1-based, as DevTools shows it); V8 reports line numbers 0-based. */
function formatLocation(callFrame: CpuProfileNode['callFrame']): string {
  const file = urlBasename(callFrame.url)
  if (!file) return ''
  return callFrame.lineNumber >= 0 ? `${file}:${callFrame.lineNumber + 1}` : file
}

function roundTo1Decimal(value: number): number {
  return Math.round(value * DECIMAL_SCALE) / DECIMAL_SCALE
}

/**
 * Summarises a CPU profile by SELF time.
 *
 * V8 convention: `timeDeltas[i]` is the time since the previous sample (the first one is the
 * time since the profile started), so it is attributed to `samples[i]`. Shares are of total
 * sampled time, not of sample count, which stays correct when sampling is irregular (as it is
 * around a blocked event loop). Functions are merged by name + location; V8 pseudo-nodes are
 * reported as shares only.
 */
export function summarizeCpuProfile(
  profile: CpuProfile,
  topCount: number = TOP_SELF_FUNCTION_COUNT,
): CpuProfileSummary {
  const nodes = Array.isArray(profile.nodes) ? profile.nodes : []
  const samples = Array.isArray(profile.samples) ? profile.samples : []
  const deltas = Array.isArray(profile.timeDeltas) ? profile.timeDeltas : []

  const nodeById = new Map<number, CpuProfileNode>()
  for (const node of nodes) nodeById.set(node.id, node)

  const selfUsByNode = new Map<number, number>()
  let totalUs = 0
  for (let index = 0; index < samples.length; index++) {
    const delta = Math.max(0, deltas[index] ?? 0)
    totalUs += delta
    const nodeId = samples[index]
    if (nodeId === undefined) continue
    selfUsByNode.set(nodeId, (selfUsByNode.get(nodeId) ?? 0) + delta)
  }

  const byFunction = new Map<string, { name: string; location: string; selfUs: number }>()
  const pseudoUs = new Map<string, number>()
  for (const [nodeId, selfUs] of selfUsByNode) {
    const node = nodeById.get(nodeId)
    if (!node) continue
    const functionName = node.callFrame.functionName
    if (PSEUDO_NODE_NAMES.has(functionName)) {
      pseudoUs.set(functionName, (pseudoUs.get(functionName) ?? 0) + selfUs)
      continue
    }
    const name = functionName || ANONYMOUS_FUNCTION_NAME
    const location = formatLocation(node.callFrame)
    const key = `${name}\u0000${location}`
    const entry = byFunction.get(key) ?? { name, location, selfUs: 0 }
    entry.selfUs += selfUs
    byFunction.set(key, entry)
  }

  const percentOf = (us: number): number =>
    totalUs > 0 ? roundTo1Decimal((us / totalUs) * PERCENT_SCALE) : 0

  const topSelf = [...byFunction.values()]
    .sort((a, b) => b.selfUs - a.selfUs)
    .slice(0, topCount)
    .map((entry) => ({
      name: entry.name,
      location: entry.location,
      selfMs: roundTo1Decimal(entry.selfUs / MICROSECONDS_PER_MILLISECOND),
      percent: percentOf(entry.selfUs),
    }))

  return {
    totalMs: roundTo1Decimal(totalUs / MICROSECONDS_PER_MILLISECOND),
    sampleCount: samples.length,
    topSelf,
    gcPercent: percentOf(pseudoUs.get(GC_NODE_NAME) ?? 0),
    idlePercent: percentOf(pseudoUs.get(IDLE_NODE_NAME) ?? 0),
    programPercent: percentOf(pseudoUs.get(PROGRAM_NODE_NAME) ?? 0),
    rootPercent: percentOf(pseudoUs.get(ROOT_NODE_NAME) ?? 0),
  }
}

/**
 * Names of stall profile files to delete so only the newest `keep` remain. Files that do not
 * match `stall-*.cpuprofile` are never selected.
 */
export function selectStallProfilesToDelete(
  files: readonly StallProfileFile[],
  keep: number = MAX_STALL_PROFILE_FILES,
): string[] {
  return files
    .filter((file) => STALL_PROFILE_FILE_PATTERN.test(file.name))
    .sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name))
    .slice(Math.max(0, keep))
    .map((file) => file.name)
}

function isCpuProfile(value: unknown): value is CpuProfile {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<CpuProfile>
  return (
    Array.isArray(candidate.nodes) &&
    Array.isArray(candidate.samples) &&
    Array.isArray(candidate.timeDeltas)
  )
}

// ============================================
// Profiler session (module singleton)
// ============================================

interface FinishedWindow {
  profile: CpuProfile
  startedAt: number
  /** Wall time at which the stop was requested (the renderer may answer later). */
  stoppedAt: number
}

interface Session {
  options: StallProfilerOptions
  profilerDebugger: StallDebuggerLike
  rotationTimer: NodeJS.Timeout
  detachListener: (event: unknown, reason: string) => void
  windowStartedAt: number
  previous: FinishedWindow | null
}

let session: Session | null = null
/** Set when attach fails: stay off for the rest of the app session. */
let disabledForSession = false
let detachLogged = false
let lastActedAt = Number.NEGATIVE_INFINITY
/** Serialises Profiler.stop/start so a rotation and a stall capture never interleave. */
let queue: Promise<void> = Promise.resolve()

function enqueue(task: () => Promise<void>): Promise<void> {
  queue = queue.then(task, task)
  return queue
}

/**
 * Stops the running profile and starts the next window. Returns the finished window.
 * Throws if the profiler cannot be stopped; callers treat that as fatal for the profiler.
 */
async function rotateWindow(active: Session): Promise<FinishedWindow | null> {
  const startedAt = active.windowStartedAt
  const stoppedAt = Date.now()
  const result = await active.profilerDebugger.sendCommand('Profiler.stop')
  active.windowStartedAt = Date.now()
  await active.profilerDebugger.sendCommand('Profiler.start')
  const profile = (result as { profile?: unknown } | null)?.profile
  return isCpuProfile(profile) ? { profile, startedAt, stoppedAt } : null
}

/** Rolling rotation: keep the latest finished window and the current one, drop older. */
async function rotateAndKeep(active: Session): Promise<void> {
  const finished = await rotateWindow(active)
  if (finished) active.previous = finished
}

function runGuarded(active: Session, task: () => Promise<void>): Promise<void> {
  return enqueue(async () => {
    if (session !== active) return
    try {
      await task()
    } catch (error) {
      active.options.log('warn', '[Main] [Renderer] Stall profiler failed and was turned off', {
        error: String(error),
      })
      teardown(active)
    }
  })
}

function teardown(active: Session): void {
  clearInterval(active.rotationTimer)
  try {
    active.profilerDebugger.removeListener('detach', active.detachListener)
    if (active.profilerDebugger.isAttached()) active.profilerDebugger.detach()
  } catch {
    // Already detached or destroyed.
  }
  if (session === active) session = null
}

/** Starts rolling CPU profiling of the main window's renderer. Safe to call repeatedly. */
export function startStallProfiler(options: StallProfilerOptions): void {
  try {
    if (session || disabledForSession) return
    if (isStallProfilerDisabled()) {
      disabledForSession = true
      options.log('info', `[Main] [Renderer] Stall profiler disabled by ${STALL_PROFILER_DISABLE_ENV}`)
      return
    }
    const window = options.getWindow()
    if (!window || window.isDestroyed()) return

    const profilerDebugger = window.webContents.debugger
    try {
      if (!profilerDebugger.isAttached()) profilerDebugger.attach(DEBUGGER_PROTOCOL_VERSION)
    } catch (error) {
      disabledForSession = true
      options.log('warn', '[Main] [Renderer] Stall profiler could not attach the debugger; disabled', {
        error: String(error),
      })
      return
    }

    const detachListener = (_event: unknown, reason: string): void => {
      if (!detachLogged) {
        detachLogged = true
        options.log('warn', '[Main] [Renderer] Stall profiler debugger detached; profiling stopped', { reason })
      }
      if (session) teardown(session)
    }
    profilerDebugger.on('detach', detachListener)

    const rotationTimer = setInterval(() => {
      const current = session
      if (current) void runGuarded(current, () => rotateAndKeep(current))
    }, PROFILE_WINDOW_MS)
    rotationTimer.unref()

    const active: Session = {
      options,
      profilerDebugger,
      rotationTimer,
      detachListener,
      windowStartedAt: Date.now(),
      previous: null,
    }
    session = active

    void runGuarded(active, async () => {
      await profilerDebugger.sendCommand('Profiler.enable')
      await profilerDebugger.sendCommand('Profiler.setSamplingInterval', { interval: SAMPLING_INTERVAL_US })
      active.windowStartedAt = Date.now()
      await profilerDebugger.sendCommand('Profiler.start')
    })
  } catch (error) {
    disabledForSession = true
    options.log('warn', '[Main] [Renderer] Stall profiler failed to start', { error: String(error) })
  }
}

/** Stops rotation and detaches the debugger. Mirrors `stopRendererMemorySampling` at quit. */
export function stopStallProfiler(): void {
  try {
    if (session) teardown(session)
  } catch {
    // Quitting; nothing useful to do.
  }
  lastActedAt = Number.NEGATIVE_INFINITY
}

/**
 * Called when the renderer reports it was blocked. Captures the profile covering the stall,
 * logs a summary and saves the full profile. Resolves when done; never rejects.
 */
export function handleRendererStall(info: RendererStallInfo): Promise<void> {
  try {
    const active = session
    if (!active || info.durationMs <= STALL_PROFILE_MIN_DURATION_MS) return Promise.resolve()
    const now = Date.now()
    if (now - lastActedAt < STALL_PROFILE_COOLDOWN_MS) return Promise.resolve()
    lastActedAt = now
    return runGuarded(active, () => captureStall(active, info, now))
  } catch {
    return Promise.resolve()
  }
}

async function captureStall(active: Session, info: RendererStallInfo, now: number): Promise<void> {
  const stallStartedAt = now - info.durationMs
  const currentWindowStartedAt = active.windowStartedAt
  const previous = active.previous

  // Stopping now yields the window the stall (and the blocked renderer) ended in.
  const current = await rotateWindow(active)
  if (current) active.previous = current

  const windows: Array<{ label: string; finished: FinishedWindow }> = []
  // The previous window also holds samples when the stall began before the current one started.
  if (previous && stallStartedAt < currentWindowStartedAt && previous.stoppedAt >= stallStartedAt) {
    windows.push({ label: 'previous', finished: previous })
  }
  if (current) windows.push({ label: 'current', finished: current })

  for (const { label, finished } of windows) {
    reportWindow(active, info, now, label, finished.profile)
  }
}

function reportWindow(
  active: Session,
  info: RendererStallInfo,
  now: number,
  label: string,
  profile: CpuProfile,
): void {
  const { log } = active.options
  const summary = summarizeCpuProfile(profile)
  const saved = saveProfile(active.options, profile, `${new Date(now).toISOString()}-${label}`)

  log('warn', '[Main] [Renderer] Stall CPU profile', {
    stallDurationMs: Math.round(info.durationMs),
    source: info.source,
    window: label,
    totalSampledMs: summary.totalMs,
    sampleCount: summary.sampleCount,
    gcPercent: summary.gcPercent,
    idlePercent: summary.idlePercent,
    programPercent: summary.programPercent,
    rootPercent: summary.rootPercent,
    topSelf: summary.topSelf.map(
      (entry) => `${entry.name}${entry.location ? ` (${entry.location})` : ''} ${entry.selfMs}ms ${entry.percent}%`,
    ),
    file: saved.file,
    skipped: saved.skipped,
  })
}

/** Writes the profile and prunes old ones. Never throws. */
function saveProfile(
  options: StallProfilerOptions,
  profile: CpuProfile,
  stamp: string,
): { file: string | null; skipped: string | null } {
  try {
    const json = JSON.stringify(profile)
    const bytes = Buffer.byteLength(json)
    if (bytes > MAX_STALL_PROFILE_BYTES) {
      return { file: null, skipped: `profile is ${bytes} bytes, over the ${MAX_STALL_PROFILE_BYTES} byte cap` }
    }
    const dir = options.getLogsDir()
    fs.mkdirSync(dir, { recursive: true })
    const name = `${STALL_PROFILE_FILE_PREFIX}${stamp.replace(/[:.]/g, '-')}${STALL_PROFILE_FILE_SUFFIX}`
    fs.writeFileSync(path.join(dir, name), json, 'utf8')
    pruneStallProfiles(dir)
    return { file: name, skipped: null }
  } catch (error) {
    return { file: null, skipped: `write failed: ${String(error)}` }
  }
}

function pruneStallProfiles(dir: string): void {
  const files: StallProfileFile[] = fs
    .readdirSync(dir)
    .filter((name) => STALL_PROFILE_FILE_PATTERN.test(name))
    .map((name) => ({ name, mtimeMs: fs.statSync(path.join(dir, name)).mtimeMs }))
  for (const name of selectStallProfilesToDelete(files)) {
    try {
      fs.unlinkSync(path.join(dir, name))
    } catch {
      // Locked or already gone; the next write retries.
    }
  }
}

/** Test hook: forget all module state, including the attach-failure latch. */
export function resetStallProfilerForTests(): void {
  stopStallProfiler()
  disabledForSession = false
  detachLogged = false
  queue = Promise.resolve()
}
