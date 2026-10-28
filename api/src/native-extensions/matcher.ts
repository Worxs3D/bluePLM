/**
 * Per-extension route table.
 *
 * Small on purpose: an extension's routes are a handful of fixed paths with
 * `:param` segments. Supports literal segments, `:name` segments and a trailing
 * `*` that captures the rest of the path into `params['*']`. When several
 * routes match, the most specific wins segment by segment (literal, then
 * `:param`, then `*`), so `/sync/status` beats `/sync/:id`.
 */

import type { ExtensionHttpMethod, ExtensionRoute } from './types.js'

type Segment = { kind: 'literal'; value: string } | { kind: 'param'; name: string } | { kind: 'wildcard' }

interface CompiledRoute {
  route: ExtensionRoute
  segments: Segment[]
}

export interface RouteMatch {
  route: ExtensionRoute
  params: Record<string, string>
}

function splitPath(path: string): string[] {
  return path.split('/').filter((s) => s.length > 0)
}

/** Parse a route url, or throw with the reason. */
export function compileRouteUrl(url: string): Segment[] {
  if (typeof url !== 'string' || !url.startsWith('/')) {
    throw new Error(`Route url must start with '/': ${String(url)}`)
  }
  const parts = splitPath(url)
  const names = new Set<string>()
  return parts.map((part, index) => {
    if (part === '*') {
      if (index !== parts.length - 1) throw new Error(`'*' is only allowed as the last segment: ${url}`)
      return { kind: 'wildcard' }
    }
    if (part.startsWith(':')) {
      const name = part.slice(1)
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`Invalid parameter name in ${url}`)
      if (names.has(name)) throw new Error(`Duplicate parameter '${name}' in ${url}`)
      names.add(name)
      return { kind: 'param', name }
    }
    return { kind: 'literal', value: part }
  })
}

function rank(segment: Segment): number {
  return segment.kind === 'literal' ? 0 : segment.kind === 'param' ? 1 : 2
}

function moreSpecific(a: Segment[], b: Segment[]): boolean {
  const length = Math.max(a.length, b.length)
  for (let i = 0; i < length; i++) {
    const ra = a[i] ? rank(a[i]) : 3
    const rb = b[i] ? rank(b[i]) : 3
    if (ra !== rb) return ra < rb
  }
  return false
}

function signature(segments: Segment[]): string {
  return segments.map((s) => (s.kind === 'literal' ? `l:${s.value}` : s.kind === 'param' ? 'p' : '*')).join('/')
}

export class ExtensionRouteTable {
  private readonly routes = new Map<ExtensionHttpMethod, CompiledRoute[]>()

  add(route: ExtensionRoute): void {
    const segments = compileRouteUrl(route.url)
    const list = this.routes.get(route.method) ?? []
    const sig = signature(segments)
    if (list.some((existing) => signature(existing.segments) === sig)) {
      throw new Error(`Duplicate route: ${route.method} ${route.url}`)
    }
    list.push({ route, segments })
    this.routes.set(route.method, list)
  }

  get size(): number {
    let total = 0
    for (const list of this.routes.values()) total += list.length
    return total
  }

  match(method: string, path: string): RouteMatch | null {
    const list = this.routes.get(method.toUpperCase() as ExtensionHttpMethod)
    if (!list) return null
    const parts = splitPath(path)
    let best: { compiled: CompiledRoute; params: Record<string, string> } | null = null
    for (const compiled of list) {
      const params = matchSegments(compiled.segments, parts)
      if (!params) continue
      if (!best || moreSpecific(compiled.segments, best.compiled.segments)) {
        best = { compiled, params }
      }
    }
    return best ? { route: best.compiled.route, params: best.params } : null
  }
}

function matchSegments(segments: Segment[], parts: string[]): Record<string, string> | null {
  const params: Record<string, string> = {}
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]
    if (segment.kind === 'wildcard') {
      params['*'] = parts.slice(i).join('/')
      return params
    }
    const part = parts[i]
    if (part === undefined) return null
    if (segment.kind === 'literal') {
      if (segment.value !== part) return null
    } else {
      params[segment.name] = part
    }
  }
  return parts.length === segments.length ? params : null
}
