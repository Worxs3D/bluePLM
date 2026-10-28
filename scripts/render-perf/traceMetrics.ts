/**
 * What a Chrome DevTools trace says the renderer's main thread spent its time on.
 *
 * Self time, the way the DevTools Performance panel's summary counts it: each complete (`X`)
 * event's duration minus the events nested inside it, attributed by event name to scripting,
 * style, layout, paint, garbage collection or other. Long tasks are the top-level tasks over
 * 50 ms; total blocking time is what each spends over 50 ms.
 */

export interface TraceEvent {
  name: string
  ph: string
  ts: number
  dur?: number
  pid: number
  tid: number
  cat?: string
  args?: { name?: string } & Record<string, unknown>
}

export type Category = 'scripting' | 'style' | 'layout' | 'paint' | 'gc' | 'other'

export interface MainThreadBreakdown {
  /** Milliseconds of self time per category. */
  scriptingMs: number
  styleMs: number
  layoutMs: number
  paintMs: number
  gcMs: number
  otherMs: number
  longTasks: number
  totalBlockingMs: number
  /** Span of the main thread's events, ms. */
  spanMs: number
  /** The event names with the most self time, ms, largest first. */
  top: Array<[string, number]>
}

const SCRIPTING = new Set([
  'FunctionCall',
  'EvaluateScript',
  'v8.compile',
  'v8.compileModule',
  'v8.evaluateModule',
  'v8.produceCache',
  'v8.produceModuleCache',
  'TimerFire',
  'EventDispatch',
  'FireAnimationFrame',
  'FireIdleCallback',
  'RunMicrotasks',
  'V8.Execute',
  'v8.run',
  'XHRReadyStateChange',
  'XHRLoad',
  'ResizeObserverLoopCallback',
  'IntersectionObserverController::computeIntersections',
])
const STYLE = new Set(['UpdateLayoutTree', 'RecalculateStyles', 'ParseAuthorStyleSheet', 'InvalidateLayout'])
const LAYOUT = new Set(['Layout', 'ScheduleStyleRecalculation'])
const PAINT = new Set([
  'Paint',
  'PrePaint',
  'Layerize',
  'CompositeLayers',
  'UpdateLayer',
  'UpdateLayerTree',
  'PaintImage',
  'Decode Image',
  'ImageDecodeTask',
  'Commit',
])
const TASK = new Set(['RunTask', 'ThreadControllerImpl::RunTask', 'ThreadPool_RunTask'])

export function categoryOf(name: string): Category {
  if (SCRIPTING.has(name)) return 'scripting'
  if (STYLE.has(name)) return 'style'
  if (LAYOUT.has(name)) return 'layout'
  if (PAINT.has(name)) return 'paint'
  if (/GC|^V8\.GC|^BlinkGC/.test(name)) return 'gc'
  return 'other'
}

/** The renderer main thread with the most events (an app has one renderer worth measuring). */
export function rendererMainThread(events: readonly TraceEvent[]): { pid: number; tid: number } | null {
  const candidates = events.filter(
    (e) => e.ph === 'M' && e.name === 'thread_name' && e.args?.name === 'CrRendererMain',
  )
  let best: { pid: number; tid: number; count: number } | null = null
  for (const c of candidates) {
    const count = events.reduce((n, e) => (e.pid === c.pid && e.tid === c.tid && e.ph === 'X' ? n + 1 : n), 0)
    if (!best || count > best.count) best = { pid: c.pid, tid: c.tid, count }
  }
  return best ? { pid: best.pid, tid: best.tid } : null
}

const round = (us: number) => Math.round(us / 100) / 10

