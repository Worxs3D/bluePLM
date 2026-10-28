/**
 * Points `@/lib/supabase/client` at the client of whichever simulated machine is running.
 *
 *   vi.mock('@/lib/supabase/client', async (importOriginal) =>
 *     (await import('@/test/multi/clientMock')).mockMachineClientModule(await importOriginal()),
 *   )
 *
 * Vitest evaluates a mocked module once and keeps it across `vi.resetModules()`, so a per-graph
 * `setActiveFakeSupabase` (supabaseClientMock.ts) would bind every machine to the first one's
 * client. This mock asks the machine context on every call instead.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/supabase'

import { currentMachine } from './context'

export function mockMachineClientModule<T extends object>(original: T): T {
  const client = () => currentMachine().client
  const proxy = new Proxy({} as SupabaseClient<Database>, {
    get: (_target, prop) => Reflect.get(client(), prop),
  })
  return {
    ...original,
    getSupabaseClient: client,
    supabase: proxy,
    isSupabaseConfigured: () => true,
  }
}
