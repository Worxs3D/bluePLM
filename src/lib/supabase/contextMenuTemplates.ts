/**
 * Writes `organization.settings.context_menu` (right-click menu templates; admins only, which the
 * `organization` update policy already enforces).
 *
 * Every writer re-reads the stored settings first and changes only its own part, so a change to
 * another settings key, or to another template, that was stored before that read is kept (one
 * landing between the read and the write is overwritten: there is no row lock). A template save is also
 * optimistic: it is refused (`ContextMenuConflictError`) when the stored template's `updated_at`
 * is not the one the editor loaded. The result is sanitized, written with `.select().single()`
 * (no row back = no permission, thrown), and put into the store's organization at once, so the
 * menu follows without a reload.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import { sanitizeOrgContextMenu } from '@/lib/contextMenu/sanitize'
import {
  APP_DEFAULT_TEMPLATE_ID,
  MAX_TEMPLATES,
  type OrgContextMenuSettings,
  type OrgMenuTemplate,
} from '@/lib/contextMenu/types'
import { usePDMStore } from '@/stores/pdmStore'
import type { OrgSettings } from '@/types/pdm'

import { getSupabaseClient } from './client'

/** The stored template changed (or was deleted, or created) since the editor loaded it. */
export class ContextMenuConflictError extends Error {
  readonly templateId: string
  constructor(templateId: string) {
    super(`The menu template ${templateId} was changed by someone else; reload it first.`)
    this.name = 'ContextMenuConflictError'
    this.templateId = templateId
  }
}

/** The save could not be made: no organization row came back, too many templates, unknown template. */
export class ContextMenuWriteError extends Error {
  readonly code: 'NO_ROW' | 'TOO_MANY_TEMPLATES' | 'UNKNOWN_TEMPLATE' | 'INVALID'
  constructor(code: ContextMenuWriteError['code'], message: string) {
    super(message)
    this.name = 'ContextMenuWriteError'
    this.code = code
  }
}

function db(): SupabaseClient {
  return getSupabaseClient() as unknown as SupabaseClient
}

async function readOrgSettings(orgId: string): Promise<OrgSettings> {
  const { data, error } = await db().from('organization').select('settings').eq('id', orgId).single()
  if (error) throw error
  if (!data) throw new ContextMenuWriteError('NO_ROW', `Organization ${orgId} was not found`)
  return ((data as { settings: OrgSettings | null }).settings ?? {}) as OrgSettings
}

async function writeOrgSettings(orgId: string, settings: OrgSettings): Promise<OrgSettings> {
  const { data, error } = await db()
    .from('organization')
    .update({ settings })
    .eq('id', orgId)
    .select('settings')
    .single()
  if (error) throw error
  if (!data) {
    throw new ContextMenuWriteError('NO_ROW', 'The organization settings were not saved (no permission?)')
  }
  return ((data as { settings: OrgSettings | null }).settings ?? settings) as OrgSettings
}

function syncStore(orgId: string, settings: OrgSettings): void {
  const { organization, setOrganization } = usePDMStore.getState()
  if (organization?.id === orgId) setOrganization({ ...organization, settings })
}

/**
 * Re-read, let `edit` change the sanitized menu settings, write the result back with every other
 * settings key as stored, and update the store.
 */
async function editOrgContextMenu(
  orgId: string,
  edit: (current: OrgContextMenuSettings) => OrgContextMenuSettings,
): Promise<OrgContextMenuSettings> {
  const stored = await readOrgSettings(orgId)
  const current = sanitizeOrgContextMenu(stored.context_menu) ?? { templates: [] }
  let edited: OrgContextMenuSettings
  try {
    edited = edit(current)
  } catch (error) {
    // A conflict: put what is stored now into the store, so the editor's Reload opens it.
    if (error instanceof ContextMenuConflictError) syncStore(orgId, stored)
    throw error
  }
  const next = sanitizeOrgContextMenu(edited)
  if (!next) throw new ContextMenuWriteError('INVALID', 'The menu settings could not be read')
  const written = await writeOrgSettings(orgId, { ...stored, context_menu: next })
  syncStore(orgId, written)
  return sanitizeOrgContextMenu(written.context_menu) ?? next
}

