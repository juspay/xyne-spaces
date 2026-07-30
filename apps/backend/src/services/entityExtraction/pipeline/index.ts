/**
 * Mention-extraction pipeline: read a channel's threads/tickets, extract typed
 * mentions against the APPROVED types, feed them to the resolver.
 *
 * Type discovery lives in claw-auth — this backend only consumes approved types
 * and owns the entity registry. See entityExtractionService.ts.
 */

export { mergeConfig } from './config.js'
export type { BootstrapConfig, DeepPartial } from './config.js'

export type { JsonCompletionRequest, LlmClient } from './ports.js'
export type { SourceDocument, SourceMessage } from './types.js'

export { buildThreadDocument } from './stages/buildThreadDocuments.js'
export type { ChannelInput } from './stages/buildThreadDocuments.js'
export { mapWithConcurrency, chunkBySize } from './lib/concurrency.js'
export { extractMentions } from './stages/extractMentions.js'
export type { ExtractionType, Mention } from './types.js'

export { formatDocBatch } from './prompts.js'
export { normalize, NORMALIZER_VERSION } from './lib/normalize.js'
export { formatErrors, validate } from './lib/validate.js'
