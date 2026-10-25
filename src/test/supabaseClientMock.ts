/**
 * Points `@/lib/supabase/client` at the active FakeSupabase.
 *
 * In a test file, before anything imports the client:
 *
 *   vi.mock('@/lib/supabase/client', async (importOriginal) =>
 *     (await import('@/test/supabaseClientMock')).mockClientModule(await importOriginal()),
 *   )
 *
 * Every module reaches the client through `getSupabaseClient()` or the legacy `supabase` proxy,
 * and both are replaced, so relative imports (`'../client'`) see the fake too.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/supabase'

import type { FakeSupabase } from './fakeSupabase'

let active: FakeSupabase | null = null

export function setActiveFakeSupabase(db: FakeSupabase | null): void {
  active = db
}

export function activeFakeSupabase(): FakeSupabase {
  if (!active) throw new Error('No FakeSupabase is active: call createHarness() first')
  return active
}

export function mockClientModule<T extends object>(original: T): T {
  const client = () => activeFakeSupabase().client
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
