import { getActiveBackendKind } from './backend'

export type ClientRole = 'admin' | 'engineer' | 'viewer'

/** Translate the MDB server role without promoting unknown values. */
export function mapMdbRole(role: string): ClientRole | null {
  switch (role) {
    case 'owner':
    case 'admin':
      return 'admin'
    case 'member':
      return 'engineer'
    case 'viewer':
      return 'viewer'
    default:
      return null
  }
}

/** Single backend-selection seam for auth and data adapters. */
export function isMdbBackendActive(): boolean {
  return getActiveBackendKind() === 'community'
}
