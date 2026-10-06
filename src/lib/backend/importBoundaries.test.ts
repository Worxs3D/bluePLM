import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import ts from 'typescript'

function namedImports(filePath: string, moduleSpecifier: string): string[] {
  const source = ts.createSourceFile(
    filePath,
    readFileSync(filePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  )

  return source.statements.flatMap((statement) => {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== moduleSpecifier
    ) {
      return []
    }
    const clause = statement.importClause
    if (!clause?.namedBindings || !ts.isNamedImports(clause.namedBindings)) return []
    return clause.namedBindings.elements.map(
      (element) => element.propertyName?.text ?? element.name.text,
    )
  })
}

function expectNoImports(actualImports: string[], forbiddenImports: string[]): void {
  for (const forbiddenImport of forbiddenImports) {
    expect(actualImports).not.toContain(forbiddenImport)
  }
}

describe('authentication call-site import boundaries', () => {
  it('routes auth and identity operations through the backend boundary while retaining only documented Supabase helpers', () => {
    const callSites = [
      'src/hooks/useAuth.ts',
      'src/hooks/useAppStartup.ts',
      'src/components/shared/Screens/WelcomeScreen.tsx',
      'src/components/layout/MenuBar/MenuBar.tsx',
    ]
    const imports = (filePath: string, moduleSpecifier: string) =>
      namedImports(resolve(process.cwd(), filePath), moduleSpecifier)
    const useAuthImports = imports('src/hooks/useAuth.ts', '@/lib/supabase')
    const welcomeImports = imports(
      'src/components/shared/Screens/WelcomeScreen.tsx',
      '@/lib/supabase',
    )
    const menuBarImports = imports('src/components/layout/MenuBar/MenuBar.tsx', '@/lib/supabase')

    for (const callSite of callSites) {
      expect(imports(callSite, '@/lib/backend')).toContain('resolveBackend')
    }
    expectNoImports(useAuthImports, [
      'supabase',
      'isSupabaseConfigured',
      'getUserProfile',
      'linkUserToOrganization',
    ])
    expectNoImports(welcomeImports, [
      'isSupabaseConfigured',
      'signInWithEmail',
      'signInWithPhone',
      'signUpWithEmail',
      'verifyPhoneOTP',
    ])
    expectNoImports(menuBarImports, [
      'isSupabaseConfigured',
      'signInWithEmail',
      'signInWithGoogle',
      'signInWithPhone',
      'signUpWithEmail',
      'verifyPhoneOTP',
    ])
  })
})
