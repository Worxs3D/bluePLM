import { useDeniedModules } from '@/hooks/useDeniedModules'
import { usePDMStore } from '@/stores/pdmStore'
import { isModuleVisible } from '@/types/modules'

/**
 * Whether the Orders entry points outside the module (file context menus, version history) are
 * shown: the module is allowed for this user and visible in their module config (the module or
 * the Supply Chain group switched on), the same rule the activity bar uses.
 */
export function useOrdersAvailable(): boolean {
  const denied = useDeniedModules()
  return usePDMStore((s) => isModuleVisible('orders', s.getEffectiveModuleConfig(), denied))
}
