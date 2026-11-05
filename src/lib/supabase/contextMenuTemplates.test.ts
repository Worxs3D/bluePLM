/**
 * The organization menu writers against the typed fake Supabase: each re-reads the stored
 * settings, changes only its own part, refuses a stale template save, and updates the store.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MenuLayout, OrgContextMenuSettings, OrgMenuTemplate } from '@/lib/contextMenu/types'
import { FakeSupabase } from '@/test/fakeSupabase'
import { resetPDMStore } from '@/test/pdmStoreReset'
import { setActiveFakeSupabase } from '@/test/supabaseClientMock'
import type { Organization, OrgSettings, User } from '@/types/pdm'

vi.mock('@/lib/supabase/client', async (importOriginal) =>
  (await import('@/test/supabaseClientMock')).mockClientModule(await importOriginal()),
)
vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const {
  ContextMenuConflictError,
  ContextMenuWriteError,
  deleteOrgMenuTemplate,
  forceOrgContextMenu,
  saveOrgContextMenu,
  saveOrgMenuTemplate,
  setOrgDefaultMenuTemplate,
} = await import('./contextMenuTemplates')
const { usePDMStore } = await import('@/stores/pdmStore')

const LAYOUT: MenuLayout = {
  v: 1,
  nodes: [{ kind: 'entry', id: 'generate.local.step' }, { kind: 'separator' }, { kind: 'entry', id: 'open.open' }],
  hidden: [],
  removedGroups: [],
}

function template(id: string, patch: Partial<OrgMenuTemplate> = {}): OrgMenuTemplate {
  return { id, name: `Template ${id}`, layout: LAYOUT, updated_at: '2026-11-01T10:00:00.000Z', ...patch }
}

let db: FakeSupabase
let orgId: string

function storedSettings(): OrgSettings {
  const row = db.rows('organization').find((r) => r.id === orgId)
  return row?.settings as OrgSettings
}

/** Another admin's write straight to the row, between this editor's load and its save. */
function concurrentWrite(patch: Partial<OrgSettings>): void {
  const row = db.rows('organization').find((r) => r.id === orgId)
  if (!row) throw new Error('no organization row')
  row.settings = { ...(row.settings as OrgSettings), ...patch }
}

beforeEach(() => {
  resetPDMStore()
  db = new FakeSupabase()
  setActiveFakeSupabase(db)
  const initial = {
    api_url: 'https://api.example.test',
    context_menu: { templates: [template('t1')], default_template_id: 't1' },
  }
  const row = db.seed('organization', { name: 'Example', slug: 'example', settings: initial as never })
  orgId = row.id
  usePDMStore.setState({
    organization: { id: orgId, name: 'Example', settings: initial } as unknown as Organization,
    user: { id: 'user-admin' } as unknown as User,
  })
})

