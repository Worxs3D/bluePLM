// @vitest-environment jsdom
/**
 * The details panel, rendered over the real store, next to the file list's own metadata cell.
 *
 * The overlay bug class (098c64be): a pending edit shown in one place while another still shows
 * the committed value. Each consistency test renders the panel and the list's ItemNumberCell /
 * DescriptionCell for the same file at once and asserts both show the same value.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/client', async (importOriginal) =>
  (await import('@/test/supabaseClientMock')).mockClientModule(await importOriginal()),
)

const { DetailsPanel } = await import('./DetailsPanel')
const { ItemNumberCell } = await import('@/features/source/browser/components/FileList/cells/ItemNumberCell')
const { DescriptionCell } = await import('@/features/source/browser/components/FileList/cells/DescriptionCell')
const { FilePaneCellHost } = await import('@/test/FilePaneCellHost')
const { t } = await import('@/lib/i18n')
const { usePDMStore } = await import('@/stores/pdmStore')
const { OTHER_USER_ID, createHarness } = await import('@/test/harness')
const { bulkFiles, hydrateOtherCheckout, installDomShims, lenientElectron, signedInVault } =
  await import('@/test/render')

type Harness = Awaited<ReturnType<typeof createHarness>>

// Not a SolidWorks document, so the panel shows its own editable properties grid.
const SPEC = 'Docs/spec.step'
const PART = 'Parts/bracket.sldprt'

let h: Harness

function seedSpec(checkedOutBy: string | null = null) {
  h.seedSolidWorksFile(SPEC, {
    part_number: 'SP-100',
    description: 'Spec sheet',
    revision: 'B',
    checked_out_by: checkedOutBy,
  })
}

function select(relativePath: string) {
  act(() => {
    usePDMStore.getState().setSelectedFiles([h.file(relativePath).path])
  })
}

/** The value shown beside `label:` in the properties grid. */
function field(label: string): HTMLElement {
  const labelEl = screen
    .getByTestId('details')
    .querySelectorAll('span')
  const match = Array.from(labelEl).find((el) => el.textContent === `${label}:`)
  const value = match?.nextElementSibling as HTMLElement | null
  if (!value) throw new Error(`no field ${label}`)
  return value
}

function renderPanel() {
  return render(
    <div data-testid="details">
      <DetailsPanel />
    </div>,
  )
}

beforeEach(async () => {
  h = await createHarness()
  installDomShims()
  lenientElectron(h)
  signedInVault()
  usePDMStore.setState({ detailsPanelTab: 'properties' })
})

afterEach(() => {
  cleanup()
})

describe('DetailsPanel: selection', () => {
  it('nothing selected: asks for a selection', () => {
    renderPanel()
    expect(screen.getByText(t('source.details.selectFileToView'))).toBeTruthy()
  })

  it('several selected: says how many', async () => {
    seedSpec()
    h.seedSolidWorksFile(PART, { part_number: 'BR-1' })
    await h.reload()
    usePDMStore.getState().setSelectedFiles([h.file(SPEC).path, h.file(PART).path])
    renderPanel()
    expect(screen.getByText(`2 ${t('source.details.filesSelected')}`)).toBeTruthy()
  })

  it('a folder of a 1,000-file vault: counts its files', async () => {
    seedSpec()
    await h.reload()
    usePDMStore.getState().setFiles(bulkFiles(h.file(SPEC), 1000))
    usePDMStore.getState().setSelectedFiles([`${h.absolute('Bulk')}`])
    renderPanel()
    await waitFor(() => expect(field(t('common.files')).textContent).toBe('1000'))
    expect(field(t('common.type')).textContent).toBe(t('common.folder'))
  })

  it('a file in a 1,000-file vault: shows that file', async () => {
    seedSpec()
    await h.reload()
    const bulk = bulkFiles(h.file(SPEC), 1000)
    usePDMStore.getState().setFiles(bulk)
    usePDMStore.getState().setSelectedFiles([bulk[777].path])
    renderPanel()
    expect(field(t('fileBrowser.itemNumber')).textContent).toBe('BULK-0777')
    expect(field(t('common.description')).textContent).toBe('Bulk part 0777')
  })
})

