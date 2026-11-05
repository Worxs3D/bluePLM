// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { t } from '@/lib/i18n'
import { telemetry } from '@/lib/telemetry'
import { TelemetryDashboard } from './TelemetryGraph'

describe('TelemetryDashboard recording state', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.removeItem('telemetry.config')
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 1),
    )
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    )
  })

  afterEach(() => {
    cleanup()
    telemetry.stop()
    telemetry.clear()
    localStorage.removeItem('telemetry.config')
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('updates the parent header when the graph child starts and stops recording', () => {
    render(<TelemetryDashboard />)

    fireEvent.click(screen.getByTitle(t('performanceTelemetry.start')))

    expect(
      screen.getByRole('button', { name: t('performanceTelemetry.stopRecording') }),
    ).toBeTruthy()
    expect(
      screen.getByText(
        t('performanceTelemetry.recordingAt', { rate: telemetry.getConfig().sampleRateHz }),
      ),
    ).toBeTruthy()

    fireEvent.click(screen.getByTitle(t('performanceTelemetry.pause')))

    expect(
      screen.getByRole('button', { name: t('performanceTelemetry.startRecording') }),
    ).toBeTruthy()
    expect(
      screen.queryByText(
        t('performanceTelemetry.recordingAt', { rate: telemetry.getConfig().sampleRateHz }),
      ),
    ).toBeNull()
  })
})
