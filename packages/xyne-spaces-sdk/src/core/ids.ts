/**
 * Client-supplied identifiers and timestamps.
 *
 * Most Zero mutators expect the caller to supply the primary keys of the rows
 * they create (`messageId`, `conversationId`, `participantId`, …) plus an
 * explicit `timestamp`. That comes from Zero's optimistic-write model, where the
 * browser writes a row locally before the server sees it and therefore has to
 * pick the id itself.
 *
 * An SDK caller has no such requirement and should not have to know about it, so
 * every registry entry that needs these generates them in `mapArgs`. Where a
 * generated id is useful to the caller (the id of a message they just sent), the
 * corresponding resource method returns it.
 */

/**
 * Generate an id for a row this call is about to create.
 *
 * Uses the platform's `crypto.randomUUID` (Node 18+, and every modern browser)
 * so the SDK keeps its zero-dependency footprint.
 */
export function newId(): string {
  return globalThis.crypto.randomUUID();
}

/** Generate several ids at once, keyed by the caller's own keys. */
export function newIdMap(keys: readonly string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const key of keys) map[key] = newId();
  return map;
}

/** Current time in epoch milliseconds, the unit every mutator expects. */
export function now(): number {
  return Date.now();
}
