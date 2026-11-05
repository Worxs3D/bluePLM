// @vitest-environment jsdom
/**
 * The explorer tree's right-click menu drawn from layouts, over the real store and harness.
 *
 * With the app default layout the tree follows the shared order (one menu, one order): Open,
 * the sync and check-out block, Generate, Reviews, then the File actions and Edit flyouts, the
 * delete block and "More actions" (collaboration and the tree's own Refresh Vault / Show Deleted
 * Files). The rows keep the tree's own labels and conditions.
 */
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/client', async (importOriginal) =>
  (await import('@/test/supabaseClientMock')).mockClientModule(await importOriginal()),
)

const { FileContextMenu } = await import('./FileContextMenu')
const { t } = await import('@/lib/i18n')
const { usePDMStore } = await import('@/stores/pdmStore')
const { createHarness, OTHER_USER_ID } = await import('@/test/harness')
const { installDomShims, lenientElectron, signedInVault } = await import('@/test/render')
const { CONTEXT_MENU_ENTRIES, CONTEXT_MENU_GROUPS } = await import('@/lib/contextMenu/entries')
const { orgKey } = await import('@/lib/contextMenu/effective')
const { TREE_MENU_ENTRY_IDS } = await import('./treeEntries')
const { clampMenuPosition } = await import('./hooks/useMenuPosition')

import type { ContextMenuEntryId, ContextMenuGroupId } from '@/lib/contextMenu/entries'
import type { LayoutNode, MenuLayout } from '@/lib/contextMenu/types'

type Harness = Awaited<ReturnType<typeof createHarness>>
let h: Harness

const PLAIN = 'Parts/plain.sldprt'
const OTHER = 'Parts/other.sldprt'
// Fixtures for "every entry draws a row", kept out of Parts so the folder rows stay small
const DRAWING = 'More/mine.slddrw'
const CLOUD = 'More/cloud.sldprt'
const THEIRS = 'More/theirs.sldprt'
const ASSEMBLY = 'More/top.sldasm'
const LOCAL = 'More/local.txt'

function entry(relativePath: string) {
  const match = usePDMStore
    .getState()
    .files.find((f) => f.relativePath.toLowerCase() === relativePath.toLowerCase())
  if (!match) throw new Error(`no store row for ${relativePath}`)
  return match
}

const noop = () => {}

