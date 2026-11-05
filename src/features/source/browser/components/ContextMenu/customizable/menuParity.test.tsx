// @vitest-environment jsdom
/**
 * The file list's right-click menu drawn from layouts, over the real file pane and store.
 *
 * Parity: with the app default layout, every fixture shows the rows and separators the menu
 * showed before layouts existed. "Before" was recorded by running this file's `menuShape` against
 * the menu at 6461b64e (the commit the customizer starts from), so the expectations below are
 * that output, with these deliberate differences (each named where it applies):
 *
 * - D1: the SOLIDWORKS block (Insert into Assembly, Duplicate) is followed by a separator. The
 *   old menu drew one only when an assembly submenu or Download / Get Latest followed; a layout
 *   has no conditional separators (DEFAULT_LAYOUT, `entries.ts`).
 * - D2: a menu never starts with a separator (a cloud-only file used to: the sync block's own).
 * - D3: "More actions (n)" counts the rows it hides; the old count was an estimate (7 for 6 rows).
 * - D4: the collapse is decided on the rows actually shown (`AUTO_COLLAPSE_ROWS`); a folder with
 *   14 rows now shows its 2 collaboration rows inline (the old estimate collapsed them).
 * - D5: no separator before the sync block (Download, Get Latest): the old menu drew one when
 *   either showed; a layout has none that depends on them (audit decision, `entries.ts`).
 * - The SOLIDWORKS block is a built-in inline group: set apart only when one of its entries
 *   applies, and with no heading.
 * - Group labels come from `contextMenuCustomizer.group.*` and the "More actions" row from
 *   `contextMenuCustomizer.menu.*`, so those rows are compared through `t()`.
 * - The fixed "Customize this menu…" row (and its separator) is new and left out of the shape.
 */
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/client', async (importOriginal) =>
  (await import('@/test/supabaseClientMock')).mockClientModule(await importOriginal()),
)

const { FilePane } = await import('../../../FilePane')
const { t } = await import('@/lib/i18n')
const { usePDMStore } = await import('@/stores/pdmStore')
const { createHarness, OTHER_USER_ID } = await import('@/test/harness')
const { installDomShims, lenientElectron, signedInVault } = await import('@/test/render')
const { CONTEXT_MENU_ENTRIES, CONTEXT_MENU_GROUPS } = await import('@/lib/contextMenu/entries')
const { orgKey } = await import('@/lib/contextMenu/effective')
const { LIST_MENU_ENTRY_IDS } = await import('./listEntries')
const { MAX_USER_GROUPS } = await import('@/lib/contextMenu/types')

import type { ContextMenuEntryId, ContextMenuGroupId } from '@/lib/contextMenu/entries'
import type { LayoutNode, MenuLayout } from '@/lib/contextMenu/types'

type Harness = Awaited<ReturnType<typeof createHarness>>
let h: Harness

const PLAIN = 'Parts/plain.sldprt'
const OTHER = 'Parts/other.sldprt'
const DRAWING = 'Parts/mine.slddrw'
const CLOUD = 'Parts/cloud.sldprt'
const THEIRS = 'Parts/theirs.sldprt'

function row(relativePath: string): HTMLElement {
  const path = h.absolute(relativePath)
  const match = Array.from(document.querySelectorAll<HTMLElement>('tr[data-path]')).find(
    (el) => el.getAttribute('data-path') === path,
  )
  if (!match) throw new Error(`no row for ${relativePath}`)
  return match
}

/** The open menu's rows in order: text (+ " [disabled]"), "---", "[toggle] …", "[heading] …". */
function menuShape(): string[] {
  const root = document.querySelector('.context-menu')
  if (!root) return ['<no menu>']
  const out: string[] = []
  for (const el of root.querySelectorAll<HTMLElement>(
    '.context-menu-item, .context-menu-separator, .context-menu-expand-toggle, [data-menu-heading]',
  )) {
    if (el.closest('[data-context-submenu]') || el.hasAttribute('data-menu-customize')) continue
    // A flyout row's arrow is an icon (SubmenuArrow); read it as "▶".
    const text = `${(el.textContent ?? '').replace(/\s+/g, ' ').trim()}${el.querySelector(':scope > [data-submenu-arrow]') ? '▶' : ''}`
    if (el.classList.contains('context-menu-separator')) out.push('---')
    else if (el.classList.contains('context-menu-expand-toggle')) out.push(`[toggle] ${text}`)
    else if (el.hasAttribute('data-menu-heading')) out.push(`[heading] ${text}`)
    else out.push(`${text}${el.classList.contains('disabled') ? ' [disabled]' : ''}`)
  }
  return out
}

