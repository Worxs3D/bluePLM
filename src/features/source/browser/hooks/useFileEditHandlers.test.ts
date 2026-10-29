// @vitest-environment jsdom
/**
 * `useFileEditHandlers` reads the file list through a ref, so no callback it returns closes over a
 * render's `files`. Every closure made in one render shares that render's context: when
 * `startCreatingFolder` named `files`, `handleCreateFolder` (deps: the new-folder name and path,
 * which rarely change) kept the first render's whole file list alive for the session. The
 * render-perf retainer probe found FileListBody's `handleCreateFolder` prop holding superseded rows.
 */
import { renderHook } from '@testing-library/react'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { LocalFile } from '@/stores/pdmStore'

vi.mock('@/lib/supabase/client', async (importOriginal) =>
  (await import('@/test/supabaseClientMock')).mockClientModule(await importOriginal()),
)

const { useFileEditHandlers } = await import('./useFileEditHandlers')
type Deps = Parameters<typeof useFileEditHandlers>[0]

function folder(relativePath: string): LocalFile {
  const name = relativePath.split('/').pop() ?? relativePath
  return {
    name,
    path: `C:/vault/${relativePath}`,
    relativePath,
    isDirectory: true,
    extension: '',
    size: 0,
    modifiedTime: '2026-10-29T00:00:00.000Z',
  }
}

function makeDeps(files: LocalFile[], setNewFolderName: (name: string) => void): Deps {
  return {
    files,
    vaultPath: 'C:/vault',
    currentPath: '',
    user: { id: 'user-1' },
    renamingFile: null,
    setRenamingFile: vi.fn(),
    renameValue: '',
    setRenameValue: vi.fn(),
    renameInputRef: createRef<HTMLInputElement>(),
    isCreatingFolder: false,
    setIsCreatingFolder: vi.fn(),
    newFolderName: '',
    setNewFolderName,
    newFolderInputRef: createRef<HTMLInputElement>(),
    editingCell: null,
    setEditingCell: vi.fn(),
    editValue: '',
    setEditValue: vi.fn(),
    inlineEditInputRef: createRef<HTMLInputElement>(),
    setContextMenu: vi.fn(),
    setEmptyContextMenu: vi.fn(),
    addToast: vi.fn(),
    updatePendingMetadata: vi.fn(),
    onRefresh: vi.fn(),
    saveConfigsToSWFile: vi.fn(),
  }
}

describe('useFileEditHandlers file list', () => {
  it('keeps its callbacks across a new file list and names the new folder from the latest list', () => {
    const setNewFolderName = vi.fn()
    const first = [folder('New Folder')]
    const deps = makeDeps(first, setNewFolderName)
    const { result, rerender } = renderHook((props: Deps) => useFileEditHandlers(props), {
      initialProps: deps,
    })
    const initial = result.current

    // A new vault generation: same setters, a different files array.
    rerender({ ...deps, files: [...first, folder('New Folder (2)')] })

    expect(result.current.handleCreateFolder).toBe(initial.handleCreateFolder)
    expect(result.current.startCreatingFolder).toBe(initial.startCreatingFolder)

    initial.startCreatingFolder()
    expect(setNewFolderName).toHaveBeenLastCalledWith('New Folder (3)')
  })
})
