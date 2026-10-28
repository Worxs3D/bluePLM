import { useCallback, useEffect, useRef, useState } from 'react'

import { usePDMStore } from '@/stores/pdmStore'
import { log } from '@/lib/logger'
import {
  getMyAssignedSolidWorksLicenses,
  type MyAssignedSolidWorksLicense,
} from '@/lib/supabase/solidworksLicenses'
import {
  evaluateLicenseMatch,
  type LicenseMatchStatus,
  type MachineSerialEntry,
} from '@/lib/solidworksLicense/serial'

export interface MySolidWorksLicenseState {
  /** null until loaded, or when the assignment could not be read (offline, error). */
  assigned: MyAssignedSolidWorksLicense[] | null
  status: LicenseMatchStatus
  loading: boolean
  refresh: () => void
}

async function readMachineSerials(): Promise<MachineSerialEntry[] | null> {
  const read = window.electronAPI?.solidworks?.getLicenseRegistry
  if (!read) return null
  const result = await read()
  if (!result.success) return null
  return result.entries ?? null
}

/**
 * The signed-in user's assigned SOLIDWORKS licences and whether this machine's
 * SOLIDWORKS runs on one of them. Loads once per user and again on refresh()
 * (the indicator calls it when its panel opens); it never polls.
 */
export function useMySolidWorksLicense(): MySolidWorksLicenseState {
  const userId = usePDMStore((s) => s.user?.id)
  const isOfflineMode = usePDMStore((s) => s.isOfflineMode)

  const [assigned, setAssigned] = useState<MyAssignedSolidWorksLicense[] | null>(null)
  const [machine, setMachine] = useState<MachineSerialEntry[] | null>(null)
  const [loading, setLoading] = useState(false)
  const generation = useRef(0)

  const refresh = useCallback(() => {
    if (!userId || isOfflineMode) {
      setAssigned(null)
      setMachine(null)
      return
    }
    const gen = ++generation.current
    setLoading(true)
    void Promise.allSettled([getMyAssignedSolidWorksLicenses(userId), readMachineSerials()]).then(
      ([mine, local]) => {
        if (gen !== generation.current) return
        if (mine.status === 'fulfilled') {
          setAssigned(mine.value)
        } else {
          log.warn('[SWLicense]', 'Could not read my license assignment', { error: mine.reason })
          setAssigned(null)
        }
        if (local.status === 'fulfilled') {
          setMachine(local.value)
        } else {
          log.warn('[SWLicense]', 'Could not read machine license serials', { error: local.reason })
          setMachine(null)
        }
        setLoading(false)
      },
    )
  }, [userId, isOfflineMode])

  useEffect(() => {
    refresh()
  }, [refresh])

  const status: LicenseMatchStatus =
    assigned === null ? 'unknown' : evaluateLicenseMatch(assigned.map((a) => a.serial), machine)

  return { assigned, status, loading, refresh }
}
