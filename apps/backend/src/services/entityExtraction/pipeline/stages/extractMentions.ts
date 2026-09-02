import type { BootstrapConfig } from '../config.js'
import type { LlmClient } from '../ports.js'
import type { ExtractionType, Mention, SourceDocument } from '../types.js'
import {
  buildMentionSchema,
  buildMentionSystem,
  formatDocBatch,
  type MentionResponse,
} from '../prompts.js'
import { chunkBySize, mapWithConcurrency } from '../lib/concurrency.js'
import { logger } from '@/utils/logger'

/**
 * Stage 4 — extract typed mentions, scoped to the approved types.
 *
 * Closed extraction: the model may only tag a span with one of `types`. The
 * schema's enum enforces it, so a mention filed under an invented type is
 * rejected and retried by the LlmClient. Output is raw mentions anchored to a
 * document — identity (which mentions are the same entity) is the resolver's
 * job, not this stage's.
 */
export async function extractMentions(
  docs: SourceDocument[],
  types: ExtractionType[],
  llm: LlmClient,
  config: BootstrapConfig,
  /** Org/channel framing prepended to the system prompt. */
  context?: string,
): Promise<Mention[]> {
  if (types.length === 0 || docs.length === 0) return []

  const base = buildMentionSystem(types)
  const system = context ? `${context}\n\n${base}` : base
  const schema = buildMentionSchema(types.map((t) => t.name))

  const batches = chunkBySize(
    docs,
    (d) => Math.min(d.text.length, config.extract.maxDocChars),
    config.extract.maxBatchChars,
    config.extract.batchSize,
  )

  let failedBatches = 0

  const responses = await mapWithConcurrency(
    batches,
    config.extract.concurrency,
    async (batch, batchIndex) => {
      try {
        return await llm.completeJson<MentionResponse>({
          system,
          user: formatDocBatch(batch, config.extract.maxDocChars),
          schema,
          schemaName: 'Mentions',
          purpose: 'entity:extract-mentions',
        })
      } catch (err) {
        failedBatches++
        // A failed batch yields zero mentions, which reads exactly like a batch
        // with nothing to find — so log the docIds, which carry the thread
        // (`thread:<threadId>[#part]`) and say which content was never looked at.
        logger.error('[ENTITY_EXTRACT] mention batch failed', {
          batch: `${batchIndex + 1}/${batches.length}`,
          docIds: batch.map((d) => d.id),
          chars: batch.reduce((n, d) => n + d.text.length, 0),
          error: err instanceof Error ? err.message : String(err),
        })
        return { mentions: [] } satisfies MentionResponse
      }
    },
  )

  const mentions: Mention[] = []
  responses.forEach((res, batchIndex) => {
    const batch = batches[batchIndex]!
    for (const m of res.mentions) {
      const doc = batch[m.docIndex]
      if (!doc) continue // model returned an out-of-range index
      const span = (m.span ?? '').trim()
      if (!span) continue
      mentions.push({ docId: doc.id, span, type: m.type })
    }
  })

  const summary = {
    docIds: docs.map((d) => d.id),
    batches: batches.length,
    failedBatches,
    mentions: mentions.length,
  }
  if (failedBatches === batches.length) {
    logger.error('[ENTITY_EXTRACT] extraction produced nothing, every batch failed', summary)
  } else if (failedBatches > 0) {
    logger.error('[ENTITY_EXTRACT] extraction incomplete, some batches failed', summary)
  } else {
    logger.info('[ENTITY_EXTRACT] mentions extracted', summary)
  }

  return mentions
}
