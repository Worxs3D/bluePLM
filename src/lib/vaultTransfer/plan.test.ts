import { describe, expect, it } from 'vitest'

import type { LocalFile } from '@/stores/types'
import type { PDMFile } from '@/types/pdm'

import {
  candidateDestinationPaths,
  normalizeDestFolder,
  planVaultTransfer,
  WINDOWS_MAX_PATH,
} from './plan'
import type { TransferTargetSnapshot, VaultTransferOptions } from './types'

function pdm(id: string, overrides: Partial<PDMFile> = {}): PDMFile {
  return {
    id,
    org_id: 'org',
    vault_id: 'vault-a',
    file_path: '',
    file_name: '',
    extension: '.sldprt',
    file_type: 'part',
    part_number: null,
    description: null,
    revision: 'A',
    version: 3,
    workflow_state_id: null,
    state_changed_at: null,
    state_changed_by: null,
    checked_out_by: null,
    checked_out_at: null,
    lock_message: null,
    checked_out_by_machine_id: null,
    checked_out_by_machine_name: null,
    checked_out_file_path: null,
    checked_out_file_name: null,
    content_hash: `hash-${id}`,
    file_size: 100,
    created_at: null,
    created_by: 'user',
    updated_at: null,
    updated_by: null,
    custom_properties: null,
    deleted_at: null,
    deleted_by: null,
    ...overrides,
  }
}

function file(
  relativePath: string,
  overrides: Partial<LocalFile> = {},
  server: Partial<PDMFile> | null = {},
): LocalFile {
  const name = relativePath.split('/').pop() ?? relativePath
  return {
    name,
    path: `C:\\vault-a\\${relativePath.replace(/\//g, '\\')}`,
    relativePath,
    isDirectory: false,
    extension: '.sldprt',
    size: 100,
    modifiedTime: '2026-01-01T00:00:00.000Z',
    ...(server === null ? {} : { pdmData: pdm(`id-${relativePath}`, server) }),
    ...overrides,
  }
}

