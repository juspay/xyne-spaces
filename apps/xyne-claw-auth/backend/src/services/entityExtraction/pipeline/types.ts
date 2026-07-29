/**
 * Core domain types for the entity bootstrap framework.
 *
 * Two concepts that must never be conflated:
 *  - A *mention* is one occurrence of a reference, anchored to a document.
 *  - An *entity* is a registry row with a stable opaque id.
 *
 * The extractor produces mentions. It never produces entities. Identity is
 * decided by clustering (bootstrap) or by the resolver (steady state).
 */

// ---------------------------------------------------------------------------
// Source-side (what an org plugs in)
// ---------------------------------------------------------------------------

export interface SourceMessage {
  id: string
  channelId: string
  text: string
  authorId?: string
  /** Epoch millis. */
  ts: number
  /**
   * Groups messages into a conversation. When present and
   * `fetchMessages.groupByThread` is on, the whole thread becomes one document.
   *
   * This matters for coreference: "it's still failing" in the tenth message
   * refers to something named in the first. Extracting per-message either
   * misses that mention or invents one.
   */
  threadId?: string
}

// ---------------------------------------------------------------------------
// Stage 1 — fetchMessages
// ---------------------------------------------------------------------------

/**
 * Channel metadata is treated as a separate, higher-confidence signal than
 * message bodies: a channel named `#hdfc-integration` was deliberately named by
 * a human, so it carries no extraction noise.
 */
export type DocKind = 'message' | 'thread' | 'ticket' | 'channel_meta'

export interface SourceDocument {
  id: string
  kind: DocKind
  channelId: string
  channelName: string
  text: string
  ts: number
  /** Multiplier applied to mention counts sourced from this doc. */
  weight: number
  /** Messages folded into this doc. 1 for a single message. */
  messageCount?: number
}

// ---------------------------------------------------------------------------
// Stage 3 — type set
// ---------------------------------------------------------------------------

/** A free-form type label emitted by the open-extraction pass. */
export interface RawTypeLabel {
  label: string
  exampleSpan: string
  docId: string
}

/** A cluster of near-synonymous free-form labels, for human curation. */
export interface TypeCandidate {
  /** Highest-frequency member of the cluster. */
  label: string
  count: number
  variants: string[]
  exampleSpans: string[]
}

export interface EntityTypeDef {
  /** Enum value written to the registry, e.g. "MERCHANT". */
  name: string
  /** Short id prefix for readability, e.g. "mer". Not load-bearing. */
  prefix: string
  /** One-line decision rule. Goes into the extraction prompt verbatim. */
  rule: string
  examples?: string[]
}

/** The curated set of entity types a run proposes for approval. */
export interface TypeSet {
  version: number
  types: EntityTypeDef[]
}