/** Replace the whole `context_menu` (sanitized), keeping every other settings key as stored. */
export async function saveOrgContextMenu(orgId: string, next: OrgContextMenuSettings): Promise<OrgSettings> {
  const clean = sanitizeOrgContextMenu(next)
  if (!clean) throw new ContextMenuWriteError('INVALID', 'The menu settings could not be read')
  const stored = await readOrgSettings(orgId)
  const written = await writeOrgSettings(orgId, { ...stored, context_menu: clean })
  syncStore(orgId, written)
  return written
}

/**
 * Create or replace one template. `expectedUpdatedAt` is the stored template's `updated_at` when
 * the editor loaded it, null for a new one; anything else stored now is a conflict. The template
 * is stamped with the time and the current user.
 */
export async function saveOrgMenuTemplate(
  orgId: string,
  template: OrgMenuTemplate,
  expectedUpdatedAt: string | null,
): Promise<OrgContextMenuSettings> {
  const userId = usePDMStore.getState().user?.id
  const stamped: OrgMenuTemplate = {
    ...template,
    updated_at: new Date().toISOString(),
    ...(userId ? { updated_by: userId } : {}),
  }
  const result = await editOrgContextMenu(orgId, (current) => {
    const index = current.templates.findIndex((t) => t.id === template.id)
    const stored = index >= 0 ? current.templates[index] : null
    if ((stored?.updated_at ?? null) !== expectedUpdatedAt) throw new ContextMenuConflictError(template.id)
    if (!stored && current.templates.length >= MAX_TEMPLATES) {
      throw new ContextMenuWriteError('TOO_MANY_TEMPLATES', `At most ${MAX_TEMPLATES} menu templates`)
    }
    const templates = [...current.templates]
    if (index >= 0) templates[index] = stamped
    else templates.push(stamped)
    return { ...current, templates }
  })
  if (!result.templates.some((t) => t.id === template.id)) {
    // Sanitize refused it (a bad id or an empty name): nothing of it was stored.
    throw new ContextMenuWriteError('INVALID', 'The menu template could not be saved')
  }
  return result
}

/** Delete one template; the organization default is cleared when it was that template. */
export async function deleteOrgMenuTemplate(orgId: string, templateId: string): Promise<OrgContextMenuSettings> {
  return editOrgContextMenu(orgId, (current) => {
    const next: OrgContextMenuSettings = {
      ...current,
      templates: current.templates.filter((t) => t.id !== templateId),
    }
    if (next.default_template_id === templateId) delete next.default_template_id
    return next
  })
}

/** Make a template the organization default; null (or the app default id) = the app default. */
export async function setOrgDefaultMenuTemplate(
  orgId: string,
  templateId: string | null,
): Promise<OrgContextMenuSettings> {
  return editOrgContextMenu(orgId, (current) => {
    const next: OrgContextMenuSettings = { ...current }
    delete next.default_template_id
    if (templateId === null || templateId === APP_DEFAULT_TEMPLATE_ID) return next
    if (!current.templates.some((t) => t.id === templateId)) {
      throw new ContextMenuWriteError('UNKNOWN_TEMPLATE', `No menu template ${templateId}`)
    }
    next.default_template_id = templateId
    return next
  })
}

/**
 * "Apply to everyone now": stamps `forced_at`, so every user's own layout made before it is set
 * aside and they follow their template again (each can keep theirs from the settings page).
 */
export async function forceOrgContextMenu(orgId: string): Promise<OrgContextMenuSettings> {
  const now = new Date().toISOString()
  return editOrgContextMenu(orgId, (current) => ({ ...current, forced_at: now }))
}
