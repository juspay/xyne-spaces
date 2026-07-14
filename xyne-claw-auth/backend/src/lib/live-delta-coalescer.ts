// ── Live delta coalescer ─────────────────────────────────────────────────────
// Assistant text/reasoning arrive as high-frequency deltas during a run. We batch
// them per session and (a) publish one coalesced `delta` event to the live bus
// every ~250ms so VIEWERS (reloaded tabs, Spaces) stream the answer instead of
// seeing it appear all-at-once on `done`, and (b) persist the ACCUMULATED partial
// content (~1s debounce) onto the placeholder assistant row so a mid-run reload
// shows the answer-so-far. Keyed by sessionId (a convId can host a host-agent run
// + a digital-twin run with the same convId), and the event carries agentSlug so
// /live's scope filter keeps them separate.
//
// Shared by BOTH run entrypoints — agent-chat.ts (v3 chat) and run-stream.ts
// (Spaces AI / Ask AI v2) — so a viewer's GET /agent-chat/:slug/chat/:convId/live
// works for either driver over the same live-conversation-bus.
import { publishLiveEvent } from "./live-conversation-bus.js";
import { chatMessageRepository, agentRunRepository } from "../repositories/index.js";

interface DeltaBuf {
  convId: string;
  slug: string;
  assistantMessageId: string | undefined;
  userId: string | undefined; // resolved once via liveUserIdForSession, then cached
  /** Single in-flight resolution promise — every pre-resolution live flush chains
   *  on THIS one promise so delta publishes stay in order (a per-flush lookup
   *  could resolve out of order and shuffle the viewer's text). */
  userIdPromise: Promise<string | undefined> | null;
  batchText: string; // accumulated since the last live flush
  batchReasoning: string;
  accText: string; // run total (absolute → idempotent persist)
  accReasoning: string;
  liveTimer: ReturnType<typeof setTimeout> | null;
  persistTimer: ReturnType<typeof setTimeout> | null;
  /** Self-expiry, re-armed on every delta: drops the entry on pods that saw this
   *  run's /progress but not its terminal /callback (the common multi-replica
   *  case), so orphaned coalescers can't leak. */
  idleTimer: ReturnType<typeof setTimeout> | null;
}
const deltaCoalescers = new Map<string, DeltaBuf>();
const DELTA_LIVE_MS = 250;
const DELTA_PERSIST_MS = 1000;
const DELTA_IDLE_MS = 60_000;

// Resolve a run's triggering userId (cached) so a caller that doesn't carry it
// (the legacy /progress handlers) can still scope live events to /live viewers.
const _liveSessionUserCache = new Map<string, string>();
export async function liveUserIdForSession(sessionId: string): Promise<string | undefined> {
  const hit = _liveSessionUserCache.get(sessionId);
  if (hit) return hit;
  try {
    const run = await agentRunRepository.findBySessionId(sessionId);
    if (run?.userId) {
      if (_liveSessionUserCache.size > 5000) _liveSessionUserCache.clear(); // crude bound
      _liveSessionUserCache.set(sessionId, run.userId);
      return run.userId;
    }
  } catch {
    /* best-effort */
  }
  return undefined;
}

function flushDeltaLive(sessionId: string): void {
  const buf = deltaCoalescers.get(sessionId);
  if (!buf) return;
  buf.liveTimer = null;
  if (!buf.batchText && !buf.batchReasoning) return;
  const textDelta = buf.batchText || undefined;
  const reasoningDelta = buf.batchReasoning || undefined;
  buf.batchText = "";
  buf.batchReasoning = "";
  const publish = (uid: string) =>
    publishLiveEvent(buf.convId, {
      type: "delta",
      conversationId: buf.convId,
      agentSlug: buf.slug,
      userId: uid,
      ...(textDelta ? { textDelta } : {}),
      ...(reasoningDelta ? { reasoningDelta } : {}),
      ts: Date.now(),
    });
  if (buf.userId) { publish(buf.userId); return; }
  // Chain on the ONE resolution promise so ordering is preserved: same-promise
  // .then() callbacks run in registration (batch) order.
  void (buf.userIdPromise ?? Promise.resolve(undefined)).then((uid) => { if (uid) publish(uid); }).catch(() => {});
}

function flushDeltaPersist(sessionId: string): void {
  const buf = deltaCoalescers.get(sessionId);
  if (!buf) return;
  buf.persistTimer = null;
  if (!buf.assistantMessageId) return;
  // Conditional (status='running') write — the final /callback flips status off
  // "running", so a late/cross-pod partial write matches 0 rows and can never
  // clobber the final content. Accumulated (absolute) → idempotent.
  chatMessageRepository
    .updatePartialContent(buf.assistantMessageId, { content: buf.accText, ...(buf.accReasoning ? { reasoning: buf.accReasoning } : {}) })
    .catch(() => {});
}

export function pushDelta(
  sessionId: string,
  convId: string,
  slug: string,
  assistantMessageId: string | undefined,
  textDelta: string | undefined,
  reasoningDelta: string | undefined,
  knownUserId?: string,
): void {
  let buf = deltaCoalescers.get(sessionId);
  if (!buf) {
    buf = {
      convId, slug, assistantMessageId, userId: undefined, userIdPromise: null,
      batchText: "", batchReasoning: "", accText: "", accReasoning: "",
      liveTimer: null, persistTimer: null, idleTimer: null,
    };
    // Resolve the userId once. Prefer the caller's already-resolved id (the SSE
    // paths) — same value the invocation/label publishes use, so the /live
    // allow() filter treats delta events identically — else look it up.
    if (knownUserId) { buf.userId = knownUserId; buf.userIdPromise = Promise.resolve(knownUserId); }
    else buf.userIdPromise = liveUserIdForSession(sessionId).then((uid) => { if (buf) buf.userId = uid; return uid; }).catch(() => undefined);
    deltaCoalescers.set(sessionId, buf);
  }
  if (assistantMessageId && !buf.assistantMessageId) buf.assistantMessageId = assistantMessageId;
  if (textDelta) { buf.batchText += textDelta; buf.accText += textDelta; }
  if (reasoningDelta) { buf.batchReasoning += reasoningDelta; buf.accReasoning += reasoningDelta; }
  if (!buf.liveTimer) buf.liveTimer = setTimeout(() => flushDeltaLive(sessionId), DELTA_LIVE_MS);
  if (!buf.persistTimer) buf.persistTimer = setTimeout(() => flushDeltaPersist(sessionId), DELTA_PERSIST_MS);
  if (buf.idleTimer) clearTimeout(buf.idleTimer);
  buf.idleTimer = setTimeout(() => endDeltaCoalescer(sessionId), DELTA_IDLE_MS);
}

/** Stop + drop a session's coalescer (terminal callback, or idle self-expiry).
 *  A late partial write after this is a no-op — flushDeltaPersist is a
 *  status-guarded conditional update the completed row no longer matches. */
export function endDeltaCoalescer(sessionId: string): void {
  const buf = deltaCoalescers.get(sessionId);
  if (!buf) return;
  if (buf.liveTimer) clearTimeout(buf.liveTimer);
  if (buf.persistTimer) clearTimeout(buf.persistTimer);
  if (buf.idleTimer) clearTimeout(buf.idleTimer);
  deltaCoalescers.delete(sessionId);
}
