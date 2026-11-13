/**
 * The shapes that cross the inbound boundary: a request as the engine received
 * it, what a trigger turns it into, and what goes back to the sender.
 *
 * Kept apart from the trigger and policy modules so neither has to import the
 * other to name these.
 */

/** A request to a webhook endpoint as the engine received it, before the body is parsed. */
export interface InboundHttpRequest {
  readonly method: string;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly query: Readonly<Record<string, string | string[] | undefined>>;
  /** The exact bytes received. What a signature covers. */
  readonly rawBody: Uint8Array;
}

/** The same request once the trigger verified it and the engine parsed the body. */
export interface RawInboundRequest extends InboundHttpRequest {
  /** Parsed from {@link rawBody}: JSON, form-encoded fields, or text. */
  readonly body: unknown;
}

/** The HTTP response sent back to the caller of a webhook. */
export interface InboundReply {
  readonly status: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: unknown;
}

/**
 * One event offered to a workflow's trigger binding, whatever brought it in: a
 * domain dispatch, a webhook delivery, a cron tick, or a manual run.
 *
 * What the trigger's `accepts`, `hydrate` and `hydrationKey` hooks see — the
 * event as the source reported it, before any enrichment.
 */
export interface TriggerEvent<
  TPayload extends Record<string, unknown> = Record<string, unknown>,
> {
  /** Stored as `context.trigger.type`. Usually the trigger's own type. */
  readonly type: string;
  /**
   * Spread into `context.trigger` alongside `type`.
   *
   * Typed by the trigger that receives it: a trigger declares the shape it is
   * sent, so `accepts` and `hydrate` read real fields rather than indexing a bag
   * of unknowns. Defaults to the open shape for code that handles any trigger.
   */
  readonly payload: Readonly<TPayload>;
  /**
   * When the source says it happened, ISO 8601 — the source's clock, not the
   * engine's, and absent when the source reports none.
   */
  readonly occurredAt?: string;
}

/** One event a trigger extracted from a request. Becomes `context.trigger`. */
export type InboundEvent<TPayload extends Record<string, unknown> = Record<string, unknown>> =
  TriggerEvent<TPayload>;

/**
 * What a trigger made of a request.
 *
 * Zero events with a `reply` answers a request that must not start a run, such
 * as a URL-verification challenge. Zero events without one is a plain
 * acknowledgement.
 */
export interface Translation<
  TPayload extends Record<string, unknown> = Record<string, unknown>,
> {
  readonly events: readonly InboundEvent<TPayload>[];
  readonly reply?: InboundReply;
}

/** What webhook ingest produced: the reply to send, and the runs it started. */
export interface WebhookIngestResult {
  readonly reply: InboundReply;
  readonly executionIds: readonly string[];
}
