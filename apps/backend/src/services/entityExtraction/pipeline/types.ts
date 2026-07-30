/**
 * Core domain types for mention extraction.
 *
 * Two concepts that must never be conflated:
 *  - A *mention* is one occurrence of a reference, anchored to a document.
 *  - An *entity* is a registry row with a stable opaque id.
 *
 * The extractor produces mentions. It never produces entities — identity is
 * decided by the resolver (see entityResolver.ts).
 */

export interface SourceMessage {
  id: string
  channelId: string
  text: string
  authorId?: string
  /** Epoch millis. */
  ts: number
  /**
   * Groups messages into a conversation; the whole thread becomes one document.
   *
   * This matters for coreference: "it's still failing" in the tenth message
   * refers to something named in the first. Extracting per-message either
   * misses that mention or invents one.
   */
  threadId?: string
}

/**
 * Channel metadata is treated as a separate, higher-confidence signal than
 * message bodies: a channel named `#hdfc-integration` was deliberately named by
 * a human, so it carries no extraction noise.
 */
export type DocKind = 'thread' | 'ticket' | 'channel_meta'

export interface SourceDocument {
  id: string
  kind: DocKind
  channelId: string
  channelName: string
  text: string
  /** Messages folded into this doc. 1 for a single message. */
  messageCount?: number
  /**
   * Vespa message docIds folded into this document, so resolved entities can be
   * written back onto the underlying message docs. Empty for channel_meta.
   */
  messageIds?: string[]
  /**
   * The ticket doc id, when this document came from a ticket thread — so the
   * write-back can also tag the ticket doc (ticket.sd has the entity fields).
   */
  ticketId?: string
}

// ---------------------------------------------------------------------------
// Mention extraction
// ---------------------------------------------------------------------------

/** An approved type, as the extractor needs it (name + rule + few-shot). */
export interface ExtractionType {
  name: string
  rule: string
  examples?: string[]
}

/**
 * One occurrence of a typed reference, anchored to a document. A mention is NOT
 * an entity — identity is decided later by the resolver. `span` is copied
 * verbatim from the text; `type` is one of the approved type names.
 */
export interface Mention {
  docId: string
  span: string
  type: string
}
