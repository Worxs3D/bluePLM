/**
 * The right-click menu customizer's engine: layout types, the entry registry, and the pure
 * functions that sanitize, complete, layer and resolve layouts. Tree edits for the editor live in
 * `edit.ts`; organization writes in `@/lib/supabase/contextMenuTemplates`.
 */

export * from './types'
export * from './entries'
export * from './sanitize'
export * from './complete'
export * from './resolve'
export * from './hash'
export {
  applyQuickPrefs,
  effectiveLayout,
  isSetAsideByForce,
  orgKey,
  orgTemplates,
  type ContextMenuOrgLike,
  type EffectiveLayout,
  type EffectiveSource,
} from './effective'
export { useContextMenuLayout, useEffectiveContextMenu } from './useContextMenuLayout'
