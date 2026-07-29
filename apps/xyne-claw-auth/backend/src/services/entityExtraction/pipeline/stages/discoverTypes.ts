import type { BootstrapConfig } from '../config.js'
import type { LlmClient, Logger } from '../ports.js'
import type { SourceDocument, RawTypeLabel, TypeCandidate } from '../types.js'
import {
  OPEN_TYPE_SCHEMA,
  OPEN_TYPE_SYSTEM,
  formatDocBatch,
  type OpenTypeResponse,
} from '../prompts.js'
import { clusterBySimilarity } from '../lib/similarity.js'
import { lexicalSimilarity } from '../lib/lexical.js'
import { chunkBySize, mapWithConcurrency } from '../lib/concurrency.js'
import { normalize } from '../lib/normalize.js'

/**
 * Stage 3 — discover candidate entity types.
 *
 * Runs open-ended extraction once over every thread document, and clusters the
 * free-form labels it returns. The output is a frequency report for a human to
 * curate into a frozen type set — it is deliberately NOT usable as-is.
 *
 * The label distribution is reliably Zipfian: a head of 10-20 labels covers
 * most mentions, then a long tail of one-offs. The head is the type set. The
 * tail is noise, and accommodating it is the main way type sets go bad.
 */
export async function discoverTypeCandidates(
  docs: SourceDocument[],
  llm: LlmClient,
  config: BootstrapConfig,
  logger?: Logger,
  /** Org/channel framing prepended to the system prompt (see buildContext). */
  context?: string,
): Promise<TypeCandidate[]> {
  const system = context ? `${context}\n\n${OPEN_TYPE_SYSTEM}` : OPEN_TYPE_SYSTEM
  const batches = chunkBySize(
    docs,
    (d) => Math.min(d.text.length, config.extract.maxDocChars),
    config.extract.maxBatchChars,
    config.extract.batchSize,
  )

  const responses = await mapWithConcurrency(
    batches,
    config.extract.concurrency,
    async (batch) => {
      try {
        return await llm.completeJson<OpenTypeResponse>({
          system,
          user: formatDocBatch(batch, config.extract.maxDocChars),
          schema: OPEN_TYPE_SCHEMA,
          schemaName: 'OpenTypeLabels',
          purpose: 'entity-bootstrap:typegen',
        })
      } catch (err) {
        logger?.warn('typegen batch failed', { error: String(err) })
        return { labels: [] } satisfies OpenTypeResponse
      }
    },
  )

  const occurrences: RawTypeLabel[] = []
  responses.forEach((res, batchIndex) => {
    const batch = batches[batchIndex]!
    for (const label of res.labels) {
      const doc = batch[label.docIndex]
      if (!doc) continue // model returned an out-of-range index
      const cleaned = normalize(label.label)
      if (!cleaned) continue
      occurrences.push({ label: cleaned, exampleSpan: label.span, docId: doc.id })
    }
  })

  logger?.info('typegen labels collected', { count: occurrences.length })
  if (occurrences.length === 0) return []

  // Collapse identical labels first — the vocabulary of type labels is small
  // even when the mention count is large. Each bucket's size is that label's
  // frequency, used later to rank candidates and drop the tail.
  const occurrencesByLabel = new Map<string, RawTypeLabel[]>()
  for (const occurrence of occurrences) {
    const bucket = occurrencesByLabel.get(occurrence.label)
    if (bucket) bucket.push(occurrence)
    else occurrencesByLabel.set(occurrence.label, [occurrence])
  }

  const uniqueLabels = [...occurrencesByLabel.keys()]

  // Lexical grouping only. Type labels are the one place where semantic
  // similarity would genuinely help ("gateway" vs "processor" share no
  // characters), so treat this grouping as a convenience for the reviewer —
  // gate 1 exists because a human does the real merging.
  const clusters = clusterBySimilarity(uniqueLabels, {
    keyOf: (label) => label,
    similarity: lexicalSimilarity,
    mergeThreshold: config.typegen.labelMergeThreshold,
  })

  const totalOccurrences = occurrences.length
  const countFor = (label: string) => occurrencesByLabel.get(label)?.length ?? 0
  const candidates: TypeCandidate[] = clusters
    .map((members) => {
      const sorted = [...members].sort((a, b) => countFor(b) - countFor(a))
      const count = members.reduce((sum, m) => sum + countFor(m), 0)
      const exampleSpans = members
        .flatMap((m) => occurrencesByLabel.get(m) ?? [])
        .slice(0, 8)
        .map((r) => r.exampleSpan)

      return {
        label: sorted[0]!,
        count,
        variants: sorted,
        exampleSpans,
      }
    })
    .filter((c) => c.count / totalOccurrences >= config.typegen.minLabelShare)
    .sort((a, b) => b.count - a.count)
    .slice(0, config.typegen.maxCandidates)

  logger?.info('typegen candidates', {
    candidates: candidates.length,
    droppedAsTail: clusters.length - candidates.length,
  })

  return candidates
}
