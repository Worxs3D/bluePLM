import { useCallback, useEffect, useMemo, useState } from 'react'

import { t } from '@/lib/i18n'
import { log } from '@/lib/logger'
import { usePDMStore } from '@/stores/pdmStore'
import {
  getInspectionMethods,
  addInspectionMethod,
  updateInspectionMethod,
  deleteInspectionMethod,
  type InspectionMethodOption,
} from '@/lib/supabase'

import { DEFAULT_INSPECTION_METHODS } from './inspectionColumns'

/** The org's inspection methods, merged with the built-in ones, and their add / rename / remove. */
export function useInspectionMethods(orgId: string | undefined, userId: string | undefined) {
  const addToast = usePDMStore((s) => s.addToast)
  const [orgMethods, setOrgMethods] = useState<InspectionMethodOption[]>([])

  useEffect(() => {
    if (!orgId) return
    let cancelled = false
    getInspectionMethods(orgId)
      .then((result) => {
        if (cancelled) return
        if (result.success && result.methods) setOrgMethods(result.methods)
      })
      .catch((error) =>
        log.warn('[InspectionTab]', 'Methods load exception', { error: String(error) }),
      )
    return () => {
      cancelled = true
    }
  }, [orgId])

  // Built-in + org-defined methods, de-duplicated (case-insensitive) and sorted for the dropdown.
  const methodOptions = useMemo(() => {
    const seen = new Map<string, string>()
    for (const name of [...DEFAULT_INSPECTION_METHODS, ...orgMethods.map((m) => m.name)]) {
      const key = name.trim().toLowerCase()
      if (key && !seen.has(key)) seen.set(key, name.trim())
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  }, [orgMethods])

  const addMethod = useCallback(
    async (name: string): Promise<boolean> => {
      const trimmed = name.trim()
      if (!trimmed || !orgId || !userId) return false
      const result = await addInspectionMethod(orgId, userId, trimmed)
      if (!result.success || !result.method) {
        addToast('error', result.error || t('common.error'))
        return false
      }
      const added = result.method
      setOrgMethods((prev) => (prev.some((m) => m.id === added.id) ? prev : [...prev, added]))
      return true
    },
    [orgId, userId, addToast],
  )

  const renameMethod = useCallback(
    async (id: string, name: string): Promise<boolean> => {
      const trimmed = name.trim()
      if (!trimmed || !orgId) return false
      const result = await updateInspectionMethod(orgId, id, trimmed)
      if (!result.success) {
        addToast('error', result.error || t('common.error'))
        return false
      }
      setOrgMethods((prev) => prev.map((m) => (m.id === id ? { ...m, name: trimmed } : m)))
      return true
    },
    [orgId, addToast],
  )

  const removeMethod = useCallback(
    async (id: string): Promise<boolean> => {
      if (!orgId) return false
      const result = await deleteInspectionMethod(orgId, id)
      if (!result.success) {
        addToast('error', result.error || t('common.error'))
        return false
      }
      setOrgMethods((prev) => prev.filter((m) => m.id !== id))
      return true
    },
    [orgId, addToast],
  )

  return { orgMethods, methodOptions, addMethod, renameMethod, removeMethod }
}
