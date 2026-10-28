/**
 * Utils Barrel Export
 */

// Error responses
export { sendError, ErrorCode } from './errors.js'

// Crypto utilities
export { computeHash, generateWebhookSecret, signWebhookPayload } from './crypto.js'

// File utilities
export { getFileTypeFromExtension } from './files.js'

// LIKE pattern escaping (copy of src/lib/utils/likePattern.ts - see that file)
export { escapeLikePattern, folderPrefixLikePattern } from './likePattern.js'

// Odoo integration (supplier sync). The read-only guarded wrapper
// (odooReadOnlyCall) left with the Customers extension, its only user.
export {
  normalizeOdooUrl,
  testOdooConnection,
  fetchOdooSuppliers,
  getLastXmlResponses,
  clearLastXmlResponses,
} from './odoo.js'

// Webhooks
export { webhooks, triggerWebhooks } from './webhooks.js'

// Workflow engine
export { changeFileStateViaWorkflow, stateChangeErrorResponse } from './workflow.js'
export type { LegacyFileState, StateChangeResult } from './workflow.js'
