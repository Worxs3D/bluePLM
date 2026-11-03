import type { MdbAuthCapability } from './contracts/mdbAuth'

/** Explicit selection only. The bridge is supplied by the calling entry consumer. */
export interface MdbAdapter {
  readonly kind: 'mdb'
  readonly auth: MdbAuthCapability
}

export function createMdbAdapter(auth: MdbAuthCapability): MdbAdapter {
  return { kind: 'mdb', auth }
}

/** Resolve an MDB entry without importing the production Supabase adapter. */
export function resolveMdbBackend(auth: MdbAuthCapability): MdbAdapter {
  return createMdbAdapter(auth)
}