function folder(relativePath: string, overrides: Partial<LocalFile> = {}): LocalFile {
  return {
    name: relativePath.split('/').pop() ?? relativePath,
    path: `C:\\vault-a\\${relativePath.replace(/\//g, '\\')}`,
    relativePath,
    isDirectory: true,
    extension: '',
    size: 0,
    modifiedTime: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

const EMPTY_TARGET: TransferTargetSnapshot = {
  serverPaths: new Set(),
  diskPaths: new Set(),
  vaultPath: 'C:\\vault-b',
}

function options(overrides: Partial<VaultTransferOptions> = {}): VaultTransferOptions {
  return { mode: 'copy', destFolder: '', keepPath: false, ...overrides }
}

function plan(
  selection: LocalFile[],
  vaultFiles: LocalFile[],
  opts: Partial<VaultTransferOptions> = {},
  target: Partial<TransferTargetSnapshot> = {},
) {
  return planVaultTransfer({
    selection,
    vaultFiles,
    options: options(opts),
    target: { ...EMPTY_TARGET, ...target },
  })
}

function destinations(result: ReturnType<typeof plan>): string[] {
  return result.files.map((entry) => entry.destRelativePath).sort()
}

function reasons(result: ReturnType<typeof plan>): Record<string, string> {
  return Object.fromEntries(result.skipped.map((entry) => [entry.relativePath, entry.reason]))
}

describe('normalizeDestFolder', () => {
  it('accepts the vault root and plain folders', () => {
    expect(normalizeDestFolder('')).toBe('')
    expect(normalizeDestFolder('/')).toBe('')
    expect(normalizeDestFolder('Parts')).toBe('Parts')
    expect(normalizeDestFolder('Parts\\Brackets\\')).toBe('Parts/Brackets')
  })

  it('refuses anything that could leave the vault or that Windows cannot name', () => {
    expect(normalizeDestFolder('..')).toBeNull()
    expect(normalizeDestFolder('Parts/../Other')).toBeNull()
    expect(normalizeDestFolder('./Parts')).toBeNull()
    expect(normalizeDestFolder('C:\\Windows')).toBeNull()
    expect(normalizeDestFolder('Parts//Brackets')).toBeNull()
    expect(normalizeDestFolder('What?')).toBeNull()
    expect(normalizeDestFolder('trailing.')).toBeNull()
    expect(normalizeDestFolder('trailing ')).toBeNull()
  })
})

describe('where things land', () => {
  const bracket = file('Mechanical/Brackets/Bracket.SLDPRT')

  it('puts a lone file directly in the destination folder by default', () => {
    expect(destinations(plan([bracket], [bracket]))).toEqual(['Bracket.SLDPRT'])
    expect(destinations(plan([bracket], [bracket], { destFolder: 'Incoming' }))).toEqual([
      'Incoming/Bracket.SLDPRT',
    ])
  })

  it('reproduces the source folders when asked to keep the path', () => {
    expect(destinations(plan([bracket], [bracket], { keepPath: true }))).toEqual([
      'Mechanical/Brackets/Bracket.SLDPRT',
    ])
    expect(
      destinations(plan([bracket], [bracket], { keepPath: true, destFolder: 'Incoming' })),
    ).toEqual(['Incoming/Mechanical/Brackets/Bracket.SLDPRT'])
  })

  it('keeps a selected folder together with everything inside it', () => {
    const dir = folder('Mechanical/Brackets')
    const inner = file('Mechanical/Brackets/Bracket.SLDPRT')
    const deeper = file('Mechanical/Brackets/Old/Bracket-old.SLDPRT')
    const sibling = file('Mechanical/Other.SLDPRT')
    const all = [folder('Mechanical'), dir, inner, folder('Mechanical/Brackets/Old'), deeper, sibling]

    expect(destinations(plan([dir], all))).toEqual([
      'Brackets/Bracket.SLDPRT',
      'Brackets/Old/Bracket-old.SLDPRT',
    ])
    expect(destinations(plan([dir], all, { keepPath: true }))).toEqual([
      'Mechanical/Brackets/Bracket.SLDPRT',
      'Mechanical/Brackets/Old/Bracket-old.SLDPRT',
    ])
  })

  it('does not mistake a folder with the same prefix for a parent', () => {
    const dir = folder('Fixed Lens')
    const inside = file('Fixed Lens/a.SLDPRT')
    const lookalike = file('Fixed Lens Models/b.SLDPRT')

    expect(destinations(plan([dir], [dir, inside, lookalike]))).toEqual(['Fixed Lens/a.SLDPRT'])
  })

  it('lists the folders to create, shallowest first, including empty ones', () => {
    const dir = folder('Parts')
    const empty = folder('Parts/Empty')
    const nested = folder('Parts/A/B')
    const result = plan([dir], [dir, empty, nested, folder('Parts/A')], { destFolder: 'In' })

    expect(result.folders).toEqual(['In/Parts', 'In/Parts/A', 'In/Parts/Empty', 'In/Parts/A/B'])
    expect(result.files).toHaveLength(0)
  })

  it('walks a file once however many ways the selection reaches it', () => {
    const dir = folder('Parts')
    const inner = file('Parts/a.SLDPRT')

    const result = plan([inner, dir], [dir, inner])

    expect(result.files).toHaveLength(1)
    // Reached through the folder, so it keeps its folder rather than landing loose.
    expect(result.files[0].destRelativePath).toBe('Parts/a.SLDPRT')
    expect(result.skipped).toHaveLength(0)
  })
})

describe('stubs of moved files', () => {
  it('never transfers a moved_away stub', () => {
    const dir = folder('Parts')
    const stub = file('Parts/old-name.SLDPRT', { diffStatus: 'moved_away' })
    const real = file('Parts/new-name.SLDPRT', { diffStatus: 'moved' })

    const result = plan([dir], [dir, stub, real])

    expect(result.files.map((entry) => entry.sourceRelativePath)).toEqual([
      'Parts/new-name.SLDPRT',
    ])
    expect(result.skipped).toHaveLength(0)
  })

  it('transfers nothing when only a stub is selected', () => {
    const stub = file('Parts/old-name.SLDPRT', { diffStatus: 'moved_away' })
    expect(plan([stub], [stub]).files).toHaveLength(0)
  })
})

describe('how content travels', () => {
  it('uses the stored object for an unchanged, checked-in file', () => {
    const synced = file('a.SLDPRT')
    expect(plan([synced], [synced]).files[0].strategy).toBe('synced-local')
  })

  it('uploads a file the server has never seen', () => {
    const added = file('a.SLDPRT', { diffStatus: 'added' }, null)
    const untracked = file('b.SLDPRT', {}, null)

    const result = plan([added, untracked], [added, untracked])

    expect(result.files.map((entry) => entry.strategy)).toEqual(['upload-local', 'upload-local'])
    expect(result.files.every((entry) => entry.sourceFileId === null)).toBe(true)
    expect(result.uploadBytes).toBe(200)
  })

  it('uploads what is on disk when it differs from the server', () => {
    const modified = file('a.SLDPRT', { diffStatus: 'modified' })
    expect(plan([modified], [modified]).files[0].strategy).toBe('upload-local')
  })

  it('does not download a cloud-only file to move it', () => {
    const cloud = file('a.SLDPRT', { diffStatus: 'cloud', size: 0 })

    const result = plan([cloud], [cloud])

    expect(result.files[0].strategy).toBe('cloud')
    expect(result.uploadBytes).toBe(0)
    // The size the user is told about is the server's, not the empty placeholder's.
    expect(result.totalBytes).toBe(100)
  })

  it('has nothing to copy for a server row with no stored content', () => {
    const empty = file('a.SLDPRT', { diffStatus: 'cloud' }, { content_hash: null })
    expect(reasons(plan([empty], [empty]))).toEqual({ 'a.SLDPRT': 'no-content' })
  })

  it('has nothing to copy for a ghost row that carries only an id', () => {
    const ghost = file('a.SLDPRT', { diffStatus: 'deleted', pdmData: { id: 'x' } as PDMFile })
    expect(reasons(plan([ghost], [ghost]))).toEqual({ 'a.SLDPRT': 'no-content' })
  })

  it('reads the server size, not the stat, for a synced file', () => {
    const synced = file('a.SLDPRT', { size: 1 }, { file_size: 500 })
    expect(plan([synced], [synced]).totalBytes).toBe(500)
  })
})

describe('what is left out of any transfer', () => {
  it.each([
    ['outdated', { diffStatus: 'outdated' as const }],
    ['ignored', { diffStatus: 'ignored' as const }],
    ['deleted-on-server', { diffStatus: 'deleted_remote' as const }],
  ])('skips a %s file in copy and in move', (reason, overrides) => {
    const item = file('a.SLDPRT', overrides)

    expect(reasons(plan([item], [item]))).toEqual({ 'a.SLDPRT': reason })
    expect(reasons(plan([item], [item], { mode: 'move' }))).toEqual({ 'a.SLDPRT': reason })
  })

  it('counts the skipped file once, against the path it would have gone to', () => {
    const item = file('Parts/a.SLDPRT', { diffStatus: 'outdated' })

    const result = plan([item], [item], { destFolder: 'In' })

    expect(result.skipped).toEqual([
      { relativePath: 'Parts/a.SLDPRT', destRelativePath: 'In/a.SLDPRT', reason: 'outdated' },
    ])
  })
})

describe('what only a move refuses', () => {
  const checkedOut = file('a.SLDPRT', {}, { checked_out_by: 'someone' })
  const modified = file('b.SLDPRT', { diffStatus: 'modified' })
  const moved = file('c.SLDPRT', { diffStatus: 'moved' })

  it('copies them, because a copy takes nothing away', () => {
    const result = plan([checkedOut, modified, moved], [checkedOut, modified, moved])

    expect(result.files).toHaveLength(3)
    expect(result.skipped).toHaveLength(0)
  })

  it('leaves them where they are', () => {
    const result = plan([checkedOut, modified, moved], [checkedOut, modified, moved], {
      mode: 'move',
    })

    expect(result.files).toHaveLength(0)
    expect(reasons(result)).toEqual({
      'a.SLDPRT': 'checked-out',
      'b.SLDPRT': 'modified',
      'c.SLDPRT': 'pending-move',
    })
  })

  it('moves a local-only file, which has no server row to strand', () => {
    const added = file('d.SLDPRT', { diffStatus: 'added' }, null)

    const result = plan([added], [added], { mode: 'move' })

    expect(result.files).toHaveLength(1)
    expect(result.files[0].sourceFileId).toBeNull()
  })
})

describe('what the destination already holds', () => {
  it('never replaces a file the destination vault has, whatever its case', () => {
    const item = file('Parts/Bracket.SLDPRT')

    const result = plan([item], [item], {}, { serverPaths: new Set(['bracket.sldprt']) })

    expect(result.files).toHaveLength(0)
    expect(reasons(result)).toEqual({ 'Parts/Bracket.SLDPRT': 'exists-in-destination' })
  })

  it('does not overwrite an untracked file on the destination disk', () => {
    const item = file('Bracket.SLDPRT')

    const result = plan([item], [item], {}, { diskPaths: new Set(['bracket.sldprt']) })

    expect(reasons(result)).toEqual({ 'Bracket.SLDPRT': 'exists-on-disk' })
  })

  it('checks the destination path, not the source path', () => {
    const item = file('Parts/Bracket.SLDPRT')

    // The same name exists in the destination, but at a path this transfer does not write to.
    const result = plan(
      [item],
      [item],
      { keepPath: true },
      { serverPaths: new Set(['bracket.sldprt']) },
    )

    expect(result.files).toHaveLength(1)
  })

  it('lets only one of two files that would land on the same path through', () => {
    const first = file('A/Bracket.SLDPRT')
    const second = file('B/bracket.sldprt')

    const result = plan([first, second], [first, second])

    expect(result.files.map((entry) => entry.sourceRelativePath)).toEqual(['A/Bracket.SLDPRT'])
    expect(reasons(result)).toEqual({ 'B/bracket.sldprt': 'duplicate-in-selection' })
  })

  it('does not let a file that was refused for another reason hold the path', () => {
    const outdated = file('A/Bracket.SLDPRT', { diffStatus: 'outdated' })
    const good = file('B/Bracket.SLDPRT')

    const result = plan([outdated, good], [outdated, good])

    expect(result.files.map((entry) => entry.sourceRelativePath)).toEqual(['B/Bracket.SLDPRT'])
  })

  it('keeps both when the path is kept, because the folders tell them apart', () => {
    const first = file('A/Bracket.SLDPRT')
    const second = file('B/Bracket.SLDPRT')

    expect(plan([first, second], [first, second], { keepPath: true }).files).toHaveLength(2)
  })
})

describe('paths Windows cannot hold', () => {
  const vaultPath = 'C:\\vault-b'

  function longName(destLength: number): string {
    const room = destLength - '.SLDPRT'.length
    return `${'n'.repeat(room)}.SLDPRT`
  }

  it('refuses a local copy that would pass the limit and allows one that just fits', () => {
    const fits = file(longName(WINDOWS_MAX_PATH - vaultPath.length - 1))
    const tooLong = file(longName(WINDOWS_MAX_PATH - vaultPath.length))

    expect(plan([fits], [fits], {}, { vaultPath }).files).toHaveLength(1)
    expect(reasons(plan([tooLong], [tooLong], {}, { vaultPath }))).toEqual({
      [tooLong.relativePath]: 'path-too-long',
    })
  })

  it('does not apply to a cloud-only file, which never touches the destination disk', () => {
    const tooLong = file(longName(WINDOWS_MAX_PATH), { diffStatus: 'cloud' })

    expect(plan([tooLong], [tooLong], {}, { vaultPath }).files).toHaveLength(1)
  })
})

describe('totals', () => {
  it('counts files whose workflow state will not come along', () => {
    const released = file('a.SLDPRT', {}, { workflow_state_id: 'state-1' })
    const plain = file('b.SLDPRT')

    const result = plan([released, plain], [released, plain])

    expect(result.workflowStateCount).toBe(1)
    expect(result.files.find((entry) => entry.hasWorkflowState)?.sourceRelativePath).toBe(
      'a.SLDPRT',
    )
  })

  it('remembers the version it saw, so a move can tell the file changed underneath it', () => {
    const item = file('a.SLDPRT', {}, { version: 7 })

    expect(plan([item], [item]).files[0].sourceVersion).toBe(7)
  })
})

describe('candidateDestinationPaths', () => {
  it('names every path the plan would consider, including ones it later refuses', () => {
    const dir = folder('Parts')
    const ok = file('Parts/a.SLDPRT')
    const stale = file('Parts/b.SLDPRT', { diffStatus: 'outdated' })

    expect(candidateDestinationPaths([dir], [dir, ok, stale], options({ destFolder: 'In' })).sort()).toEqual([
      'In/Parts/a.SLDPRT',
      'In/Parts/b.SLDPRT',
    ])
  })
})
