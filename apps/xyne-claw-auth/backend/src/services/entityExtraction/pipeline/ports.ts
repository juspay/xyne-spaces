/**
 * Plug points. An org implements these four interfaces and the framework runs
 * unchanged — nothing below this line knows about any particular chat product,
 * model provider, or database.
 *
 * Note there is no embedding port. Entity resolution here is lexical
 * (see lib/lexical.ts), which removes both the infrastructure dependency and
 * the requirement that bootstrap and runtime share a vector space.
 */

export interface JsonCompletionRequest<T> {
  system: string
  user: string
  /**
   * JSON Schema the response must satisfy. Implementations should enforce it
   * at the tool-call/structured-output layer so a malformed response is
   * retried by the provider rather than parsed leniently here.
   */
  schema: Record<string, unknown>
  schemaName: string
  /** Hint only; implementations may ignore. */
  maxOutputTokens?: number
  /** Used purely for logging/attribution. */
  purpose?: string
  __resultType?: T
}

export interface LlmClient {
  completeJson<T>(req: JsonCompletionRequest<T>): Promise<T>
}

export interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void
  warn(msg: string, meta?: Record<string, unknown>): void
  error(msg: string, meta?: Record<string, unknown>): void
}
