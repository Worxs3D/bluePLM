import { describe, expect, it, vi } from 'vitest'

import {
  createServiceHealth,
  createServiceHealthMonitor,
  parseTasklistMemoryMb,
  shedQueue,
  type ServiceHealthOptions,
} from './swServiceHealth'

const OPTIONS: ServiceHealthOptions = {
  maxRssMb: 1000,
  latencyFactor: 4,
  latencyMinIncreaseMs: 1000,
  window: 10,
  minRestartIntervalMs: 60_000,
}

describe('shedQueue', () => {
  it('keeps the queue at its limit however many commands arrive', () => {
    const queue: Array<{ priority: number; queuedAt: number; id: number }> = []
    let shed = 0
    for (let i = 0; i < 5_000; i++) {
      queue.push({ priority: i % 3, queuedAt: i, id: i })
      shed += shedQueue(queue, 100).length
      expect(queue.length).toBeLessThanOrEqual(100)
    }
    expect(shed).toBe(4_900)
  })

  it('sheds the lowest priority first, oldest first within it', () => {
    const queue = [
      { priority: 2, queuedAt: 1 },
      { priority: 0, queuedAt: 3 },
      { priority: 0, queuedAt: 2 },
      { priority: 1, queuedAt: 0 },
    ]
    const shed = shedQueue(queue, 2)
    // Returned in queue order.
    expect(shed).toEqual([
      { priority: 0, queuedAt: 3 },
      { priority: 0, queuedAt: 2 },
    ])
    expect(queue).toEqual([
      { priority: 2, queuedAt: 1 },
      { priority: 1, queuedAt: 0 },
    ])
  })
})

describe('service health verdict', () => {
  it('asks for a restart when memory passes the limit', () => {
    const health = createServiceHealth(OPTIONS)
    health.recordRss(900)
    expect(health.verdict(1e9)).toBeNull()
    health.recordRss(1200)
    expect(health.verdict(1e9)).toMatch(/memory 1200 MB/)
  })

  it('asks for a restart when latency drifts well past its baseline', () => {
    const health = createServiceHealth(OPTIONS)
    for (let i = 0; i < 10; i++) health.recordCompletion('getProperties', 200)
    for (let i = 0; i < 10; i++) health.recordCompletion('getProperties', 600)
    expect(health.verdict(1e9)).toBeNull() // 3x is under the factor
    for (let i = 0; i < 10; i++) health.recordCompletion('getProperties', 1500)
    expect(health.verdict(1e9)).toMatch(/latency 1500 ms/)
  })

  it('ignores actions whose time depends on the file, and keeps a bounded window', () => {
    const health = createServiceHealth(OPTIONS)
    for (let i = 0; i < 10_000; i++) health.recordCompletion('exportPdf', 60_000)
    expect(health.snapshot().baselineMs).toBeNull()
    for (let i = 0; i < 10_000; i++) health.recordCompletion('ping', 5)
    expect(health.snapshot().recentMs).toBe(5)
  })

  it('does not restart again inside the minimum interval', () => {
    const health = createServiceHealth(OPTIONS)
    health.onRestarted('memory', 1_000)
    health.recordRss(5000)
    expect(health.verdict(30_000)).toBeNull()
    expect(health.verdict(70_000)).not.toBeNull()
    expect(health.snapshot().restarts).toBe(1)
  })
})

describe('service health monitor', () => {
  const setup = (busy: boolean) => {
    const health = createServiceHealth(OPTIONS)
    const restart = vi.fn(async () => ({ success: true }))
    const monitor = createServiceHealthMonitor({
      health,
      pid: () => 1234,
      busy: () => busy,
      restart,
      log: () => {},
      warn: () => {},
      readRssMb: async () => 2000,
      now: () => 1e9,
    })
    return { health, restart, monitor }
  }

  it('restarts a drifted, idle service once, and logs why', async () => {
    const { restart, monitor, health } = setup(false)
    expect(await monitor.check()).toBe('restarted')
    expect(restart).toHaveBeenCalledWith(expect.stringMatching(/^HEALTH RESTART: service memory 2000 MB/))
    // Inside the minimum interval: no second restart.
    expect(await monitor.check()).toBe('healthy')
    expect(health.snapshot().restarts).toBe(1)
  })

  it('waits while a job is running', async () => {
    const { restart, monitor } = setup(true)
    expect(await monitor.check()).toBe('waiting-for-idle')
    expect(restart).not.toHaveBeenCalled()
  })

  it('leaves no interval behind after stop', () => {
    vi.useFakeTimers()
    try {
      const { monitor } = setup(false)
      monitor.start()
      monitor.start()
      expect(vi.getTimerCount()).toBe(1)
      monitor.stop()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('parseTasklistMemoryMb', () => {
  it('reads the memory column in any digit grouping', () => {
    expect(parseTasklistMemoryMb('"svc.exe","1234","Console","1","123,456 K"')).toBe(120.6)
    expect(parseTasklistMemoryMb('"svc.exe","1234","Console","1","123.456 K"')).toBe(120.6)
    expect(parseTasklistMemoryMb('INFO: No tasks are running')).toBeNull()
  })
})
