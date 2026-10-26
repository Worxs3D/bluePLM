import { describe, expect, it } from 'vitest'

import { compare, markdownTable, METRICS, type RenderPerfResult } from './compare'
import { frameStats, heapStats, median, percentile } from './stats'
import { categoryOf, mainThreadBreakdown, TraceStreamParser, type TraceEvent } from './traceMetrics'

const MAIN = { pid: 7, tid: 1 }
const meta = (pid: number, tid: number, name: string): TraceEvent => ({
  name: 'thread_name',
  ph: 'M',
  ts: 0,
  pid,
  tid,
  args: { name },
})
const x = (name: string, tsMs: number, durMs: number, at = MAIN): TraceEvent => ({
  name,
  ph: 'X',
  ts: tsMs * 1000,
  dur: durMs * 1000,
  ...at,
})

describe('mainThreadBreakdown', () => {
  it('attributes self time by category and counts long tasks', () => {
    const events = [
      meta(MAIN.pid, MAIN.tid, 'CrRendererMain'),
      meta(9, 2, 'CrRendererMain'),
      // A 120 ms task: 80 ms of script (10 ms of it a nested GC), 30 ms layout, 5 ms paint.
      x('RunTask', 0, 120),
      x('FunctionCall', 0, 80),
      x('MinorGC', 10, 10),
      x('Layout', 80, 30),
      x('Paint', 110, 5),
      // A short task: not long.
      x('RunTask', 200, 20),
      x('UpdateLayoutTree', 200, 20),
      // Another renderer with fewer events is ignored.
      x('FunctionCall', 0, 500, { pid: 9, tid: 2 }),
    ]
    const b = mainThreadBreakdown(events)!
    expect(b.scriptingMs).toBe(70)
    expect(b.gcMs).toBe(10)
    expect(b.layoutMs).toBe(30)
    expect(b.styleMs).toBe(20)
    expect(b.paintMs).toBe(5)
    expect(b.otherMs).toBe(5) // the task's own overhead
    expect(b.longTasks).toBe(1)
    expect(b.totalBlockingMs).toBe(70)
    expect(b.spanMs).toBe(220)
  })

  it('clips a child that overruns its parent and returns null without a renderer', () => {
    const events = [meta(MAIN.pid, MAIN.tid, 'CrRendererMain'), x('RunTask', 0, 10), x('FunctionCall', 5, 20)]
    const b = mainThreadBreakdown(events)!
    expect(b.scriptingMs).toBe(5)
    expect(b.otherMs).toBe(5)
    expect(mainThreadBreakdown([x('RunTask', 0, 10)])).toBeNull()
  })

  it('categorizes by event name', () => {
    expect(categoryOf('EvaluateScript')).toBe('scripting')
    expect(categoryOf('V8.GCScavenger')).toBe('gc')
    expect(categoryOf('PrePaint')).toBe('paint')
    expect(categoryOf('ParseHTML')).toBe('other')
  })
})

describe('stats', () => {
  it('median and percentile', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 2, 3])).toBe(2.5)
    expect(Number.isNaN(median([]))).toBe(true)
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10)
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5)
  })

  it('frameStats counts dropped and janky frames against the vsync interval', () => {
    const v = 1000 / 60
    // 10 clean frames, one 50 ms gap (two dropped), then a 30 ms frame (janky, one dropped).
    const ts = [0]
    for (let i = 0; i < 10; i++) ts.push(ts[ts.length - 1] + v)
    ts.push(ts[ts.length - 1] + 50)
    ts.push(ts[ts.length - 1] + 30)
    const s = frameStats(ts, v)
    expect(s.frames).toBe(12)
    expect(s.droppedFrames).toBe(3)
    expect(s.jankyFrames).toBe(2)
    expect(s.maxFrameMs).toBe(50)
    expect(s.p50FrameMs).toBeCloseTo(16.7, 1)
  })

  it('heapStats reports growth and a fitted slope', () => {
    const h = heapStats([
      { minute: 0, usedMB: 100 },
      { minute: 10, usedMB: 110 },
      { minute: 20, usedMB: 120 },
    ])
    expect(h.growthMB).toBe(20)
    expect(h.slopeMBPer10Min).toBe(10)
    expect(h.peakMB).toBe(120)
  })
})

