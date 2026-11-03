import { describe, expect, it } from 'vitest'

import {
  applyOutputNamePattern,
  baseNameOf,
  normalizeExtension,
  OUTPUT_NAME_MAX_BASE,
  outputFileName,
  SAMPLE_OUTPUT_NAME_VALUES,
} from './fileName'
import { autoOutputSettings, outputExtension, outputKindsForPath, supportsOutputKind } from './kinds'
import { orgExportFilenamePattern, versionOutputFileName } from './naming'

const now = new Date(2026, 10, 3, 9, 5, 7)

describe('outputFileName', () => {
  it('replaces every token case-insensitively, as the service does', () => {
    expect(
      outputFileName(
        '{FILENAME}|{config}|{partnumber}|{number}|{tab}|{tabNumber}|{revision}|{rev}|{description}|{desc}|{date}|{time}|{datetime}',
        { ...SAMPLE_OUTPUT_NAME_VALUES, now },
        'step',
      ),
    ).toBe(
      'Part1_Config-A_BR-101011_BR-101011_394_394_A_A_Thruster_Thruster_2026-11-03_09-05-07_2026-11-03_09-05-07.step',
    )
  })

  it('previews the settings sample as the settings page always has', () => {
    expect(outputFileName('{partNumber}-{tab}_Rev{rev}', SAMPLE_OUTPUT_NAME_VALUES, 'step')).toBe(
      'BR-101011-394_RevA.step',
    )
    expect(outputFileName('{filename}_{date}', SAMPLE_OUTPUT_NAME_VALUES, 'step')).toBe('Part1_2026-01-01.step')
  })

  it('drops an empty token with one separator next to it', () => {
    expect(outputFileName('{filename}_{config}', { filename: 'Part1' }, 'pdf')).toBe('Part1.pdf')
    expect(outputFileName('{config}_{filename}', { filename: 'Part1' }, 'pdf')).toBe('Part1.pdf')
    expect(outputFileName('{partNumber}-{tab}_Rev{rev}', { partNumber: 'BR-1', revision: null }, 'step')).toBe(
      'BR-1_Rev.step',
    )
  })

  it('replaces characters Windows refuses and does not double the extension', () => {
    expect(outputFileName('{description}', { description: 'Arm: left/right?' }, '.STEP')).toBe(
      'Arm_ left_right_.step',
    )
    expect(outputFileName('{filename}.step', { filename: 'Part1' }, 'step')).toBe('Part1.step')
  })

  it('falls back to the file name, then to "output"', () => {
    expect(outputFileName('', { filename: 'Part1' }, 'stl')).toBe('Part1.stl')
    expect(outputFileName('{partNumber}', { filename: 'Part1' }, 'stl')).toBe('Part1.stl')
    expect(outputFileName('{partNumber}', {}, 'stl')).toBe('output.stl')
  })

  it('caps the base name before the extension', () => {
    const name = outputFileName('{description}', { description: 'x'.repeat(400) }, 'step')
    expect(name).toBe(`${'x'.repeat(OUTPUT_NAME_MAX_BASE)}.step`)
    expect(outputFileName('{description}', { description: `${'y'.repeat(149)} z` }, 'pdf')).toBe(
      `${'y'.repeat(149)}.pdf`,
    )
  })

  it('keeps literal text and unknown braces', () => {
    expect(applyOutputNamePattern('X-{unknown}-{rev}', { revision: 'B' })).toBe('X-{unknown}-B')
  })

  it('normalizes extensions and base names', () => {
    expect(normalizeExtension('.IGS')).toBe('.igs')
    expect(normalizeExtension('')).toBe('')
    expect(baseNameOf('a/b\\Part1.SLDPRT')).toBe('Part1')
    expect(baseNameOf('.hidden')).toBe('.hidden')
  })
})

describe('kinds', () => {
  it('gives drawings PDF and DXF, models STEP, IGES and STL', () => {
    expect(outputKindsForPath('x/A.SLDDRW')).toEqual(['pdf', 'dxf'])
    expect(outputKindsForPath('A.sldprt')).toEqual(['step', 'iges', 'stl'])
    expect(outputKindsForPath('A.sldasm')).toEqual(['step', 'iges', 'stl'])
    expect(outputKindsForPath('A.pdf')).toEqual([])
    expect(supportsOutputKind('A.sldprt', 'pdf')).toBe(false)
    expect(outputExtension('iges')).toBe('igs')
  })

  it('reads auto_on_checkin with both kinds on by default', () => {
    expect(autoOutputSettings(null)).toEqual({ pdf: true, step: true })
    expect(autoOutputSettings({ outputs: {} })).toEqual({ pdf: true, step: true })
    expect(autoOutputSettings({ outputs: { auto_on_checkin: { step: false } } })).toEqual({ pdf: true, step: false })
  })
})

describe('naming', () => {
  it("uses the organization's export pattern, or the app default", () => {
    expect(orgExportFilenamePattern(null)).toBe('{filename}_{config}')
    expect(orgExportFilenamePattern({ settings: { export_settings: { filename_pattern: '{partNumber}_Rev{rev}' } } })).toBe(
      '{partNumber}_Rev{rev}',
    )
    expect(orgExportFilenamePattern({ settings: { export_settings: { filename_pattern: '  ' } } })).toBe(
      '{filename}_{config}',
    )
  })

  it('names a saved copy from the output and its source', () => {
    const source = { sourceFileName: 'BR-103849-201.SLDPRT', partNumber: 'BR-103849-201', revision: 'A' }
    expect(versionOutputFileName({ kind: 'step', configuration: null }, source, '{partNumber}_Rev{rev}')).toBe(
      'BR-103849-201_RevA.step',
    )
    expect(versionOutputFileName({ kind: 'step', configuration: 'Long' }, source, '{filename}_{config}')).toBe(
      'BR-103849-201_Long.step',
    )
    expect(versionOutputFileName({ kind: 'pdf', configuration: null }, source, '{filename}_{config}')).toBe(
      'BR-103849-201.pdf',
    )
  })
})