/** The entry ids the open menu resolved to (the customize row carries them). */
function resolvedIds(): string[] {
  const value = document
    .querySelector('.context-menu [data-menu-customize][data-entries]')
    ?.getAttribute('data-entries')
  return value ? value.split(' ').filter(Boolean) : []
}

async function openMenu(relativePath: string) {
  await act(async () => {
    fireEvent.contextMenu(row(relativePath), { clientX: 10, clientY: 10 })
  })
}

async function closeMenu() {
  await act(async () => {
    fireEvent.keyDown(document, { key: 'Escape' })
  })
}

async function capture(
  relativePath: string,
): Promise<{ collapsed: string[]; expanded: string[] | null }> {
  await openMenu(relativePath)
  const collapsed = menuShape()
  const toggle = document.querySelector<HTMLElement>('.context-menu .context-menu-expand-toggle')
  let expanded: string[] | null = null
  if (toggle) {
    await act(async () => {
      fireEvent.click(toggle)
    })
    expanded = menuShape()
  }
  await closeMenu()
  return { collapsed, expanded }
}

async function fresh(folder: string, selected: string[] = []) {
  cleanup()
  await act(async () => {
    usePDMStore.setState({ currentFolder: folder, selectedFiles: selected })
  })
  render(<FilePane onRefresh={() => {}} />)
}

function setLayout(layout: MenuLayout | null) {
  const key = orgKey(usePDMStore.getState().organization?.id)
  act(() => {
    usePDMStore
      .getState()
      .setContextMenuPrefs(
        key,
        layout
          ? {
              templateId: null,
              pinned: [],
              hidden: [],
              custom: layout,
              updatedAt: new Date().toISOString(),
            }
          : null,
      )
  })
}

const ALL_GROUPS = Object.keys(CONTEXT_MENU_GROUPS) as ContextMenuGroupId[]

/** A layout of exactly `nodes`: every other entry hidden and every built-in group removed. */
function onlyLayout(nodes: LayoutNode[]): MenuLayout {
  const listed = new Set<string>()
  const walk = (list: LayoutNode[]) => {
    for (const node of list) {
      if (node.kind === 'entry') listed.add(node.id)
      else if (node.kind === 'group') walk(node.children)
    }
  }
  walk(nodes)
  return {
    v: 1,
    nodes,
    hidden: CONTEXT_MENU_ENTRIES.map((e) => e.id as ContextMenuEntryId).filter(
      (id) => !listed.has(id),
    ),
    removedGroups: ALL_GROUPS,
  }
}

const group = (id: ContextMenuGroupId) => `${t(`contextMenuCustomizer.group.${id}`)}▶`
const more = (count: number) => `[toggle] ${t('contextMenuCustomizer.menu.moreActions', { count })}`
const less = `[toggle] ${t('contextMenuCustomizer.menu.lessActions')}`
const UNDO = 'UndoCtrl+Z [disabled]'

beforeEach(async () => {
  h = await createHarness()
  installDomShims()
  lenientElectron(h)
  signedInVault()
  h.seedSolidWorksFile(PLAIN, { part_number: 'PN-1' })
  h.seedSolidWorksFile(OTHER, { part_number: 'PN-2' })
  h.seedSolidWorksFile(DRAWING, { part_number: 'PN-3' })
  h.seedSolidWorksFile(CLOUD, { part_number: 'PN-4' })
  h.seedSolidWorksFile(THEIRS, { part_number: 'PN-5', checked_out_by: OTHER_USER_ID })
  await h.checkOut(DRAWING)
  h.electron.disk.remove(h.absolute(CLOUD))
  await h.reload()
})

afterEach(() => {
  cleanup()
})

