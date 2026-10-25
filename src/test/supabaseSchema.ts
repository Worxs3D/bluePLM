/**
 * The table and RPC shapes the fake Supabase enforces, read out of `src/types/supabase.ts`.
 *
 * Generated types are erased at runtime, so a fake that only borrows them as TypeScript types
 * still accepts `.select('no_such_column')` or a misspelt RPC argument and answers as if the
 * database had them. That is how an RPC called but never created, and a column renamed on one
 * side only, reached users with every test green. Parsing the generated file with the compiler
 * keeps the fake exactly as strict as the schema the app was compiled against.
 *
 * Test-only. Reads the file once per process.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import ts from 'typescript'

export interface TableShape {
  /** Every column a `Row` has. */
  columns: ReadonlySet<string>
  /** Columns an `Insert` must name (not optional in the generated `Insert` type). */
  requiredOnInsert: ReadonlySet<string>
}

export interface FunctionShape {
  /** Every argument name across all overloads. */
  args: ReadonlySet<string>
  /** Arguments every overload requires. */
  required: ReadonlySet<string>
}

export interface SchemaShape {
  tables: ReadonlyMap<string, TableShape>
  functions: ReadonlyMap<string, FunctionShape>
}

let cached: SchemaShape | null = null

function memberName(member: ts.TypeElement): string | null {
  if (!member.name) return null
  if (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)) return member.name.text
  return null
}

function literalMembers(node: ts.TypeNode | undefined): ts.TypeLiteralNode | null {
  return node && ts.isTypeLiteralNode(node) ? node : null
}

function property(literal: ts.TypeLiteralNode, name: string): ts.PropertySignature | null {
  for (const member of literal.members) {
    if (ts.isPropertySignature(member) && memberName(member) === name) return member
  }
  return null
}

function readTable(literal: ts.TypeLiteralNode): TableShape {
  const row = literalMembers(property(literal, 'Row')?.type)
  const insert = literalMembers(property(literal, 'Insert')?.type)
  const columns = new Set<string>()
  const requiredOnInsert = new Set<string>()
  for (const member of row?.members ?? []) {
    const name = memberName(member)
    if (name) columns.add(name)
  }
  for (const member of insert?.members ?? []) {
    const name = memberName(member)
    if (name && ts.isPropertySignature(member) && !member.questionToken) requiredOnInsert.add(name)
  }
  return { columns, requiredOnInsert }
}

function readFunction(literal: ts.TypeLiteralNode): FunctionShape {
  const argsType = property(literal, 'Args')?.type
  const overloads: ts.TypeLiteralNode[] = []
  if (argsType && ts.isUnionTypeNode(argsType)) {
    for (const t of argsType.types) if (ts.isTypeLiteralNode(t)) overloads.push(t)
  } else if (argsType && ts.isTypeLiteralNode(argsType)) {
    overloads.push(argsType)
  }

  const args = new Set<string>()
  // Required by every overload: counted, so a name missing from one overload drops out.
  const requiredIn = new Map<string, number>()
  for (const overload of overloads) {
    for (const member of overload.members) {
      const name = memberName(member)
      if (!name) continue
      args.add(name)
      if (ts.isPropertySignature(member) && !member.questionToken) {
        requiredIn.set(name, (requiredIn.get(name) ?? 0) + 1)
      }
    }
  }
  const required = new Set(
    [...requiredIn].filter(([, count]) => count === overloads.length).map(([name]) => name),
  )
  return { args, required }
}

export function loadSchemaShape(): SchemaShape {
  if (cached) return cached

  const path = resolve(__dirname, '../types/supabase.ts')
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest)

  let publicSchema: ts.TypeLiteralNode | null = null
  source.forEachChild((node) => {
    if (!ts.isTypeAliasDeclaration(node) || node.name.text !== 'Database') return
    const db = literalMembers(node.type)
    if (db) publicSchema = literalMembers(property(db, 'public')?.type)
  })
  if (!publicSchema) throw new Error('src/types/supabase.ts: no Database.public type found')
  const schema: ts.TypeLiteralNode = publicSchema

  const tables = new Map<string, TableShape>()
  for (const section of ['Tables', 'Views']) {
    for (const member of literalMembers(property(schema, section)?.type)?.members ?? []) {
      const name = memberName(member)
      const literal = ts.isPropertySignature(member) ? literalMembers(member.type) : null
      if (name && literal) tables.set(name, readTable(literal))
    }
  }

  const functions = new Map<string, FunctionShape>()
  for (const member of literalMembers(property(schema, 'Functions')?.type)?.members ?? []) {
    const name = memberName(member)
    const literal = ts.isPropertySignature(member) ? literalMembers(member.type) : null
    if (name && literal) functions.set(name, readFunction(literal))
  }

  cached = { tables, functions }
  return cached
}
