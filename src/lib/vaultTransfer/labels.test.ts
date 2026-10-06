import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { en } from '@/lib/i18n/locales/en'
import { getTranslation } from '@/lib/i18n'
import type { LocalFile } from '@/stores/types'

import type { TransferItemResult, TransferRunResult } from './execute'
import {
  FAILURES,
  KEPT_REASONS,
  LOCAL_COPY_PROBLEMS,
  MAX_REPORTED_FILES,
  SKIP_REASONS,
  describeReport,
  failureLabel,
  fileCountLabel,
  formatBytes,
  itemCountLabel,
  keptReasonLabel,
  localCopyProblemLabel,
  pascal,
  prepareFailureLabel,
  skipReasonLabel,
  vaultTransferKey,
} from './labels'
import { planVaultTransfer } from './plan'
import { buildTransferReport } from './report'
import type { TransferSkipReason } from './types'

function resolves(label: string, key: string): void {
  expect(label, key).not.toBe(vaultTransferKey(key))
  expect(label.length, key).toBeGreaterThan(0)
  expect(label, key).not.toContain('{{')
}

describe('the sentence for every reason', () => {
  it.each(SKIP_REASONS)('has one for skipping a file because of %s', (reason) => {
    resolves(skipReasonLabel(reason), reason)
  })

  it.each(FAILURES)('has one for the failure %s', (failure) => {
    resolves(failureLabel(failure), failure)
  })

  it.each(KEPT_REASONS)('has one for keeping a moved source because of %s', (reason) => {
    resolves(keptReasonLabel(reason), reason)
  })

  it.each(LOCAL_COPY_PROBLEMS)('has one for a disk copy that %s', (outcome) => {
    resolves(localCopyProblemLabel(outcome), outcome)
  })

  it('lists every skip reason the planner can produce', () => {
    // A reason added to the planner's type and not to the list would be reported as a bare key.
    const everyReason = {
      outdated: true,
      ignored: true,
      'deleted-on-server': true,
      'no-content': true,
      'exists-in-destination': true,
      'exists-on-disk': true,
      'duplicate-in-selection': true,
      'path-too-long': true,
      modified: true,
      'checked-out': true,
      'pending-move': true,
    } satisfies Record<TransferSkipReason, true>

    expect([...SKIP_REASONS].sort()).toEqual(Object.keys(everyReason).sort())
  })

  it('has one for every way a destination can fail to be planned', () => {
    resolves(prepareFailureLabel('invalid-folder'), 'validationInvalidFolder')
    resolves(prepareFailureLabel('destination-missing'), 'prepareDestinationMissing')
    const unreadable = prepareFailureLabel('destination-unreadable', 'boom')
    resolves(unreadable, 'prepareDestinationUnreadable')
    expect(unreadable).toContain('boom')
  })
})

describe('pascal', () => {
  it('turns an enum value into the tail of its key', () => {
    expect(pascal('exists-in-destination')).toBe('ExistsInDestination')
    expect(pascal('modified')).toBe('Modified')
  })
})

describe('counts', () => {
  it('uses the singular for one and puts the number in the sentence otherwise', () => {
    expect(fileCountLabel(1)).toBe('1 file')
    expect(fileCountLabel(0)).toContain('0')
    expect(fileCountLabel(12)).toContain('12')
    expect(itemCountLabel(1)).toBe('1 item')
    expect(itemCountLabel(3)).toContain('3')
  })

  it('formats sizes without a long tail of digits', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1023)).toBe('1023 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(12 * 1024 * 1024)).toBe('12 MB')
  })
})

describe('every key in the vaultTransfer group', () => {
  const group = (en.contextMenu as Record<string, unknown>).vaultTransfer as Record<string, string>

  it('is a single flat level of sentences', () => {
    // `TranslationValue` allows three levels and `contextMenu.vaultTransfer` already uses two.
    for (const [key, value] of Object.entries(group)) {
      expect(typeof value, key).toBe('string')
    }
  })

  it('resolves through getTranslation', () => {
    for (const key of Object.keys(group)) {
      const text = getTranslation('en', vaultTransferKey(key), {
        count: 7,
        files: '3 files',
        items: '2 items',
        vault: 'Archive',
        size: '4 MB',
        error: 'boom',
        examples: 'a.sldprt',
      })
      expect(text, key).not.toBe(vaultTransferKey(key))
      expect(text, key).not.toContain('{{')
    }
  })

  it('has no key that nothing refers to', () => {
    // The enum-derived keys (skip*, failure*, kept*, localCopy*) are covered above; the rest are
    // named in the code that shows them. A key nobody reads is a sentence nobody can see.
    const sources = [
      'src/lib/vaultTransfer/labels.ts',
      'src/lib/commands/handlers/vaultTransfer.ts',
      'src/components/shared/Dialogs/VaultTransferDialog.tsx',
      'src/features/source/vaultTransferMenu/VaultTransferMenuItems.tsx',
    ]
      .map((path) => readFileSync(join(__dirname, '..', '..', '..', path), 'utf8'))
      .join('\n')

    const derived = /^(skip|failure|kept|localCopy)[A-Z]/
    const unused = Object.keys(group).filter(
      (key) => !derived.test(key) && !sources.includes(`'${key}'`),
    )
    expect(unused).toEqual([])
  })
})

function file(relativePath: string): LocalFile {
  return {
    name: relativePath,
    path: `C:\\a\\${relativePath}`,
    relativePath,
    isDirectory: false,
    extension: '.sldprt',
    size: 1,
    modifiedTime: '',
    diffStatus: 'added',
  }
}

describe('describeReport', () => {
  const files = Array.from({ length: MAX_REPORTED_FILES + 5 }, (_, index) => file(`p${index}.sldprt`))
  const plan = planVaultTransfer({
    selection: files,
    vaultFiles: files,
    options: { mode: 'copy', destFolder: '', keepPath: false },
    target: { serverPaths: new Set(), diskPaths: new Set(), vaultPath: 'C:\\b' },
  })

  function run(results: TransferItemResult[]): TransferRunResult {
    return {
      results,
      foldersCreated: 0,
      folderFailures: [],
      referencesCopied: 0,
      cancelled: false,
    }
  }

  it('names the vault and the count when everything went through', () => {
    const report = buildTransferReport(
      plan,
      run(plan.files.map((planned) => ({ planned, status: 'transferred', localCopy: 'copied' }))),
      null,
    )
    const { message, details } = describeReport(report, 'copy', 'Archive')

    expect(message).toContain('Archive')
    expect(message).toContain(String(plan.files.length))
    expect(details).toEqual([])
  })

  it('cuts a long list of problems off with a count of the rest', () => {
    const report = buildTransferReport(
      plan,
      run(plan.files.map((planned) => ({ planned, status: 'failed', failure: 'source-locked' }))),
      null,
    )
    const { message, details } = describeReport(report, 'move', 'Archive')

    expect(message).toContain('Archive')
    expect(details).toHaveLength(MAX_REPORTED_FILES + 1)
    expect(details[details.length - 1]).toContain('5')
  })
})