describe('DetailsPanel: who may edit', () => {
  it('a file nobody holds: committed values, read-only, says to check out', async () => {
    seedSpec()
    await h.reload()
    select(SPEC)
    renderPanel()

    const itemNumber = field(t('fileBrowser.itemNumber'))
    expect(itemNumber.textContent).toBe('SP-100')
    expect(itemNumber.getAttribute('title')).toBe(t('source.details.checkOutToEdit'))
    expect(field(t('source.details.revision')).textContent).toBe('B')
    expect(field(t('source.details.checkedOut')).textContent).toBe(t('source.details.notCheckedOut'))
    expect(field(t('source.details.syncStatus')).textContent).toBe(t('source.details.synced'))

    fireEvent.click(itemNumber)
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('a file someone else holds: read-only, names the holder', async () => {
    seedSpec(OTHER_USER_ID)
    await h.reload()
    hydrateOtherCheckout(SPEC)
    select(SPEC)
    renderPanel()

    expect(field(t('source.details.checkedOut')).textContent).toBe('Olive Other')
    fireEvent.click(field(t('common.description')))
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(h.file(SPEC).pendingMetadata).toBeUndefined()
  })

  it('a local-only file: editable before its first check-in', async () => {
    h.electron.disk.write(h.absolute('Docs/draft.step'), 'new work')
    await h.reload()
    select('Docs/draft.step')
    renderPanel()

    expect(field(t('source.details.syncStatus')).textContent).toBe(t('source.details.localOnly'))
    const itemNumber = field(t('fileBrowser.itemNumber'))
    expect(itemNumber.getAttribute('title')).toBe(t('source.details.clickToEdit'))
    fireEvent.click(itemNumber)
    expect(screen.getByRole('textbox')).toBeTruthy()
  })
})

describe('DetailsPanel and the file list agree on pending metadata', () => {
  function renderBoth(relativePath: string) {
    return render(
      <>
        <div data-testid="details">
          <DetailsPanel />
        </div>
        <div data-testid="list-item">
          <FilePaneCellHost relativePath={relativePath} Cell={ItemNumberCell} />
        </div>
        <div data-testid="list-desc">
          <FilePaneCellHost relativePath={relativePath} Cell={DescriptionCell} />
        </div>
      </>,
    )
  }
  const listItem = () => within(screen.getByTestId('list-item')).getByTestId('cell').textContent
  const listDesc = () => within(screen.getByTestId('list-desc')).getByTestId('cell').textContent

  beforeEach(async () => {
    seedSpec()
    await h.checkOut(SPEC)
    select(SPEC)
  })

  it('a pending value set elsewhere shows in both, over the committed one', () => {
    renderBoth(SPEC)
    expect(field(t('fileBrowser.itemNumber')).textContent).toBe('SP-100')
    expect(listItem()).toContain('SP-100')

    act(() => {
      usePDMStore.getState().updatePendingMetadata(h.file(SPEC).path, {
        part_number: 'SP-200',
        description: 'Spec sheet, rev C',
      })
    })

    expect(field(t('fileBrowser.itemNumber')).textContent).toBe('SP-200')
    expect(field(t('common.description')).textContent).toBe('Spec sheet, rev C')
    expect(listItem()).toContain('SP-200')
    expect(listDesc()).toContain('Spec sheet, rev C')
    expect(listItem()).not.toContain('SP-100')
  })

  it('a pending clear shows as empty in both, not as the committed value', () => {
    renderBoth(SPEC)
    act(() => {
      usePDMStore.getState().updatePendingMetadata(h.file(SPEC).path, { description: null })
    })
    expect(field(t('common.description')).textContent).toBe('-')
    expect(listDesc()).not.toContain('Spec sheet')
  })

  it('an edit made in the panel reaches the list', async () => {
    renderBoth(SPEC)
    fireEvent.click(field(t('fileBrowser.itemNumber')))
    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.value).toBe('SP-100')
    fireEvent.change(input, { target: { value: 'SP-300' } })
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' })
    })

    expect(h.file(SPEC).pendingMetadata).toMatchObject({ part_number: 'SP-300' })
    expect(h.file(SPEC).pdmData?.part_number).toBe('SP-100')
    expect(field(t('fileBrowser.itemNumber')).textContent).toBe('SP-300')
    expect(listItem()).toContain('SP-300')
  })

  it('an edit made in the list reaches the panel', async () => {
    renderBoth(SPEC)
    fireEvent.click(within(screen.getByTestId('list-desc')).getByText('Spec sheet'))
    const input = within(screen.getByTestId('list-desc')).getByRole('textbox')
    fireEvent.change(input, { target: { value: 'Edited in the list' } })
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' })
    })
    expect(field(t('common.description')).textContent).toBe('Edited in the list')
  })

  it('pending values survive a reload and still show in both', async () => {
    renderBoth(SPEC)
    act(() => {
      usePDMStore.getState().updatePendingMetadata(h.file(SPEC).path, { part_number: 'SP-400' })
    })
    await act(() => h.reload())
    expect(field(t('fileBrowser.itemNumber')).textContent).toBe('SP-400')
    expect(listItem()).toContain('SP-400')
  })
})

describe('DetailsPanel: SolidWorks files', () => {
  it('a part selected on the properties tab switches to its datacard', async () => {
    h.seedSolidWorksFile(PART, {
      part_number: 'BR-1',
      document: { fileProperties: { Description: 'Bracket' }, configurations: [] },
    })
    await h.reload()
    select(PART)
    renderPanel()
    await waitFor(() => expect(usePDMStore.getState().detailsPanelTab).toBe('preview'))
    // SolidWorks files have no Properties tab: the datacard's Preview is the active one.
    const tabs = screen.getAllByRole('button').filter((b) => b.className.includes('tab '))
    expect(tabs.map((b) => b.textContent)).not.toContain('Properties')
    expect(tabs.find((b) => b.className.includes('active'))?.textContent).toBe('Preview')
  })
})
