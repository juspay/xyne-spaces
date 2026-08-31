// Live conversation bus — fans run events (tool calls, progress labels, done)
// out to v3 chat viewers in real time.
//
// Why this exists: Spaces-originated runs report to the backend over the
// callback model (/webhook/progress + /webhook/result). Those events are
// persisted to Postgres (durable) but never reach a browser that is *viewing*
// (not driving) the conversation. This bus is the LIVE tap on the same events:
//
//     /webhook/progress ─┬─▶ Postgres  (appendToolInvocation)   = durable
//                        └─▶ publishLiveEvent → Redis pub/sub    = ephemeral
//
// Redis pub/sub gives cross-replica fan-out (the SSE subscriber may sit on a
// different pod than the one receiving the webhook). It has NO replay, so a
// viewer joining mid-run gets a Postgres snapshot first (see the /live route)
// and then live deltas from here.
//
// Transport: ONE pattern-subscriber connection per pod (psubscribe
// "claw:live:*"), then an in-process EventEmitter fans each message out to the
// N local SSE handlers for that conversationId. This avoids a Redis connection
// per SSE client.

import { EventEmitter } from "node:events";
import { redisService } from "../redis.js";
import { createLogger } from "../logger.js";

const log = createLogger("live-bus");

const CHANNEL_PREFIX = "claw:live:";
const channelFor = (conversationId: string) => CHANNEL_PREFIX + conversationId;

export type LiveEvent =
  | { type: "label"; conversationId: string; agentSlug?: string | undefined; userId: string; toolLabel: string; ts: number }
  // `triggerSource` rides along so the SSE viewer can apply the SAME redaction
  // rule to a live tool call that it applies to a stored one — an agent-owned
  // run (heartbeat / reflex) has no private user data to protect, so its
  // results stay readable to admins instead of arriving pre-redacted.
  | { type: "invocation"; conversationId: string; agentSlug?: string | undefined; userId: string; toolInvocation: unknown; triggerSource?: string | undefined; ts: number }
  // Coalesced assistant text/reasoning fragments (one event per ~250ms batch) so
  // VIEWERS (reloaded tabs, Spaces) stream the answer live instead of seeing it
  // appear all-at-once on `done`. Either/both fields may be present per batch.
  | { type: "delta"; conversationId: string; agentSlug?: string | undefined; userId: string; textDelta?: string; reasoningDelta?: string; ts: number }
  | { type: "done"; conversationId: string; agentSlug?: string | undefined; userId: string; status: string; followUpsPending?: boolean; ts: number };

// In-process fan-out: each /live SSE handler registers a listener keyed by
// conversationId. setMaxListeners(0) = unbounded (one per concurrent viewer).
const local = new EventEmitter();
local.setMaxListeners(0);

let _subReady = false;
function ensureSubscriber(): void {
  if (_subReady) return;
  _subReady = true;
  // Subscribe mode needs a dedicated connection (can't issue commands on it).
  const sub = redisService.getConnection().duplicate();
  sub
    .psubscribe(`${CHANNEL_PREFIX}*`)
    .then(() => log.info(`[live-bus] subscribed to ${CHANNEL_PREFIX}* (live fan-out on)`))
    .catch((err) => {
      _subReady = false; // allow a later retry on the next publish/subscribe
      log.error("[live-bus] psubscribe failed (live fan-out off):", err instanceof Error ? err.message : err);
    });
  sub.on("pmessage", (_pattern: string, channel: string, raw: string) => {
    const conversationId = channel.slice(CHANNEL_PREFIX.length);
    let evt: LiveEvent;
    try {
      evt = JSON.parse(raw) as LiveEvent;
    } catch {
      return;
    }
    local.emit(conversationId, evt);
  });
  sub.on("error", (err: Error) => log.error("[live-bus] subscriber error:", err.message));
}

/** Publish a live event for a conversation. Fire-and-forget; best-effort. */
export function publishLiveEvent(conversationId: string, event: LiveEvent): void {
  if (!conversationId) return;
  redisService
    .getConnection()
    .publish(channelFor(conversationId), JSON.stringify(event))
    .then((n) => log.info(`[live-bus] publish ${event.type} conv=${conversationId} → ${n} subscriber(s)`))
    .catch((err) => log.warn("[live-bus] publish failed:", err instanceof Error ? err.message : err));
}

/**
 * Subscribe to live events for a conversation. Returns an unsubscribe fn.
 * The handler runs for every event published to this conversationId across all
 * pods. Idempotent re: the underlying Redis subscriber (one per pod).
 */
export function subscribeLive(conversationId: string, handler: (evt: LiveEvent) => void): () => void {
  ensureSubscriber();
  local.on(conversationId, handler);
  return () => local.off(conversationId, handler);
}
