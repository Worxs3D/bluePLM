import fs from 'fs'
import os from 'os'
import path from 'path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  STALL_PROFILER_DISABLE_ENV,
  STALL_PROFILE_COOLDOWN_MS,
  handleRendererStall,
  isStallProfilerDisabled,
  parseRendererStallPayload,
  resetStallProfilerForTests,
  selectStallProfilesToDelete,
  startStallProfiler,
  summarizeCpuProfile,
  type CpuProfile,
  type StallDebuggerLike,
  type StallProfilerOptions,
} from './stallProfiler'

const FRAME_MS_TO_US = 1_000

function node(id: number, functionName: string, url = '', lineNumber = -1, children: number[] = []) {
  return { id, callFrame: { functionName, url, lineNumber }, children }
}

/** Timings in ms for readability; the profile itself is in microseconds. */
function makeProfile(entries: Array<[nodeId: number, ms: number]>): CpuProfile {
  return {
    nodes: [
      node(1, '(root)', '', -1, [2, 3, 4, 5, 6]),
      node(2, 'heavy', 'http://localhost/assets/index-abc.js?v=1', 41),
      node(3, '', 'file:///C:/app/dist/chunk.js', 9),
      node(4, '(garbage collector)'),
      node(5, '(idle)'),
      node(6, '(program)'),
      node(7, 'heavy', 'http://localhost/assets/index-abc.js?v=1', 41),
    ],
    startTime: 0,
    endTime: entries.reduce((total, [, ms]) => total + ms, 0) * FRAME_MS_TO_US,
    samples: entries.map(([nodeId]) => nodeId),
    timeDeltas: entries.map(([, ms]) => ms * FRAME_MS_TO_US),
  }
}

describe('summarizeCpuProfile', () => {
  it('ranks by self time and reports pseudo-node shares', () => {
    const summary = summarizeCpuProfile(
      makeProfile([
        [2, 300],
        [7, 100], // same function in a second node: merged with node 2
        [3, 200],
        [4, 150],
        [5, 200],
        [6, 50],
      ]),
    )

    expect(summary.totalMs).toBe(1000)
    expect(summary.sampleCount).toBe(6)
    expect(summary.topSelf.map((entry) => entry.name)).toEqual(['heavy', '(anonymous)'])
    expect(summary.topSelf[0]).toEqual({ name: 'heavy', location: 'index-abc.js:42', selfMs: 400, percent: 40 })
    expect(summary.topSelf[1]).toEqual({ name: '(anonymous)', location: 'chunk.js:10', selfMs: 200, percent: 20 })
    expect(summary.gcPercent).toBe(15)
    expect(summary.idlePercent).toBe(20)
    expect(summary.programPercent).toBe(5)
  })

  it('limits the list and keeps pseudo-nodes out of it', () => {
    const summary = summarizeCpuProfile(makeProfile([[4, 500], [2, 10], [3, 20]]), 1)
    expect(summary.topSelf).toHaveLength(1)
    expect(summary.topSelf[0]?.name).toBe('(anonymous)')
  })

  it('is safe on an empty or malformed profile', () => {
    const empty = summarizeCpuProfile({ nodes: [], samples: [], timeDeltas: [], startTime: 0, endTime: 0 })
    expect(empty).toEqual({
      totalMs: 0,
      sampleCount: 0,
      topSelf: [],
      gcPercent: 0,
      idlePercent: 0,
      programPercent: 0,
      rootPercent: 0,
    })
    // Sample pointing at an unknown node, and a missing delta.
    const odd = summarizeCpuProfile({ nodes: [], samples: [99], timeDeltas: [], startTime: 0, endTime: 0 })
    expect(odd.topSelf).toEqual([])
  })
})

describe('selectStallProfilesToDelete', () => {
  it('keeps the newest N and ignores other files', () => {
    const files = [
      { name: 'stall-a.cpuprofile', mtimeMs: 10 },
      { name: 'stall-b.cpuprofile', mtimeMs: 40 },
      { name: 'stall-c.cpuprofile', mtimeMs: 30 },
      { name: 'stall-d.cpuprofile', mtimeMs: 20 },
      { name: 'blueplm-session.log', mtimeMs: 1 },
    ]
    expect(selectStallProfilesToDelete(files, 3)).toEqual(['stall-a.cpuprofile'])
    expect(selectStallProfilesToDelete(files, 1).sort()).toEqual([
      'stall-a.cpuprofile',
      'stall-c.cpuprofile',
      'stall-d.cpuprofile',
    ])
    expect(selectStallProfilesToDelete(files, 10)).toEqual([])
  })
})

