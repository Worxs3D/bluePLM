import { describe, expect, it } from 'vitest'
import { getTelemetryTimeAxisX } from './graphScale'

describe('telemetry graph time scale', () => {
  it('places samples by elapsed time when the sampling rate changes', () => {
    const now = 20_000
    const retentionSeconds = 10
    const width = 500
    const timestamps = [10_000, 10_100, 10_200, 11_200, 12_200, 18_200]
    const xPositions = timestamps.map((timestamp) =>
      getTelemetryTimeAxisX(timestamp, now, retentionSeconds, width),
    )

    expect(xPositions).toEqual([0, 5, 10, 60, 110, 410])
    expect(timestamps).toHaveLength(6)
  })
})
