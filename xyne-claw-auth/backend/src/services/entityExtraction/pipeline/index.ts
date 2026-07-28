/**
 * Type-discovery pipeline: read a channel's threads, discover candidate entity
 * types, propose a curated type set.
 *
 * Type discovery ONLY. Mention extraction (and the entity registry it feeds)
 * lives in the Spaces backend, which owns Entity/EntityAlias and the
 * message-level Vespa writes — see entityExtractionService.ts.
 *
 * This barrel exports exactly what claw-auth consumes. Everything else
 * (prompts, batching, normalisation, similarity) is an implementation detail
 * the stages import directly from their own modules.
 */

export { mergeConfig } from './config.js'
export type { BootstrapConfig } from './config.js'

export type { JsonCompletionRequest, LlmClient, Logger } from './ports.js'
export type { SourceDocument, SourceMessage } from './types.js'

export {
  buildThreadDocument,
  buildTicketDocument,
  channelMetaDocument,
} from './stages/buildThreadDocuments.js'
export { mapWithConcurrency } from './lib/concurrency.js'
export { discoverTypeCandidates } from './stages/discoverTypes.js'
export { proposeTypes } from './stages/proposeTypes.js'

export { formatErrors, validate } from './lib/validate.js'
