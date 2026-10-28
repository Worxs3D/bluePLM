/**
 * Perf build stand-in for `src/lib/supabase/client.ts`: the same exports, answered by the fake
 * backend the perf boot installs (boot.ts). The perf build redirects every import of the real
 * module here (scripts/render-perf/perfBuildPlugin.ts); production builds never see this file.
 * `supabaseClient.test.ts` keeps the export list equal to the real module's.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { log } from '@/lib/logger'
import type { SupabaseConfig } from '@/lib/supabaseConfig'
import type { Database } from '@/types/supabase'

import { PERF_SUPABASE_URL } from './lenientClient'

let installed: SupabaseClient<Database> | null = null

/** Called once by the perf boot, before the app imports anything that reads the client. */
export function installPerfSupabaseClient(client: SupabaseClient<Database>): void {
  installed = client
}

const PERF_CONFIG: SupabaseConfig = { version: 1, url: PERF_SUPABASE_URL, anonKey: 'perf-anon-key' }

let sessionResolver: ((success: boolean) => void) | null = null

export const authLog = (
  level: 'info' | 'warn' | 'error' | 'debug',
  message: string,
  data?: unknown,
) => {
  const dataObj =
    data && typeof data === 'object'
      ? (data as Record<string, unknown>)
      : data !== undefined
        ? { value: data }
        : undefined
  log[level]('[Auth]', message, dataObj)
}

export function reconfigureSupabase(_config: SupabaseConfig): void {
  // The perf backend is fixed for the session.
}

export function getSupabaseClient(): SupabaseClient<Database> {
  if (!installed) throw new Error('Perf boot: the fake Supabase client is not installed yet')
  return installed
}

export function isSupabaseConfigured(): boolean {
  return true
}

export function getCurrentConfig(): SupabaseConfig | null {
  return PERF_CONFIG
}

export const supabase: SupabaseClient<Database> = new Proxy({} as SupabaseClient<Database>, {
  get(_, prop) {
    const client = getSupabaseClient()
    const value = client[prop as keyof SupabaseClient<Database>]
    return typeof value === 'function' ? value.bind(client) : value
  },
})

export function getSessionResolver(): ((success: boolean) => void) | null {
  return sessionResolver
}

export function setSessionResolver(resolver: ((success: boolean) => void) | null): void {
  sessionResolver = resolver
}

export function getCurrentConfigValues(): { url: string; anonKey: string } | null {
  return { url: PERF_CONFIG.url, anonKey: PERF_CONFIG.anonKey }
}
