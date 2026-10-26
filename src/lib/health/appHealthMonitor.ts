/**
 * The health monitor wired to the app: the real realtime channels, the vault cache, the JS heap,
 * the store and the rebuildable caches. Started once by App for the main window.
 */
import { probeVaultCache } from '@/lib/cache/vaultFileCache'
import { log } from '@/lib/logger'
import { realtimeChannelStates, resubscribeRealtime } from '@/lib/realtime'
import { usePDMStore } from '@/stores/pdmStore'

import { dropRebuildableCaches, rebuildableCacheSizes, registerRebuildableCache } from './cacheRegistry'
import { collectionSizes } from './collectionSizes'
import { createHealthMonitor, type HealthMonitor } from './healthMonitor'

interface ChromiumMemory {
  usedJSHeapSize: number
  jsHeapSizeLimit: number
}

const MB = 1024 * 1024

let monitor: HealthMonitor | null = null

/** The running monitor, for the soak's sampler and diagnostics. */
export function getAppHealthMonitor(): HealthMonitor | null {
  return monitor
}

function prefixed(sizes: Record<string, number>, prefix: string): Record<string, number> {
  return Object.fromEntries(Object.entries(sizes).map(([k, v]) => [prefix + k, v]))
}

/** Start the monitor; returns the stop function. A second start while running is a no-op. */
export function startAppHealthMonitor(): () => void {
  if (monitor) return () => {}

  // Configuration, BOM and drawing-reference rows for expanded files: refetched on expand.
  registerRebuildableCache('config-caches', {
    size: () => {
      const s = usePDMStore.getState()
      return s.fileConfigurations.size + s.configBomData.size + s.drawingRefData.size + s.configDrawingData.size
    },
    drop: () => usePDMStore.getState().clearAllConfigCaches(),
  })

  const running = createHealthMonitor({
    now: () => Date.now(),
    online: () => typeof navigator === 'undefined' || navigator.onLine,
    realtimeStates: realtimeChannelStates,
    resubscribe: resubscribeRealtime,
    probeVaultCache,
    heap: () => {
      const memory = (performance as Performance & { memory?: ChromiumMemory }).memory
      if (!memory?.jsHeapSizeLimit) return null
      return { usedMB: memory.usedJSHeapSize / MB, limitMB: memory.jsHeapSizeLimit / MB }
    },
    dropCaches: dropRebuildableCaches,
    diagnostics: () => ({
      ...prefixed(collectionSizes(usePDMStore.getState()), 'store.'),
      ...prefixed(rebuildableCacheSizes(), 'cache.'),
    }),
    log: {
      info: (message, data) => log.info('[Health]', message, data),
      warn: (message, data) => log.warn('[Health]', message, data),
    },
  })
  monitor = running
  running.start()
  return () => {
    running.stop()
    if (monitor === running) monitor = null
  }
}
