/**
 * Native extension routes.
 *
 * - ALL /ext/:extensionId/*       dispatch into the extension's route table
 * - POST /admin/extensions/reload reload native extensions (admin only)
 *
 * Every /ext request is authenticated by core's auth (`fastify.authenticate`)
 * and is under core's global rate limit, the same as any other route. Then:
 * native extensions disabled on this server (NATIVE_EXTENSIONS_ORG_IDS unset)
 * is 503 NATIVE_EXTENSIONS_DISABLED, the caller's org not in that list is 403
 * NATIVE_EXTENSIONS_DISABLED, extension not loaded for the caller's org, or the
 * caller's org has no enabled install of it, is
 * 404; the org's install at a different sha256 from the loaded one is 409
 * `EXTENSION_VERSION_MISMATCH`; an unknown sub-route is core's own
 * `404 NOT_FOUND 'Endpoint not found'`; a route `permission` is checked with
 * core's `requireTeamPermission`; the handler runs under its `timeoutMs`
 * (default 30 s, 504 when it runs out); a thrown handler error is logged and
 * answered 500 `INTERNAL_ERROR`.
 */

import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import { requireTeamPermission } from '../../middleware/auth.js'
import { sendError } from '../../utils/errors.js'
import type { NativeExtensionRuntime } from './runtime.js'
import type { OrgInstall } from './store.js'
import { EXTENSION_HTTP_METHODS, type ExtensionRoute } from './types.js'

/** Handler time limit when a route does not set `timeoutMs`. */
export const DEFAULT_ROUTE_TIMEOUT_MS = 30_000

/** Same message for "not loaded" and "not installed for your org", so neither leaks the other. */
const NOT_AVAILABLE = 'Extension is not available'

const DISABLED_ON_SERVER =
  'Native extensions are disabled on this API server (the operator has not set NATIVE_EXTENSIONS_ORG_IDS)'
const DISABLED_FOR_ORG =
  'Native extensions are not enabled for your organization on this API server'

export interface NativeExtensionRoutesOptions {
  /** Null when the API cannot load native extensions (no service-role key). */
  runtime: NativeExtensionRuntime | null
  /** Start loading at `onReady`. Off in tests that load explicitly. */
  autoLoad?: boolean
}

class RouteTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Extension route did not finish within ${timeoutMs} ms`)
    this.name = 'RouteTimeoutError'
  }
}

async function runWithTimeout<T>(work: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      work(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new RouteTimeoutError(timeoutMs)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export const nativeExtensionRoutes: FastifyPluginAsync<NativeExtensionRoutesOptions> = async (
  fastify,
  options,
) => {
  const runtime = options.runtime

  if (runtime && options.autoLoad) {
    fastify.addHook('onReady', async () => {
      // Not awaited: downloads must not hold up boot. /ext requests wait for it.
      void runtime.start()
    })
  }

  async function dispatch(request: FastifyRequest, reply: FastifyReply): Promise<unknown> {
    const { extensionId, '*': rest } = request.params as { extensionId: string; '*'?: string }
    const user = request.user
    if (!user?.org_id) {
      return sendError(reply, 403, 'FORBIDDEN', 'User is not a member of any organization')
    }
    if (!runtime || !runtime.enabled) {
      return sendError(reply, 503, 'NATIVE_EXTENSIONS_DISABLED', DISABLED_ON_SERVER)
    }
    if (!runtime.isOrgAllowed(user.org_id)) {
      return sendError(reply, 403, 'NATIVE_EXTENSIONS_DISABLED', DISABLED_FOR_ORG)
    }

    await runtime.whenReady()
    const loaded = runtime.get(user.org_id, extensionId)
    if (!loaded) return sendError(reply, 404, 'NOT_FOUND', NOT_AVAILABLE)

    let install: OrgInstall | null
    try {
      install = await runtime.getOrgInstall(user.org_id, extensionId)
    } catch (err) {
      // Fail closed: an install we cannot read is not one we run code for.
      request.log.error({ err, extensionId }, '[NativeExtensions] Install check failed')
      return sendError(reply, 503, 'INTERNAL_ERROR', 'Could not verify the extension install')
    }
    if (!install || !install.enabled) return sendError(reply, 404, 'NOT_FOUND', NOT_AVAILABLE)
    if ((install.package_sha256 ?? '').trim().toLowerCase() !== loaded.sha256) {
      return sendError(
        reply,
        409,
        'EXTENSION_VERSION_MISMATCH',
        `Your organization's installed version of ${extensionId} differs from the one this API has loaded. ` +
          'An administrator can reload extensions on the API, or reinstall the extension.',
      )
    }

    const match = loaded.routes.match(request.method === 'HEAD' ? 'GET' : request.method, `/${rest ?? ''}`)
    if (!match) return sendError(reply, 404, 'NOT_FOUND', 'Endpoint not found')
    const route: ExtensionRoute = match.route

    if (route.permission) {
      const [resource, action] = route.permission
      try {
        await requireTeamPermission(resource, action)(request, reply)
      } catch {
        // requireTeamPermission answers 401/403 in core's shape before it throws.
        // Anything else that threw (the RPC itself rejecting) is still a denial.
        if (reply.sent) return reply
        return sendError(reply, 403, 'FORBIDDEN', 'Permission check failed')
      }
    }

    // The handler sees only its own sub-route parameters.
    request.params = match.params
    const timeoutMs = route.timeoutMs ?? DEFAULT_ROUTE_TIMEOUT_MS

    try {
      const result = await runWithTimeout(async () => route.handler(request, reply), timeoutMs)
      if (reply.sent) return reply
      if (result === undefined || result === reply) return reply.send()
      return result
    } catch (err) {
      if (err instanceof RouteTimeoutError) {
        loaded.log.warn({ method: request.method, url: route.url, timeoutMs }, 'Route timed out')
        if (reply.sent) return reply
        return sendError(reply, 504, 'EXTENSION_TIMEOUT', err.message)
      }
      loaded.log.error({ err, method: request.method, url: route.url }, 'Route handler failed')
      if (reply.sent) return reply
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Internal server error')
    }
  }

  const routeSchema = {
    description: 'Native extension route',
    tags: ['Extensions'],
    security: [{ bearerAuth: [] }],
  }

  fastify.route({
    method: [...EXTENSION_HTTP_METHODS],
    url: '/ext/:extensionId/*',
    schema: routeSchema,
    preHandler: fastify.authenticate,
    handler: dispatch,
  })
  fastify.route({
    method: [...EXTENSION_HTTP_METHODS],
    url: '/ext/:extensionId',
    schema: routeSchema,
    preHandler: fastify.authenticate,
    handler: dispatch,
  })

  fastify.post(
    '/admin/extensions/reload',
    {
      schema: {
        description:
          "Reload the caller's organization's native extensions on this API instance (admin only, allowed orgs only)",
        tags: ['Extensions'],
        security: [{ bearerAuth: [] }],
      },
      preHandler: fastify.authenticate,
    },
    async (request, reply) => {
      if (!request.user?.isAdmin) {
        return sendError(reply, 403, 'FORBIDDEN', 'Only admins can reload extensions')
      }
      if (!runtime) {
        return sendError(
          reply,
          503,
          'INTERNAL_ERROR',
          'Native extensions are unavailable: SUPABASE_SERVICE_KEY is not configured on the API',
        )
      }
      const orgId = request.user.org_id
      if (!orgId) return sendError(reply, 403, 'FORBIDDEN', 'User is not a member of any organization')
      if (!runtime.enabled) {
        return sendError(reply, 503, 'NATIVE_EXTENSIONS_DISABLED', DISABLED_ON_SERVER)
      }
      if (!runtime.isOrgAllowed(orgId)) {
        return sendError(reply, 403, 'NATIVE_EXTENSIONS_DISABLED', DISABLED_FOR_ORG)
      }
      await runtime.whenReady()
      const report = await runtime.reload(orgId)
      return { success: !report.error && report.failed.length === 0, ...report }
    },
  )
}
