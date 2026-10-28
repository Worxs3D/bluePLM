/**
 * Put the real `usePDMStore` back to the state it had when this module was first imported.
 *
 * Integration tests use the real store, slices and actions, not a hand-built `getState()` stub,
 * so state left behind by one test is visible to the next. Call `resetPDMStore()` in `beforeEach`.
 * The snapshot is the store's own initial state (actions included), so a reset never invents a
 * shape the app could not have.
 */
import { usePDMStore } from '@/stores/pdmStore'

type PDMState = ReturnType<typeof usePDMStore.getState>

const initialState: PDMState = usePDMStore.getState()

export function resetPDMStore(overrides: Partial<PDMState> = {}): void {
  usePDMStore.setState({ ...initialState, ...overrides }, true)
}
