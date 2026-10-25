import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import ts from 'typescript'
import { describe, expect, it } from 'vitest'

// The TypeScript half of the SolidWorks service wire contract. The manifest is
// solidworks-service/wire-manifest.json; WireManifestTests.cs checks the C# half
// (the Program.cs action switch, the fields each action reads, the codes it can
// emit) against the same file. Together they catch an action, request field or
// error code renamed on one side only, which no unit test sees because every
// test of either side stubs the other.

const REPO = resolve(__dirname, '../..')

interface ActionEntry {
  request: string[]
  ignoredByService?: Record<string, string>
  responseData?: string[]
}

interface WireManifest {
  commonRequestFields: string[]
  responseFields: string[]
  actions: Record<string, ActionEntry>
  errorCodes: { service: string[]; comErrorCode: string[]; client: string[] }
}

const manifest = JSON.parse(
  readFileSync(resolve(REPO, 'solidworks-service/wire-manifest.json'), 'utf8'),
) as WireManifest

function listTsFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...listTsFiles(full))
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith('.d.ts')) {
      out.push(full)
    }
  }
  return out
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
}

function walk(node: ts.Node, visit: (n: ts.Node) => void): void {
  visit(node)
  node.forEachChild((child) => walk(child, visit))
}

function where(n: ts.Node): string {
  const sf = n.getSourceFile()
  return `${relative(REPO, sf.fileName).replace(/\\/g, '/')}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`
}

function propName(name: ts.PropertyName): string {
  return ts.isIdentifier(name) || ts.isStringLiteralLike(name) ? name.text : name.getText()
}

const electronSources = listTsFiles(resolve(REPO, 'electron')).map(parse)

// ---------------------------------------------------------------------------
// Requests

interface SentCommand {
  action: string | null
  keys: string[]
  unresolvedSpreads: string[]
  at: string
}

/** The fields of `...name` when `name` is a parameter of the enclosing function typed inline. */
function spreadKeys(spread: ts.SpreadAssignment): string[] | null {
  if (!ts.isIdentifier(spread.expression)) return null
  const name = spread.expression.text
  let fn: ts.Node | undefined = spread.parent
  while (fn && !ts.isFunctionLike(fn)) fn = fn.parent
  if (!fn || !ts.isFunctionLike(fn)) return null
  const param = fn.parameters.find((p) => ts.isIdentifier(p.name) && p.name.text === name)
  if (!param?.type || !ts.isTypeLiteralNode(param.type)) return null
  return param.type.members.flatMap((m) => (m.name ? [propName(m.name)] : []))
}

function collectSentCommands(): SentCommand[] {
  const out: SentCommand[] = []
  for (const sf of electronSources) {
    walk(sf, (n) => {
      if (!ts.isCallExpression(n) || !ts.isIdentifier(n.expression)) return
      if (n.expression.text !== 'sendSWCommand') return
      const arg = n.arguments[0]
      const cmd: SentCommand = { action: null, keys: [], unresolvedSpreads: [], at: where(n) }
      if (!arg || !ts.isObjectLiteralExpression(arg)) {
        cmd.unresolvedSpreads.push(arg ? arg.getText() : '(no argument)')
        out.push(cmd)
        return
      }
      for (const prop of arg.properties) {
        if (ts.isSpreadAssignment(prop)) {
          const keys = spreadKeys(prop)
          if (keys) cmd.keys.push(...keys)
          else cmd.unresolvedSpreads.push(prop.getText())
        } else if (prop.name) {
          const key = propName(prop.name)
          if (
            key === 'action' &&
            ts.isPropertyAssignment(prop) &&
            ts.isStringLiteralLike(prop.initializer)
          ) {
            cmd.action = prop.initializer.text
          } else if (key !== 'action') {
            cmd.keys.push(key)
          }
        }
      }
      out.push(cmd)
    })
  }
  return out
}