const result = (runId: string, date: string, metrics: Record<string, number>, ref = 'refs/heads/main'): RenderPerfResult => ({
  schema: 1,
  sha: runId,
  ref,
  runId,
  date,
  fileCount: 30_000,
  reps: 3,
  sessionMinutes: 30,
  metrics,
})

describe('compare', () => {
  const history = [1, 2, 3, 4, 5].map((d) =>
    result(`r${d}`, `2026-10-0${d}T00:00:00Z`, { 'coldStart.launchToLoadedMs': 4000 + d * 10, 'scroll.p95FrameMs': 20 }),
  )

  it('flags only large changes over the floor, against the median of recent main runs', () => {
    const c = compare(
      result('now', '2026-10-10T00:00:00Z', {
        'coldStart.launchToLoadedMs': 6000, // +48%, +1970 ms: flagged
        'scroll.p95FrameMs': 26, // +30% but only +6 ms (floor 8): not flagged
      }),
      [...history, result('pr', '2026-10-09T00:00:00Z', { 'coldStart.launchToLoadedMs': 1 }, 'refs/heads/feature')],
    )
    const row = (key: string) => c.rows.find((r) => r.spec.key === key)!
    expect(c.historyRuns).toBe(5)
    expect(row('coldStart.launchToLoadedMs').baseline).toBe(4030)
    expect(row('coldStart.launchToLoadedMs').status).toBe('regressed')
    expect(row('scroll.p95FrameMs').status).toBe('ok')
    expect(row('tree.settleMs').status).toBe('missing')
    expect(c.failed).toBe(true)
    expect(markdownTable(c, result('now', '', {}))).toContain('**REGRESSED**')
  })

  it('applies the heap ceilings without history, and passes a first run otherwise', () => {
    const first = compare(result('a', '2026-10-01', { 'session.heapGrowthMB': 10, 'coldStart.longTasks': 9 }), [])
    expect(first.failed).toBe(false)
    expect(first.rows.find((r) => r.spec.key === 'coldStart.longTasks')!.status).toBe('no-history')
    const leak = compare(result('b', '2026-10-01', { 'session.heapGrowthMB': 80 }), [])
    expect(leak.rows.find((r) => r.spec.key === 'session.heapGrowthMB')!.status).toBe('over-ceiling')
    expect(leak.failed).toBe(true)
  })

  it('reports improvements without failing', () => {
    const c = compare(result('now', '2026-10-10', { 'coldStart.launchToLoadedMs': 2000 }), history)
    expect(c.rows.find((r) => r.spec.key === 'coldStart.launchToLoadedMs')!.status).toBe('improved')
    expect(c.failed).toBe(false)
  })

  it('has unique metric keys', () => {
    expect(new Set(METRICS.map((m) => m.key)).size).toBe(METRICS.length)
  })
})

describe('TraceStreamParser', () => {
  it('parses a trace split at any point, keeping thread names and complete events', () => {
    const trace = JSON.stringify({
      traceEvents: [
        meta(MAIN.pid, MAIN.tid, 'CrRendererMain'),
        { ...x('RunTask', 0, 120), args: { data: { note: 'a } brace and a " quote \\ in a string' } } },
        { name: 'Instant', ph: 'I', ts: 5, pid: 7, tid: 1 },
        x('FunctionCall', 0, 80),
      ],
      metadata: { 'trace-config': { notAnEvent: true } },
    })
    for (const size of [1, 7, 64, trace.length]) {
      const parser = new TraceStreamParser()
      for (let i = 0; i < trace.length; i += size) parser.push(trace.slice(i, i + size))
      expect(parser.events.map((e) => e.name)).toEqual(['thread_name', 'RunTask', 'FunctionCall'])
      expect(mainThreadBreakdown(parser.events)!.scriptingMs).toBe(80)
    }
  })
})