describe('the default layout draws the menu as before', () => {
  it('a synced part, checked in', async () => {
    await fresh('Parts')
    const head = [
      'Open',
      '---',
      'Insert into Assembly▶',
      'Duplicate part',
      '---', // D1
      'Check Out',
      'Check In (already in) [disabled]',
      'Change State▶',
      group('generate'),
      'Reviews▶',
      'Orders▶',
      '---',
      group('fileActions'),
      group('edit'),
      '---',
      'Remove Local Copy (1 file)',
      'Delete from Server (1 file)',
      'Delete Local & Server (1 file)',
      '---',
      UNDO,
      '---',
    ]
    const collab = [
      'Where Used',
      'Properties',
      'Notify Someone',
      'Watch File',
      'Copy Share Link',
      'Add to ECO',
    ]
    expect(await capture(PLAIN)).toEqual({
      collapsed: [...head, more(6)], // D3: was (7); collapsed as before
      expanded: [...head, less, ...collab],
    })
  })

  it('a drawing I have checked out', async () => {
    await fresh('Parts')
    const head = [
      'Open',
      'Check Out (already out) [disabled]',
      'Check In',
      'Discard Checkout',
      'Change State▶',
      'Sync Metadata',
      group('generate'),
      'Reviews▶',
      'Orders▶',
      '---',
      group('fileActions'),
      group('edit'),
      '---',
      'Remove Local Copy (1 file)',
      'Delete from Server (1 file)',
      'Delete Local & Server (1 file)',
      '---',
      UNDO,
      '---',
    ]
    const collab = [
      'Where Used',
      'Properties',
      'Notify Someone',
      'Watch File',
      'Copy Share Link',
      'Add to ECO',
    ]
    expect(await capture(DRAWING)).toEqual({
      collapsed: [...head, more(6)], // D3: was (7)
      expanded: [...head, less, ...collab],
    })
  })

  it('a cloud-only file', async () => {
    await fresh('Parts')
    expect(await capture(CLOUD)).toEqual({
      collapsed: [
        // D2: the old menu started with a separator here
        'Download 1 files',
        'Check Out (download first) [disabled]',
        group('generate'),
        'Reviews▶',
        'Orders▶',
        '---',
        group('fileActions'),
        group('edit'),
        '---',
        'Delete from Server (1 file)',
        '---',
        UNDO,
        '---',
        'Where Used',
        'Properties',
        'Notify Someone',
        'Watch File',
        'Copy Share Link',
        'Add to ECO',
      ],
      expanded: null, // inline, as before
    })
  })

  it('two parts selected', async () => {
    await fresh('Parts', [h.absolute(PLAIN), h.absolute(OTHER)])
    expect(await capture(OTHER)).toEqual({
      collapsed: [
        'Open All (2 files)',
          'Check Out (2 files)',
        'Check In (2 files)(already in) [disabled]',
        'Change State▶',
        group('generate'),
        'Reviews▶',
        'Orders▶',
        '---',
        group('fileActions'),
        group('edit'),
        '---',
        'Remove Local Copy (2 files)',
        'Delete from Server (2 files)',
        'Delete Local & Server (2 files)',
        '---',
        UNDO,
        '---',
        'Where Used',
        'Properties',
      ],
      expanded: null, // inline, as before
    })
  })

  it('a part and a drawing selected', async () => {
    await fresh('Parts', [h.absolute(PLAIN), h.absolute(DRAWING)])
    const head = [
      'Open All (2 files)',
      'Check Out (2 files)',
      'Check In (2 files)',
      'Discard Checkout',
      'Change State▶',
      'Sync Metadata',
      group('generate'),
      'Reviews▶',
      'Orders▶',
      '---',
      group('fileActions'),
      group('edit'),
      '---',
      'Remove Local Copy (2 files)',
      'Delete from Server (2 files)',
      'Delete Local & Server (2 files)',
      '---',
      UNDO,
      '---',
    ]
    expect(await capture(PLAIN)).toEqual({
      collapsed: [...head, more(2)], // D3: was (3); collapsed as before
      expanded: [...head, less, 'Where Used', 'Properties'],
    })
  })

  it('a folder', async () => {
    await fresh('')
    expect(await capture('Parts')).toEqual({
      // D4: the old menu collapsed these two rows behind "More Actions (3)"
      collapsed: [
        'Open Folder',
        'Download 1 files', // D5
        'Check Out 2 files',
        'Check In 1 files',
        'Discard Checkout',
        'Change State▶',
        '---',
        group('fileActions'),
        group('edit'),
        '---',
        // One more file than the recorded run (THEIRS): 4 synced files and the cloud-only one
        'Remove Local Copy (4 files)',
        'Delete from Server (4 files)',
        'Delete Local & Server (5 files, 1 folder)',
        '---',
        UNDO,
        '---',
        'Properties',
        'Copy Share Link',
      ],
      expanded: null,
    })
  })

  it('every opening starts with "More actions" closed', async () => {
    await fresh('Parts')
    await openMenu(PLAIN)
    await act(async () => {
      fireEvent.click(
        document.querySelector<HTMLElement>('.context-menu .context-menu-expand-toggle')!,
      )
    })
    expect(menuShape()).toContain(less)
    await openMenu(DRAWING)
    expect(menuShape()).toContain(more(6))
  })
})