describe('SolidWorks wire: requests the app sends', () => {
  const sent = collectSentCommands()

  it('finds the service calls', () => {
    expect(sent.length).toBeGreaterThan(30)
  })

  it('every call names a literal action and spreads only inline-typed parameters', () => {
    const bad = sent
      .filter((c) => c.action === null || c.unresolvedSpreads.length > 0)
      .map((c) => `${c.at}: action=${c.action} unresolved=${c.unresolvedSpreads.join(', ')}`)
    expect(bad).toEqual([])
  })

  it('every action sent is one the manifest (and so the service switch) has', () => {
    const unknown = sent
      .filter((c) => c.action !== null && !(c.action in manifest.actions))
      .map((c) => `${c.action} (${c.at})`)
    expect(unknown).toEqual([])
  })

  it('every field sent is one the manifest lists for that action', () => {
    const extra: string[] = []
    for (const c of sent) {
      const entry = c.action ? manifest.actions[c.action] : undefined
      if (!entry) continue
      const allowed = new Set([...manifest.commonRequestFields, ...entry.request])
      for (const key of c.keys) {
        if (!allowed.has(key)) extra.push(`${c.action}.${key} (${c.at})`)
      }
    }
    expect(extra).toEqual([])
  })

  it('every field marked ignoredByService is still sent', () => {
    const sentKeys = new Map<string, Set<string>>()
    for (const c of sent) {
      if (!c.action) continue
      const set = sentKeys.get(c.action) ?? new Set<string>()
      c.keys.forEach((k) => set.add(k))
      sentKeys.set(c.action, set)
    }
    const stale: string[] = []
    for (const [action, entry] of Object.entries(manifest.actions)) {
      for (const key of Object.keys(entry.ignoredByService ?? {})) {
        if (!sentKeys.get(action)?.has(key)) stale.push(`${action}.${key}`)
      }
    }
    expect(stale).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Responses

function interfaceMembers(file: string, name: string): string[] {
  const sf = parse(resolve(REPO, file))
  let members: string[] | undefined
  walk(sf, (n) => {
    if (ts.isInterfaceDeclaration(n) && n.name.text === name) {
      members = n.members.flatMap((m) => (m.name ? [propName(m.name)] : []))
    }
  })
  if (!members) throw new Error(`interface ${name} not found in ${file}`)
  return members
}

/** Names read as `<receiver>.<name>` / `<receiver>?.<name>`, where receiver's text ends with `suffix`. */
function propertiesReadOff(file: string, suffix: string): string[] {
  const sf = parse(resolve(REPO, file))
  const out = new Set<string>()
  walk(sf, (n) => {
    if (ts.isPropertyAccessExpression(n) && n.expression.getText().replace(/\?/g, '').endsWith(suffix)) {
      out.add(n.name.text)
    }
  })
  return [...out]
}

describe('SolidWorks wire: responses the app reads', () => {
  it('SwServiceResult names only fields CommandResult serializes', () => {
    const fields = interfaceMembers('electron/handlers/solidworksErrors.ts', 'SwServiceResult')
    expect(fields.filter((f) => !manifest.responseFields.includes(f))).toEqual([])
  })

  it('writeMetadataToFile reads back only the getProperties data fields the service returns', () => {
    const read = propertiesReadOff('src/lib/metadata/writeMetadataToFile.ts', 'result.data')
    expect(read.length).toBeGreaterThan(0)
    expect(read.filter((f) => !manifest.actions.getProperties.responseData?.includes(f))).toEqual([])
  })

  it('the batch write report reads only the setPropertiesBatch data fields the service returns', () => {
    const read = propertiesReadOff('src/lib/metadata/batchWriteReport.ts', 'data')
    expect(read.length).toBeGreaterThan(0)
    expect(
      read.filter((f) => !manifest.actions.setPropertiesBatch.responseData?.includes(f)),
    ).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Error codes

const allCodes = new Set([...manifest.errorCodes.service, ...manifest.errorCodes.client])

// Codes compared in files that also talk to the service but that come from
// somewhere else.
const NOT_SERVICE_CODES: Record<string, string> = {
  NOT_CONNECTED: 'Google Drive template listing in InspectionTab (googleDrive inspection templates)',
}
const SCREAMING = /^[A-Z][A-Z0-9_]+$/

describe('SolidWorks wire: error codes', () => {
  it("mapServiceErrorCode's keys are ComErrorCode names in one of the two spellings it accepts", () => {
    const sf = parse(resolve(REPO, 'electron/handlers/solidworksErrors.ts'))
    const keys: string[] = []
    walk(sf, (n) => {
      if (
        ts.isVariableDeclaration(n) &&
        ts.isIdentifier(n.name) &&
        n.name.text === 'codeMapping' &&
        n.initializer &&
        ts.isObjectLiteralExpression(n.initializer)
      ) {
        for (const p of n.initializer.properties) if (p.name) keys.push(propName(p.name))
      }
    })
    expect(keys.length).toBeGreaterThan(0)
    // ComErrorCode.ToString() gives PascalCase (SwNotRunning); the mapper upper-cases it.
    const accepted = new Set(
      manifest.errorCodes.comErrorCode.flatMap((c) => [
        c.toUpperCase(),
        c.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase(),
      ]),
    )
    expect(keys.filter((k) => !accepted.has(k))).toEqual([])
    // Every ComErrorCode the service can send is mapped.
    expect(
      manifest.errorCodes.comErrorCode.filter((c) => !keys.includes(c.toUpperCase())),
    ).toEqual([])
  })

  it('every code the app branches on is one the service (or the client itself) produces', () => {
    // Files that talk to the service: everything under electron/ plus renderer
    // files that mention SolidWorks. String constants are resolved across them.
    const rendererSources = listTsFiles(resolve(REPO, 'src'))
      .filter((f) => /solidworks/i.test(readFileSync(f, 'utf8')))
      .map(parse)
    const sources = [...electronSources, ...rendererSources]

    const consts = new Map<string, string>()
    for (const sf of sources) {
      walk(sf, (n) => {
        if (
          ts.isVariableDeclaration(n) &&
          ts.isIdentifier(n.name) &&
          n.initializer &&
          ts.isStringLiteralLike(n.initializer)
        ) {
          consts.set(n.name.text, n.initializer.text)
        }
      })
    }
    const valueOf = (e: ts.Expression): string | null =>
      ts.isStringLiteralLike(e) ? e.text : ts.isIdentifier(e) ? (consts.get(e.text) ?? null) : null
    const isCodeRead = (e: ts.Expression): boolean =>
      ts.isPropertyAccessExpression(e) && (e.name.text === 'errorCode' || e.name.text === 'error')

    const unknown: string[] = []
    let compared = 0
    for (const sf of sources) {
      walk(sf, (n) => {
        if (!ts.isBinaryExpression(n)) return
        const op = n.operatorToken.kind
        if (op !== ts.SyntaxKind.EqualsEqualsEqualsToken && op !== ts.SyntaxKind.ExclamationEqualsEqualsToken) {
          return
        }
        const [read, other] = isCodeRead(n.left) ? [n.left, n.right] : [n.right, n.left]
        if (!isCodeRead(read)) return
        const value = valueOf(other)
        if (value === null || !SCREAMING.test(value) || value in NOT_SERVICE_CODES) return
        compared++
        if (!allCodes.has(value)) unknown.push(`${value} (${where(n)})`)
      })
    }
    expect(compared).toBeGreaterThan(3)
    expect(unknown).toEqual([])
    // It parses every renderer file that mentions SolidWorks, which took past the 5 s default
    // under v8 coverage in CI.
  }, 30_000)

  it('codes the renderer imports from lib/solidworks/types are in the manifest', () => {
    const sf = parse(resolve(REPO, 'src/lib/solidworks/types.ts'))
    const exported: string[] = []
    walk(sf, (n) => {
      if (
        ts.isVariableDeclaration(n) &&
        n.initializer &&
        ts.isStringLiteralLike(n.initializer) &&
        SCREAMING.test(n.initializer.text)
      ) {
        exported.push(n.initializer.text)
      }
    })
    expect(exported.length).toBeGreaterThan(0)
    expect(exported.filter((c) => !allCodes.has(c))).toEqual([])
  })
})
