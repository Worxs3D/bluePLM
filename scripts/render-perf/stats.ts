/** Frame and heap statistics for the render-performance runner. Pure, unit-tested. */

export function median(values: readonly number[]): number {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
  if (!sorted.length) return NaN
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export function percentile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  if (!sorted.length) return NaN
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[index]
}

export interface FrameStats {
  frames: number
  durationMs: number
  fps: number
  p50FrameMs: number
  p95FrameMs: number
  maxFrameMs: number
  /** Vsync intervals with no new frame: a 50 ms gap at 60 Hz is two dropped frames. */
  droppedFrames: number
  /** Frames over 1.5 vsync intervals. */
  jankyFrames: number
}

const r1 = (n: number) => Math.round(n * 10) / 10

/** `timestamps` are consecutive rAF times; `vsyncMs` is the display's frame interval. */
export function frameStats(timestamps: readonly number[], vsyncMs: number): FrameStats {
  const intervals: number[] = []
  for (let i = 1; i < timestamps.length; i++) intervals.push(timestamps[i] - timestamps[i - 1])
  const durationMs = timestamps.length > 1 ? timestamps[timestamps.length - 1] - timestamps[0] : 0
  let dropped = 0
  let janky = 0
  for (const d of intervals) {
    dropped += Math.max(0, Math.round(d / vsyncMs) - 1)
    if (d > vsyncMs * 1.5) janky++
  }
  return {
    frames: intervals.length,
    durationMs: Math.round(durationMs),
    fps: durationMs > 0 ? r1((intervals.length * 1000) / durationMs) : 0,
    p50FrameMs: r1(percentile(intervals, 50)),
    p95FrameMs: r1(percentile(intervals, 95)),
    maxFrameMs: r1(intervals.length ? Math.max(...intervals) : NaN),
    droppedFrames: dropped,
    jankyFrames: janky,
  }
}

/** Least-squares slope of y over x. */
export function slope(points: ReadonlyArray<{ x: number; y: number }>): number {
  if (points.length < 2) return 0
  const n = points.length
  const mx = points.reduce((s, p) => s + p.x, 0) / n
  const my = points.reduce((s, p) => s + p.y, 0) / n
  let num = 0
  let den = 0
  for (const p of points) {
    num += (p.x - mx) * (p.y - my)
    den += (p.x - mx) ** 2
  }
  return den === 0 ? 0 : num / den
}

export interface HeapSample {
  /** Minutes since the session started. */
  minute: number
  usedMB: number
}

export interface HeapStats {
  startMB: number
  endMB: number
  peakMB: number
  /** End minus start, after a forced GC at both points. */
  growthMB: number
  /** Fitted growth rate over the session: robust to one noisy sample. */
  slopeMBPer10Min: number
}

export function heapStats(samples: readonly HeapSample[]): HeapStats {
  if (!samples.length) return { startMB: NaN, endMB: NaN, peakMB: NaN, growthMB: NaN, slopeMBPer10Min: NaN }
  const startMB = samples[0].usedMB
  const endMB = samples[samples.length - 1].usedMB
  return {
    startMB: r1(startMB),
    endMB: r1(endMB),
    peakMB: r1(Math.max(...samples.map((s) => s.usedMB))),
    growthMB: r1(endMB - startMB),
    slopeMBPer10Min: r1(slope(samples.map((s) => ({ x: s.minute, y: s.usedMB }))) * 10),
  }
}