describe('parseRendererStallPayload', () => {
  it('accepts a valid payload and truncates the source', () => {
    expect(parseRendererStallPayload({ durationMs: 3500, source: 'long-task' })).toEqual({
      durationMs: 3500,
      source: 'long-task',
    })
    expect(parseRendererStallPayload({ durationMs: 3500, source: 'x'.repeat(500) })?.source).toHaveLength(80)
  })

  it('rejects bad payloads', () => {
    for (const bad of [
      null,
      'x',
      {},
      { durationMs: '3000', source: 'a' },
      { durationMs: Number.NaN, source: 'a' },
      { durationMs: Number.POSITIVE_INFINITY, source: 'a' },
      { durationMs: -5, source: 'a' },
      { durationMs: 3000, source: 7 },
    ]) {
      expect(parseRendererStallPayload(bad)).toBeNull()
    }
  })
})

describe('isStallProfilerDisabled', () => {
  it('honours only the value 1', () => {
    expect(isStallProfilerDisabled({ [STALL_PROFILER_DISABLE_ENV]: '1' })).toBe(true)
    expect(isStallProfilerDisabled({ [STALL_PROFILER_DISABLE_ENV]: '0' })).toBe(false)
    expect(isStallProfilerDisabled({})).toBe(false)
  })
})