describe('a layout of the person’s own', () => {
  it('draws its order, its groups and leaves hidden entries out', async () => {
    setLayout(
      onlyLayout([
        { kind: 'entry', id: 'generate.local.step' },
        { kind: 'separator' },
        {
          kind: 'group',
          id: 'g-mine',
          label: 'My stuff',
          display: 'inline',
          children: [
            { kind: 'entry', id: 'collab.properties' },
            { kind: 'entry', id: 'checkout.checkOut' },
          ],
        },
        {
          kind: 'group',
          id: 'g-tools',
          label: 'Tools',
          display: 'submenu',
          children: [{ kind: 'entry', id: 'fileActions.copyName' }],
        },
        { kind: 'entry', id: 'delete.undo' },
      ]),
    )
    // Open applies to the part, but the layout hides it (as it hides every entry it does not list)
    await fresh('Parts')
    await openMenu(PLAIN)
    expect(menuShape()).toEqual([
      'Export STEP▶',
      '---',
      '[heading] My stuff',
      'Properties',
      'Check Out',
      '---',
      'Tools▶',
      UNDO,
    ])
    expect(resolvedIds()).toEqual([
      'generate.local.step',
      'collab.properties',
      'checkout.checkOut',
      'fileActions.copyName',
      'delete.undo',
    ])
  })

  it('opens the export flyout from its new place', async () => {
    setLayout(onlyLayout([{ kind: 'entry', id: 'generate.local.step' }]))
    await fresh('Parts')
    await openMenu(PLAIN)
    const step = Array.from(
      document.querySelectorAll<HTMLElement>('.context-menu .context-menu-item'),
    ).find((el) => (el.textContent ?? '').startsWith('Export STEP'))!
    await act(async () => {
      fireEvent.mouseEnter(step)
    })
    const flyout = step.querySelector('[data-context-submenu]')
    expect(flyout?.textContent).toContain('Export Here')
  })
})

describe('every entry that applies draws a row', () => {
  const fixtures: Array<{
    name: string
    folder: string
    target: string
    selected?: string[]
    admin?: boolean
  }> = [
    { name: 'part', folder: 'Parts', target: PLAIN },
    { name: 'drawing checked out', folder: 'Parts', target: DRAWING },
    { name: 'cloud-only', folder: 'Parts', target: CLOUD },
    { name: 'theirs, admin', folder: 'Parts', target: THEIRS, admin: true },
    { name: 'multi', folder: 'Parts', target: OTHER, selected: [PLAIN, OTHER] },
    { name: 'folder, admin', folder: '', target: 'Parts', admin: true },
  ]

  /**
   * Every list entry, each alone in an inline group named after its id, in a few layouts: the
   * menu is opened once per layout instead of once per entry. A group whose entry does not apply
   * is dropped with it (`resolveLayout`), so the headings are the entries that apply, and the rows
   * between a heading and the next are exactly what that entry draws (separators aside). A layout
   * keeps at most `MAX_USER_GROUPS` groups (`sanitize` dissolves the rest), hence the chunks.
   */
  const probeLayouts: MenuLayout[] = []
  for (let i = 0; i < LIST_MENU_ENTRY_IDS.length; i += MAX_USER_GROUPS) {
    probeLayouts.push(
      onlyLayout(
        LIST_MENU_ENTRY_IDS.slice(i, i + MAX_USER_GROUPS).map((id): LayoutNode => ({
          kind: 'group',
          id: `probe-${id}`,
          label: `probe:${id}`,
          display: 'inline',
          children: [{ kind: 'entry', id }],
        })),
      ),
    )
  }

  /** The rows each probe heading is followed by, by entry id. */
  function rowsByEntry(): Map<string, string[]> {
    const byEntry = new Map<string, string[]>()
    let current: string[] | null = null
    for (const line of menuShape()) {
      const probe = /^\[heading\] probe:(.+)$/.exec(line)
      if (probe) {
        current = []
        byEntry.set(probe[1], current)
      } else if (current && line !== '---') {
        current.push(line)
      }
    }
    return byEntry
  }

  it.each(fixtures)('$name', async ({ folder, target, selected, admin }) => {
    if (admin)
      usePDMStore.setState((s) => ({ user: s.user ? { ...s.user, role: 'admin' } : s.user }))
    await fresh(
      folder,
      (selected ?? []).map((p) => h.absolute(p)),
    )
    const applied: string[] = []
    const headings: string[] = []
    const silent: string[] = []
    for (const layout of probeLayouts) {
      setLayout(layout)
      await openMenu(target)
      const ids = resolvedIds()
      const rows = rowsByEntry()
      await closeMenu()
      applied.push(...ids)
      headings.push(...rows.keys())
      silent.push(...ids.filter((id) => (rows.get(id) ?? []).length === 0))
    }
    // One heading per entry that applies, in the layout's order, and each draws a row.
    expect(headings).toEqual(applied)
    expect(silent).toEqual([])
    expect(applied.length).toBeGreaterThan(3)
  })
})

describe('the file list produces every list entry of the registry', () => {
  it('LIST_MENU_ENTRY_IDS is the registry ids whose surfaces include the list', () => {
    const registry = CONTEXT_MENU_ENTRIES.filter((e) =>
      (e.surfaces as readonly string[]).includes('list'),
    ).map((e) => e.id)
    expect([...LIST_MENU_ENTRY_IDS].sort()).toEqual([...registry].sort())
  })
})