function openMenu(paths: string[]) {
  cleanup()
  render(
    <FileContextMenu
      x={10}
      y={10}
      files={usePDMStore.getState().files}
      contextFiles={paths.map(entry)}
      onClose={noop}
      onRefresh={noop}
      clipboard={null}
      onCopy={noop}
      onCut={noop}
      onPaste={noop}
      onRename={noop}
      onNewFolder={noop}
    />,
  )
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

/** Rows collapsed, and after "More actions" is expanded (null when nothing is collapsed). */
async function capture(paths: string[]): Promise<{ collapsed: string[]; expanded: string[] | null }> {
  openMenu(paths)
  const collapsed = menuShape()
  const toggle = document.querySelector<HTMLElement>('.context-menu .context-menu-expand-toggle')
  let expanded: string[] | null = null
  if (toggle) {
    await act(async () => {
      fireEvent.click(toggle)
    })
    expanded = menuShape()
  }
  return { collapsed, expanded }
}

function setLayout(layout: MenuLayout | null) {
  const key = orgKey(usePDMStore.getState().organization?.id)
  act(() => {
    usePDMStore.getState().setContextMenuPrefs(
      key,
      layout
        ? { templateId: null, pinned: [], hidden: [], custom: layout, updatedAt: new Date().toISOString() }
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
    hidden: CONTEXT_MENU_ENTRIES.map((e) => e.id as ContextMenuEntryId).filter((id) => !listed.has(id)),
    removedGroups: ALL_GROUPS,
  }
}

const group = (id: ContextMenuGroupId) => `${t(`contextMenuCustomizer.group.${id}`)}▶`
const more = (count: number) => `[toggle] ${t('contextMenuCustomizer.menu.moreActions', { count })}`
const less = `[toggle] ${t('contextMenuCustomizer.menu.lessActions')}`

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
  h.seedSolidWorksFile(ASSEMBLY, { part_number: 'PN-6' })
  await h.checkOut(DRAWING)
  h.electron.disk.remove(h.absolute(CLOUD))
  h.electron.disk.write(h.absolute(LOCAL), 'never checked in')
  await h.reload()
})

afterEach(() => {
  cleanup()
  setLayout(null)
})

describe('the default layout orders the tree menu like the file list', () => {
  it('a synced part, checked in', async () => {
    const head = [
      'Open',
      'Check Out (1 file)',
      'Check In (1 file)(already in) [disabled]',
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
    ]
    const collab = [
      'Properties',
      'Notify Someone',
      'Watch File',
      'Copy Share Link',
      'Add to ECO',
      'Refresh Vault',
    ]
    expect(await capture([PLAIN])).toEqual({
      collapsed: [...head, more(collab.length)],
      expanded: [...head, less, ...collab],
    })
    const ids = resolvedIds().filter((id) => !id.startsWith('generate.'))
    expect(ids).toEqual([
      'open.open',
      'checkout.checkOut',
      'checkout.checkIn',
      'reviews',
      'orders',
      'fileActions.showInExplorer',
      'fileActions.pin',
      'fileActions.rename',
      'edit.copy',
      'edit.cut',
      'edit.paste',
      'delete.removeLocal',
      'delete.serverKeepLocal',
      'delete.everywhere',
      'collab.properties',
      'collab.notify',
      'collab.watch',
      'collab.shareLink',
      'collab.addToEco',
      'nav.refreshVault',
    ])
  })

  it('a folder', async () => {
    expect(await capture(['Parts'])).toEqual({
      collapsed: [
        'Open Folder',
        'Check Out 2 files',
        'Check In (1 folder)(already in) [disabled]',
        '---',
        group('fileActions'),
        group('edit'),
        '---',
        'Remove Local Copy (2 files)',
        'Delete from Server (2 files)',
        'Delete Local & Server (2 files, 1 folder)',
        '---',
        'Properties',
        'Copy Share Link',
        'Show Deleted Files',
        'Refresh Vault',
      ],
      expanded: null, // short enough to show inline
    })
    expect(resolvedIds()).toContain('fileActions.newFolder')
  })

  it('two parts selected', async () => {
    expect(await capture([PLAIN, OTHER])).toEqual({
      collapsed: [
        'Check Out (2 files)',
        'Check In (2 files)(already in) [disabled]',
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
        'Properties',
        'Refresh Vault',
      ],
      expanded: null,
    })
  })

  it('opens a File actions flyout with the tree’s own rows', async () => {
    openMenu([PLAIN])
    const row = Array.from(
      document.querySelectorAll<HTMLElement>('.context-menu .context-menu-item'),
    ).find((el) => (el.textContent ?? '').startsWith(t('contextMenuCustomizer.group.fileActions')))!
    await act(async () => {
      fireEvent.mouseEnter(row)
    })
    const flyout = row.querySelector('[data-context-submenu]')
    expect(flyout?.textContent).toContain('Show in Explorer')
    expect(flyout?.textContent).toContain('Pin File')
    expect(flyout?.textContent).toContain('Rename')
  })
})

describe('a layout of the person’s own', () => {
  it('reorders the tree menu and leaves hidden entries out', async () => {
    setLayout(
      onlyLayout([
        { kind: 'entry', id: 'collab.properties' },
        { kind: 'separator' },
        {
          kind: 'group',
          id: 'g-mine',
          label: 'Mine',
          display: 'inline',
          children: [
            { kind: 'entry', id: 'checkout.checkIn' },
            { kind: 'entry', id: 'open.open' },
          ],
        },
        { kind: 'entry', id: 'nav.refreshVault' },
      ]),
    )
    openMenu([PLAIN])
    expect(menuShape()).toEqual([
      'Properties',
      '---',
      '[heading] Mine',
      'Check In (1 file)(already in) [disabled]',
      'Open',
      '---',
      'Refresh Vault',
    ])
    expect(resolvedIds()).toEqual([
      'collab.properties',
      'checkout.checkIn',
      'open.open',
      'nav.refreshVault',
    ])
  })
})

describe('every tree entry that applies draws a row', () => {
  const fixtures: Array<{ name: string; paths: string[]; admin?: boolean }> = [
    { name: 'part', paths: [PLAIN] },
    { name: 'drawing checked out', paths: [DRAWING] },
    { name: 'cloud-only', paths: [CLOUD] },
    { name: 'theirs, admin', paths: [THEIRS], admin: true },
    { name: 'assembly', paths: [ASSEMBLY] },
    { name: 'local only', paths: [LOCAL] },
    { name: 'multi', paths: [PLAIN, OTHER] },
    { name: 'folder, admin', paths: ['Parts'], admin: true },
  ]

  it.each(fixtures)('$name', async ({ paths, admin }) => {
    if (admin) usePDMStore.setState((s) => ({ user: s.user ? { ...s.user, role: 'admin' } : s.user }))
    const silent: string[] = []
    let applied = 0
    for (const id of TREE_MENU_ENTRY_IDS) {
      setLayout(onlyLayout([{ kind: 'entry', id }]))
      openMenu(paths)
      if (resolvedIds().length > 0) {
        applied++
        if (menuShape().filter((r) => r !== '---').length === 0) silent.push(id)
      }
    }
    expect(silent).toEqual([])
    expect(applied).toBeGreaterThan(3)
  })
})

describe('the tree produces every tree entry of the registry', () => {
  it('TREE_MENU_ENTRY_IDS is the registry ids whose surfaces include the tree', () => {
    const registry = CONTEXT_MENU_ENTRIES.filter((e) =>
      (e.surfaces as readonly string[]).includes('tree'),
    ).map((e) => e.id)
    expect([...TREE_MENU_ENTRY_IDS].sort()).toEqual([...registry].sort())
  })
})

describe('clampMenuPosition', () => {
  const viewport = { width: 800, height: 600 }
  it('keeps the click point when the menu fits', () => {
    expect(clampMenuPosition(100, 100, { width: 200, height: 300 }, viewport)).toEqual({ x: 100, y: 100 })
  })
  it('moves a menu that grew past the bottom up into the window', () => {
    expect(clampMenuPosition(100, 400, { width: 200, height: 300 }, viewport)).toEqual({ x: 100, y: 290 })
  })
  it('never goes above or left of the padding', () => {
    expect(clampMenuPosition(700, 10, { width: 900, height: 900 }, viewport)).toEqual({ x: 10, y: 10 })
  })
})