export function mainThreadBreakdown(events: readonly TraceEvent[]): MainThreadBreakdown | null {
  const thread = rendererMainThread(events)
  if (!thread) return null
  const slices = events
    .filter((e) => e.ph === 'X' && e.pid === thread.pid && e.tid === thread.tid && typeof e.dur === 'number')
    .sort((a, b) => a.ts - b.ts || (b.dur ?? 0) - (a.dur ?? 0))

  const self = new Map<Category, number>()
  const byName = new Map<string, number>()
  const stack: Array<{ end: number; name: string; category: Category; self: number }> = []
  const flush = (entry: { name: string; category: Category; self: number }) => {
    const us = Math.max(0, entry.self)
    self.set(entry.category, (self.get(entry.category) ?? 0) + us)
    byName.set(entry.name, (byName.get(entry.name) ?? 0) + us)
  }

  let longTasks = 0
  let blockingUs = 0
  let first = Infinity
  let last = -Infinity
  for (const e of slices) {
    const dur = e.dur ?? 0
    first = Math.min(first, e.ts)
    last = Math.max(last, e.ts + dur)
    while (stack.length && stack[stack.length - 1].end <= e.ts) flush(stack.pop()!)
    const parent = stack[stack.length - 1]
    // A child that overruns its parent (clock skew between categories) is clipped to it.
    const end = parent ? Math.min(e.ts + dur, parent.end) : e.ts + dur
    if (parent) parent.self -= end - e.ts
    else if (TASK.has(e.name) && dur > 50_000) {
      longTasks++
      blockingUs += dur - 50_000
    }
    stack.push({ end, name: e.name, category: categoryOf(e.name), self: end - e.ts })
  }
  while (stack.length) flush(stack.pop()!)

  return {
    scriptingMs: round(self.get('scripting') ?? 0),
    styleMs: round(self.get('style') ?? 0),
    layoutMs: round(self.get('layout') ?? 0),
    paintMs: round(self.get('paint') ?? 0),
    gcMs: round(self.get('gc') ?? 0),
    otherMs: round(self.get('other') ?? 0),
    longTasks,
    totalBlockingMs: round(blockingUs),
    spanMs: Number.isFinite(first) ? round(last - first) : 0,
    top: [...byName]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([name, us]) => [name, round(us)]),
  }
}

/**
 * Parse a trace as it streams in, keeping only what `mainThreadBreakdown` reads (thread names and
 * complete events). A scroll over 30k rows produces a trace past V8's maximum string length, so
 * it is never held as one string.
 */
export class TraceStreamParser {
  readonly events: TraceEvent[] = []
  private pending = ''
  private inArray = false
  private depth = 0
  private inString = false
  private escaped = false
  private start = -1
  /** Past the array's closing bracket: what follows (`"metadata": {...}`) is not an event. */
  private done = false

  push(chunk: string): void {
    if (this.done) return
    const text = this.pending + chunk
    let consumed = 0
    for (let i = 0; i < text.length && !this.done; i++) {
      const ch = text[i]
      if (!this.inArray) {
        // The events array: `{"traceEvents":[` or a bare top-level `[`.
        if (ch === '[') this.inArray = true
        consumed = i + 1
        continue
      }
      if (this.inString) {
        if (this.escaped) this.escaped = false
        else if (ch === '\\') this.escaped = true
        else if (ch === '"') this.inString = false
        continue
      }
      if (ch === '"') {
        this.inString = true
      } else if (ch === '{') {
        if (this.depth === 0) this.start = i
        this.depth++
      } else if (ch === '}') {
        this.depth--
        if (this.depth === 0) {
          this.keep(JSON.parse(text.slice(this.start, i + 1)) as TraceEvent)
          this.start = -1
          consumed = i + 1
        }
      } else if (this.depth === 0) {
        if (ch === ']') this.done = true
        consumed = i + 1
      }
    }
    this.pending = text.slice(consumed)
    // Rescanning `pending` next time starts outside any string, at the object's opening brace.
    if (this.depth > 0) {
      this.depth = 0
      this.inString = false
      this.escaped = false
    }
  }

  private keep(e: TraceEvent): void {
    if (e.ph === 'M' && e.name === 'thread_name') {
      this.events.push({ name: e.name, ph: 'M', ts: 0, pid: e.pid, tid: e.tid, args: { name: e.args?.name } })
    } else if (e.ph === 'X' && typeof e.dur === 'number') {
      this.events.push({ name: e.name, ph: 'X', ts: e.ts, dur: e.dur, pid: e.pid, tid: e.tid })
    }
  }
}