describe('saveOrgMenuTemplate', () => {
  it('adds a new template, stamped, and keeps every other settings key as stored', async () => {
    concurrentWrite({ require_checkout: true })
    const result = await saveOrgMenuTemplate(orgId, template('t2', { updated_at: '' }), null)

    expect(result.templates.map((t) => t.id)).toEqual(['t1', 't2'])
    const saved = result.templates[1]
    expect(saved.updated_by).toBe('user-admin')
    expect(Number.isFinite(Date.parse(saved.updated_at))).toBe(true)
    const stored = storedSettings()
    expect(stored.api_url).toBe('https://api.example.test')
    expect(stored.require_checkout).toBe(true)
    expect(stored.context_menu?.default_template_id).toBe('t1')
    // The store follows at once.
    expect(usePDMStore.getState().organization?.settings.context_menu?.templates).toHaveLength(2)
    expect(usePDMStore.getState().organization?.settings.require_checkout).toBe(true)
  })

  it('replaces a template when it is unchanged since it was loaded', async () => {
    const result = await saveOrgMenuTemplate(orgId, template('t1', { name: 'Renamed' }), '2026-11-01T10:00:00.000Z')
    expect(result.templates).toHaveLength(1)
    expect(result.templates[0].name).toBe('Renamed')
    expect(result.templates[0].updated_at).not.toBe('2026-11-01T10:00:00.000Z')
  })

  it('refuses a template someone else changed since, and writes nothing', async () => {
    const before = structuredClone(storedSettings())
    await expect(saveOrgMenuTemplate(orgId, template('t1'), '2026-10-01T00:00:00.000Z')).rejects.toBeInstanceOf(
      ContextMenuConflictError,
    )
    await expect(saveOrgMenuTemplate(orgId, template('t1'), null)).rejects.toBeInstanceOf(ContextMenuConflictError)
    await expect(saveOrgMenuTemplate(orgId, template('gone'), '2026-11-01T10:00:00.000Z')).rejects.toBeInstanceOf(
      ContextMenuConflictError,
    )
    expect(storedSettings()).toEqual(before)
  })

  it('on a conflict, puts the stored template into the store, so Reload opens the fresh one', async () => {
    concurrentWrite({
      context_menu: { templates: [template('t1', { name: 'Theirs', updated_at: '2026-11-04T09:00:00.000Z' })] },
    })
    await expect(saveOrgMenuTemplate(orgId, template('t1'), '2026-11-01T10:00:00.000Z')).rejects.toBeInstanceOf(
      ContextMenuConflictError,
    )
    const inStore = usePDMStore.getState().organization?.settings.context_menu?.templates?.[0]
    expect(inStore?.name).toBe('Theirs')
    expect(inStore?.updated_at).toBe('2026-11-04T09:00:00.000Z')
  })

  it('keeps another template changed concurrently', async () => {
    const other = template('t9', { updated_at: '2026-11-03T00:00:00.000Z' })
    concurrentWrite({ context_menu: { templates: [template('t1'), other] } as OrgContextMenuSettings })
    const result = await saveOrgMenuTemplate(orgId, template('t1', { name: 'Mine' }), '2026-11-01T10:00:00.000Z')
    expect(result.templates.map((t) => t.name)).toEqual(['Mine', 'Template t9'])
  })

  it('refuses a template that sanitize cannot keep', async () => {
    await expect(saveOrgMenuTemplate(orgId, template('t3', { name: '   ' }), null)).rejects.toBeInstanceOf(
      ContextMenuWriteError,
    )
  })

  it('throws the write error and leaves the store alone', async () => {
    db.failNext('organization', 'update', { message: 'denied', code: '42501' })
    const before = usePDMStore.getState().organization
    await expect(saveOrgMenuTemplate(orgId, template('t2'), null)).rejects.toMatchObject({ message: 'denied' })
    expect(usePDMStore.getState().organization).toBe(before)
  })
})

describe('the other writers', () => {
  it('deletes a template and clears the default that named it', async () => {
    const result = await deleteOrgMenuTemplate(orgId, 't1')
    expect(result.templates).toEqual([])
    expect(result.default_template_id).toBeUndefined()
    expect(storedSettings().api_url).toBe('https://api.example.test')
  })

  it('sets and clears the organization default', async () => {
    await saveOrgMenuTemplate(orgId, template('t2'), null)
    expect((await setOrgDefaultMenuTemplate(orgId, 't2')).default_template_id).toBe('t2')
    expect((await setOrgDefaultMenuTemplate(orgId, null)).default_template_id).toBeUndefined()
    await expect(setOrgDefaultMenuTemplate(orgId, 'nope')).rejects.toMatchObject({ code: 'UNKNOWN_TEMPLATE' })
  })

  it('stamps forced_at', async () => {
    const result = await forceOrgContextMenu(orgId)
    expect(Number.isFinite(Date.parse(result.forced_at ?? ''))).toBe(true)
    expect(usePDMStore.getState().organization?.settings.context_menu?.forced_at).toBe(result.forced_at)
  })

  it('saveOrgContextMenu replaces the whole menu settings, sanitized, keeping other keys', async () => {
    concurrentWrite({ require_checkout: true })
    const next = { templates: [template('a'), template('app-default'), template('a')], default_template_id: 'zzz' }
    const settings = await saveOrgContextMenu(orgId, next as OrgContextMenuSettings)
    expect(settings.context_menu?.templates.map((t) => t.id)).toEqual(['a'])
    expect(settings.context_menu?.default_template_id).toBeUndefined()
    expect(settings.require_checkout).toBe(true)
    expect(settings.api_url).toBe('https://api.example.test')
  })

  it('throws when the organization cannot be read', async () => {
    await expect(forceOrgContextMenu('00000000-0000-4000-8000-000000000000')).rejects.toBeTruthy()
  })
})
