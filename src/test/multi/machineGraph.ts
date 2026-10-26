/**
 * Everything one simulated machine runs, imported fresh after `vi.resetModules()` so each machine
 * has its own module graph: its own `usePDMStore`, realtime channel slots, load coordination,
 * command registry and caches. `React` is this graph's copy, for hookHost.ts.
 */
export { default as React } from 'react'

export { useLoadFiles } from '@/hooks/useLoadFiles'
export { setLoadFilesSessionContext } from '@/hooks/loadFilesCoordination'
export { useRealtimeSubscriptions } from '@/hooks/useRealtimeSubscriptions'
export { useVaultWatchers } from '@/hooks/useVaultWatchers'
export { executeCommand } from '@/lib/commands'
export { getCommandHistory, resolveCommandConfirm } from '@/lib/commands/executor'
export { analyzeAlignment } from '@/lib/realign/analyzeAlignment'
export { applyAlignment } from '@/lib/realign/applyAlignment'
export {
  defaultAlignmentPlan,
  defaultPendingMoveActions,
} from '@/features/settings/organization/realign/RealignDialog.utils'
export { realtimeChannelStates, resubscribeRealtime, unsubscribeAll } from '@/lib/realtime'
export { usePDMStore } from '@/stores/pdmStore'
