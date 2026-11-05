import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

import { en, de, es, fr, pt, zhCN, zhTW } from './locales'
import type { TranslationDict } from './types'
import { flattenTranslations } from './utils'

const locales = { en, de, es, fr, pt, zhCN, zhTW }
const settingsFiles = [
  'account/AccountSettings.tsx',
  'account/SessionsSettings.tsx',
  'components/SettingsNavigation.tsx',
  'organization/AuthProvidersSettings.tsx',
  'organization/ModuleAccessSettings.tsx',
  'organization/MetadataColumnsSettings.tsx',
  'organization/MetadataColumnEditor.tsx',
  'organization/MetadataColumnDialogs.tsx',
  'system/AutoOutputSettings.tsx',
  'system/ExportSettings.tsx',
  'system/SerializationSettingsPresentation.tsx',
]
const usedKeys = new Set(
  settingsFiles.flatMap((file) => {
    const source = readFileSync(join(process.cwd(), 'src/features/settings', file), 'utf8')
    const directKeys = source.matchAll(
      /\b(?:t|translate)\('((?:settings|accountSettings|settingsPages|source\.outputs)\.[^']+)'/g,
    )
    const dataKeys = source.matchAll(
      /\b(?:translationKey|labelKey|descriptionKey|noteKey)\s*:\s*'((?:settings|accountSettings|settingsPages)\.[^']+)'/g,
    )
    return [...directKeys, ...dataKeys].map((match) => match[1])
  }),
)
const catalogSource = readFileSync(
  join(process.cwd(), 'src/features/settings/settingsCatalog.ts'),
  'utf8',
)
for (const match of catalogSource.matchAll(
  /:\s*'((?:settings|preferences|accountSettings|sidebar|securityMonitoring)\.[^']+)'/g,
)) {
  usedKeys.add(match[1])
}
for (const key of [
  'settings.navigation',
  'settings.connected',
  'settings.needsAttention',
  'settings.offline',
  'settings.notConfigured',
  'settings.comingSoon',
  'settings.checkingStatus',
  'settings.backupsWorking',
  'settings.backupFailed',
  'preferences.updateReadyTitle',
  'source.outputs.settingsTitle',
]) {
  usedKeys.add(key)
}

const flat = (dict: TranslationDict) => flattenTranslations(dict)
const tokens = (value: string) =>
  [...value.matchAll(/\{\{[^{}]+\}\}/g)].map((match) => match[0]).sort()

describe('settings localization coverage', () => {
  it('preserves case and singular forms in English', () => {
    const values = flat(en)
    expect(values['accountSettings.unknownLastSeen']).toBe('unknown')
    expect(values['accountSettings.unknown']).toBe('Unknown')
    expect(values['settingsPages.serialization.tabDigitsOptionOne']).toBe(
      '{{digits}} digit ({{first}}-{{last}})',
    )
    expect(values['settingsPages.noOrganizationSelected']).toBe('No organization selected')
  })

  it.each([
    ['de', de, '{{digits}} Stelle ({{first}}-{{last}})'],
    ['es', es, '{{digits}} dígito ({{first}}-{{last}})'],
    ['fr', fr, '{{digits}} chiffre ({{first}}-{{last}})'],
    ['pt', pt, '{{digits}} dígito ({{first}}-{{last}})'],
    ['zh-CN', zhCN, '{{digits}} 位（{{first}}-{{last}}）'],
    ['zh-TW', zhTW, '{{digits}} 位（{{first}}-{{last}}）'],
  ])('uses a singular digit label in %s', (_, dict, expected) => {
    expect(flat(dict)['settingsPages.serialization.tabDigitsOptionOne']).toBe(expected)
  })

  it.each(Object.entries(locales))(
    'defines every current Settings key with matching placeholders for %s',
    (_, dict) => {
      const english = flat(en)
      const values = flat(dict)
      for (const key of usedKeys) {
        expect(values[key], key).toBeTypeOf('string')
        expect(values[key].trim(), key).not.toBe('')
        expect(tokens(values[key]), key).toEqual(tokens(english[key]))
      }
      for (const [key, marker] of [
        ['settingsPages.metadata.deleteConfirm', '{{label}}'],
        ['settingsPages.metadata.pushConfirm', ''],
        ['settingsPages.serialization.scannedFiles', '{{count}}'],
        ['settingsPages.serialization.tabNumbersHelp', '-104'],
        ['settingsPages.export.tokenHelp', '{{examples}}'],
        ['settingsPages.metadata.removeOption', '{{option}}'],
        ['settingsPages.metadata.columnDeleted', '{{label}}'],
      ]) {
        if (marker) expect(values[key].split(marker).length, key).toBe(2)
      }
    },
  )

  it.each(Object.keys(locales))('has no duplicate Settings keys in %s', (locale) => {
    const source = readFileSync(join(process.cwd(), `src/lib/i18n/locales/${locale}.ts`), 'utf8')
    const file = ts.createSourceFile(`${locale}.ts`, source, ts.ScriptTarget.Latest, true)
    const duplicates: string[] = []
    const walk = (node: ts.Node, inScope = false) => {
      const scoped =
        inScope ||
        (ts.isPropertyAssignment(node) &&
          ['settings', 'accountSettings', 'settingsPages'].includes(node.name.getText(file)))
      if (scoped && ts.isObjectLiteralExpression(node)) {
        const seen = new Set<string>()
        for (const property of node.properties) {
          if (!ts.isPropertyAssignment(property)) continue
          const name = property.name.getText(file)
          if (seen.has(name)) duplicates.push(name)
          seen.add(name)
        }
      }
      ts.forEachChild(node, (child) => walk(child, scoped))
    }
    walk(file)
    expect(duplicates).toEqual([])
  })
})
