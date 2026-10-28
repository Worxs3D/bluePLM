/**
 * Native extension server contract (host contract v1, "API loading").
 *
 * A native extension's `server/index.js` exports `register(app)`. It runs
 * in-process with full trust; see `.cursor/plans/extensions-native-runtime.plan.md`
 * ("Trust model"). These types are what the API hands it.
 */

import type { FastifyReply, FastifyRequest } from 'fastify'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Logger } from 'pino'
import type { PermissionAction } from '../../middleware/auth.js'
import type { ErrorCode, sendError } from '../../utils/errors.js'

export type { PermissionAction }

export const EXTENSION_HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const
export type ExtensionHttpMethod = (typeof EXTENSION_HTTP_METHODS)[number]

/**
 * What a route handler receives: the Fastify request, authenticated by core's
 * auth middleware (`request.user` is core's `UserProfile`), with `params` set
 * to the sub-route's own parameters, and the Fastify reply.
 */
export type ExtensionRouteHandler = (
  request: FastifyRequest,
  reply: FastifyReply,
) => unknown | Promise<unknown>

export interface ExtensionRoute {
  method: ExtensionHttpMethod
  /** Relative to `/ext/<extensionId>`. `:name` segments and a trailing `*` are supported. */
  url: string
  /** Team permission checked (through `user_has_team_permission`) before the handler runs. */
  permission?: [resource: string, action: PermissionAction]
  /** How long the handler may run before the API answers 504. Default 30 s. */
  timeoutMs?: number
  handler: ExtensionRouteHandler
}

export interface ExtensionServerServices {
  /** Service-role Supabase client. Bypasses RLS: always filter by org. */
  supabaseAdmin: SupabaseClient
  /**
   * The org's stored credential for an integration (`organization_integrations`
   * row of that `integration_type`, read through core's credential store), or
   * null when none is stored. Throws only when the credential store itself is
   * unusable (`CredentialKeyMissingError`, `CredentialStoreUnavailableError`),
   * with a message naming the fix.
   */
  getIntegrationCredential(orgId: string, integration: string): Promise<string | null>
  /** Pino child logger tagged with the extension id. */
  log: Logger
  sendError: typeof sendError
  ErrorCode: typeof ErrorCode
}

export interface ExtensionServerApp {
  /** Add a route. Only valid while `register(app)` runs. */
  route(route: ExtensionRoute): void
  services: ExtensionServerServices
}

/** What `server/index.js` must export. */
export interface NativeExtensionServerModule {
  register(app: ExtensionServerApp): void | Promise<void>
}
