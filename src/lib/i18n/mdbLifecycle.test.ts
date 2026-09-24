import { describe, expect, it } from 'vitest'
import { getTranslation } from '.'
import type { Language } from './types'

const languages: Language[] = ['en', 'de', 'es', 'fr', 'pt', 'zh-CN', 'zh-TW']
const keys = [
  'ftpServer',
  'ftpSecurity',
  'ftpSecurityExplicit',
  'ftpSecurityExplicitHelp',
  'ftpSecurityImplicit',
  'ftpSecurityImplicitHelp',
  'membershipRoleOwner',
  'membershipRoleAdmin',
  'membershipRoleMember',
  'membershipRoleEngineer',
  'membershipRoleViewer',
  'membershipRoleGuest',
  'databaseInspectionUnavailable',
  'databaseInspectionFailed',
  'installerUnavailable',
  'inspectBeforeContinue',
  'installationFailed',
  'migrationComplete',
  'installationComplete',
  'continueToLogin',
  'databaseDetected',
  'databaseEmpty',
  'databaseManaged',
  'databaseLegacy',
  'databaseForeign',
  'databaseSummary',
  'migrateExisting',
  'eraseAndReinstall',
  'initialOwner',
  'companyName',
  'companySlug',
  'ownerName',
  'ownerEmail',
  'ownerPassword',
  'vaultName',
  'networkVaultPath',
  'confirmDatabaseErase',
  'inspectDatabase',
  'runMigration',
  'eraseAndInstall',
]

describe('MDB installer translations', () => {
  it.each(languages)('provides every lifecycle label in %s', (language) => {
    for (const key of keys) {
      const fullKey = `mdbSetup.${key}`
      expect(getTranslation(language, fullKey)).not.toBe(fullKey)
    }
  })
})
