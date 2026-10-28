// @vitest-environment jsdom
/**
 * The vault header's batch buttons run the handlers of the latest render.
 *
 * FileTree builds these handlers in its render, closing over that render's file list. The header's
 * memo comparator used to skip handlers, so a header whose counts had not changed kept old ones:
 * "Download all cloud files" acted on an old list, and the header held that whole vault generation
 * alive (found by the render-perf nightly's retainer probe).
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/client', async (importOriginal) =>
  (await import('@/test/supabaseClientMock')).mockClientModule(await importOriginal()),
)

const { VaultTreeItem, areVaultTreeItemPropsEqual } = await import('./VaultTreeItem')

type Props = ComponentProps<typeof VaultTreeItem>

function props(overrides: Partial<Props> = {}): Props {
  return {
    vault: { id: 'v1', name: 'Vault', localPath: 'C:/Vault', isExpanded: true },
    isActive: true,
    isExpanded: true,
    onClick: () => {},
    onContextMenu: () => {},
    onDragOver: () => {},
    onDragLeave: () => {},
    onDrop: () => {},
    isDragTarget: false,
    cloudFilesCount: 3,
    outdatedFilesCount: 0,
    localOnlyFilesCount: 0,
    syncedFilesCount: 0,
    checkedOutByMeCount: 0,
    allCheckoutUsers: [],
    checkoutUsersSignature: '',
    totalCheckouts: 0,
    isDownloadingAll: false,
    isCheckingInAll: false,
    isCheckingInMyCheckouts: false,
    isAnyCloudFileProcessing: false,
    isAnyOutdatedFileProcessing: false,
    onDownloadAllCloud: () => {},
    onUpdateAllOutdated: () => {},
    onFirstCheckinAllLocal: () => {},
    onCheckInMyCheckouts: () => {},
    onCheckoutAllSynced: () => {},
    ...overrides,
  }
}

afterEach(cleanup)

describe('VaultTreeItem', () => {
  it('re-renders for a new handler even when nothing it displays changed', () => {
    const base = props()
    expect(areVaultTreeItemPropsEqual(base, { ...base })).toBe(true)
    expect(areVaultTreeItemPropsEqual(base, { ...base, onDownloadAllCloud: () => {} })).toBe(false)
    expect(areVaultTreeItemPropsEqual(base, { ...base, onDrop: () => {} })).toBe(false)
  })

  it('runs the download handler of the latest render', () => {
    const first = vi.fn()
    const latest = vi.fn()
    const { rerender } = render(<VaultTreeItem {...props({ onDownloadAllCloud: first })} />)
    rerender(<VaultTreeItem {...props({ onDownloadAllCloud: latest })} />)

    fireEvent.click(screen.getByTitle('Download 3 cloud files'))

    expect(latest).toHaveBeenCalledTimes(1)
    expect(first).not.toHaveBeenCalled()
  })
})