describe('profiler session', () => {
  let logsDir: string
  let commands: string[]
  let profilesToReturn: CpuProfile[]
  let logs: Array<{ level: string; message: string; data?: unknown }>
  let attachError: Error | null
  let options: StallProfilerOptions
  let detachListener: ((event: unknown, reason: string) => void) | null

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    logsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stall-profiler-'))
    commands = []
    profilesToReturn = []
    logs = []
    attachError = null
    detachListener = null

    let attached = false
    const fakeDebugger: StallDebuggerLike = {
      isAttached: () => attached,
      attach: () => {
        if (attachError) throw attachError
        attached = true
      },
      detach: () => {
        attached = false
      },
      sendCommand: (method) => {
        commands.push(method)
        if (method === 'Profiler.stop') {
          return Promise.resolve({ profile: profilesToReturn.shift() ?? makeProfile([[2, 100]]) })
        }
        return Promise.resolve({})
      },
      on: (_event, listener) => {
        detachListener = listener
      },
      removeListener: () => {
        detachListener = null
      },
    }
    options = {
      getWindow: () => ({ isDestroyed: () => false, webContents: { debugger: fakeDebugger } }),
      getLogsDir: () => logsDir,
      log: (level, message, data) => logs.push({ level, message, data }),
    }
  })

  afterEach(() => {
    resetStallProfilerForTests()
    vi.useRealTimers()
    fs.rmSync(logsDir, { recursive: true, force: true })
  })

  it('starts the profiler with the configured sampling interval', async () => {
    startStallProfiler(options)
    await vi.advanceTimersByTimeAsync(0)
    expect(commands).toEqual(['Profiler.enable', 'Profiler.setSamplingInterval', 'Profiler.start'])
  })

  it('rotates every window', async () => {
    startStallProfiler(options)
    await vi.advanceTimersByTimeAsync(26_000)
    expect(commands.slice(3)).toEqual(['Profiler.stop', 'Profiler.start'])
  })

  it('ignores short stalls and the kill switch', async () => {
    startStallProfiler(options)
    await vi.advanceTimersByTimeAsync(0)
    await handleRendererStall({ durationMs: 1500, source: 'test' })
    expect(logs).toEqual([])

    resetStallProfilerForTests()
    vi.stubEnv(STALL_PROFILER_DISABLE_ENV, '1')
    commands.length = 0
    startStallProfiler(options)
    await vi.advanceTimersByTimeAsync(0)
    vi.unstubAllEnvs()
    expect(commands).toEqual([])
  })

  it('logs a summary, saves the profile and applies the cooldown', async () => {
    startStallProfiler(options)
    await vi.advanceTimersByTimeAsync(5_000)

    await handleRendererStall({ durationMs: 3000, source: 'long-task' })
    const stallLogs = logs.filter((entry) => entry.message === '[Main] [Renderer] Stall CPU profile')
    expect(stallLogs).toHaveLength(1)
    const data = stallLogs[0]?.data as { file: string; source: string; topSelf: string[]; stallDurationMs: number }
    expect(stallLogs[0]?.level).toBe('warn')
    expect(data.source).toBe('long-task')
    expect(data.stallDurationMs).toBe(3000)
    expect(data.topSelf[0]).toContain('heavy (index-abc.js:42)')
    expect(fs.readdirSync(logsDir)).toEqual([data.file])

    // Within the cooldown: nothing more happens.
    await handleRendererStall({ durationMs: 5000, source: 'again' })
    expect(logs.filter((entry) => entry.message === '[Main] [Renderer] Stall CPU profile')).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(STALL_PROFILE_COOLDOWN_MS)
    await handleRendererStall({ durationMs: 5000, source: 'later' })
    expect(logs.filter((entry) => entry.message === '[Main] [Renderer] Stall CPU profile').length).toBeGreaterThan(1)
  })

  it('also reports the previous window when the stall began before the current one', async () => {
    startStallProfiler(options)
    await vi.advanceTimersByTimeAsync(26_000) // one rotation: previous window now exists
    await vi.advanceTimersByTimeAsync(1_000)

    await handleRendererStall({ durationMs: 10_000, source: 'long-task' })
    const windows = logs
      .filter((entry) => entry.message === '[Main] [Renderer] Stall CPU profile')
      .map((entry) => (entry.data as { window: string }).window)
    expect(windows).toEqual(['previous', 'current'])
    expect(fs.readdirSync(logsDir)).toHaveLength(2)
  })

  it('stays off and logs once when the debugger cannot attach', async () => {
    attachError = new Error('already attached')
    startStallProfiler(options)
    startStallProfiler(options)
    await vi.advanceTimersByTimeAsync(0)
    expect(logs.filter((entry) => entry.level === 'warn')).toHaveLength(1)
    expect(commands).toEqual([])
    await handleRendererStall({ durationMs: 5000, source: 'test' })
    expect(fs.readdirSync(logsDir)).toEqual([])
  })

  it('stops rotating when the debugger detaches', async () => {
    startStallProfiler(options)
    await vi.advanceTimersByTimeAsync(0)
    detachListener?.({}, 'target closed')
    commands.length = 0
    await vi.advanceTimersByTimeAsync(60_000)
    expect(commands).toEqual([])
    expect(logs.filter((entry) => entry.message.includes('detached'))).toHaveLength(1)
  })

  it('skips profiles over the size cap', async () => {
    startStallProfiler(options)
    await vi.advanceTimersByTimeAsync(0)
    const huge = makeProfile([[2, 10]])
    // One long string pushes the serialized size over 20 MB.
    huge.nodes[0] = { ...huge.nodes[0]!, callFrame: { functionName: 'x'.repeat(21 * 1024 * 1024), url: '', lineNumber: -1 } }
    profilesToReturn = [huge]

    await handleRendererStall({ durationMs: 3000, source: 'test' })
    const data = logs.find((entry) => entry.message === '[Main] [Renderer] Stall CPU profile')?.data as {
      file: string | null
      skipped: string | null
    }
    expect(data.file).toBeNull()
    expect(data.skipped).toContain('over the')
    expect(fs.readdirSync(logsDir)).toEqual([])
  })

  it('keeps only the newest three profiles on disk', async () => {
    startStallProfiler(options)
    await vi.advanceTimersByTimeAsync(0)
    for (let index = 0; index < 5; index++) {
      await vi.advanceTimersByTimeAsync(STALL_PROFILE_COOLDOWN_MS + 1)
      await handleRendererStall({ durationMs: 3000, source: `stall-${index}` })
    }
    expect(fs.readdirSync(logsDir).length).toBeLessThanOrEqual(3)
  })
})
