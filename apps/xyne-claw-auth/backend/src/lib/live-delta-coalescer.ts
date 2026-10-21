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
//
// It also folds the run into ordered parts (thinking / text / tool calls, see
// @xyne/shared assistantParts) so a mid-run reload and live viewers get the
// turn as a timeline, not one text blob and one reasoning blob.
import { applyPartDelta, applyToolPart, type AssistantPart } from "./chat-run-record.js";
import { publishLiveEvent, type LiveDeltaChunk } from "./live-conversation-bus.js";
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
  /** The same batch as ordered per-part chunks, for viewers that build the timeline. */
  batchChunks: LiveDeltaChunk[];
  accText: string; // run total (absolute → idempotent persist)
  /** The run so far as ordered parts (absolute → idempotent persist). */
  parts: AssistantPart[];
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
  const chunks = buf.batchChunks;
  buf.batchText = "";
  buf.batchReasoning = "";
  buf.batchChunks = [];
  const publish = (uid: string) =>
    publishLiveEvent(buf.convId, {
      type: "delta",
      conversationId: buf.convId,
      agentSlug: buf.slug,
      userId: uid,
      ...(textDelta ? { textDelta } : {}),
      ...(reasoningDelta ? { reasoningDelta } : {}),
      ...(chunks.length > 0 ? { chunks } : {}),
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
  // clobber the final content. Accumulated (absolute) → idempotent. Thinking
  // lives in the parts (readers fill `reasoning` from them).
  chatMessageRepository
    .updatePartialContent(buf.assistantMessageId, { content: buf.accText, ...(buf.parts.length > 0 ? { parts: buf.parts } : {}) })
    .catch(() => {});
}

function coalescerFor(
  sessionId: string,
  convId: string,
  slug: string,
  assistantMessageId: string | undefined,
  knownUserId: string | undefined,
): DeltaBuf {
  let buf = deltaCoalescers.get(sessionId);
  if (!buf) {
    buf = {
      convId, slug, assistantMessageId, userId: undefined, userIdPromise: null,
      batchText: "", batchReasoning: "", batchChunks: [], accText: "", parts: [],
      liveTimer: null, persistTimer: null, idleTimer: null,
    };
    // Resolve the userId once. Prefer the caller's already-resolved id (the SSE
    // paths) — same value the invocation/label publishes use, so the /live
    // allow() filter treats delta events identically — else look it up.
    if (knownUserId) { buf.userId = knownUserId; buf.userIdPromise = Promise.resolve(knownUserId); }
    else {
      const created = buf;
      buf.userIdPromise = liveUserIdForSession(sessionId).then((uid) => { created.userId = uid; return uid; }).catch(() => undefined);
    }
    deltaCoalescers.set(sessionId, buf);
  }
  if (assistantMessageId && !buf.assistantMessageId) buf.assistantMessageId = assistantMessageId;
  return buf;
}

function armTimers(sessionId: string, buf: DeltaBuf, live: boolean): void {
  if (live && !buf.liveTimer) buf.liveTimer = setTimeout(() => flushDeltaLive(sessionId), DELTA_LIVE_MS);
  if (!buf.persistTimer) buf.persistTimer = setTimeout(() => flushDeltaPersist(sessionId), DELTA_PERSIST_MS);
  if (buf.idleTimer) clearTimeout(buf.idleTimer);
  buf.idleTimer = setTimeout(() => endDeltaCoalescer(sessionId), DELTA_IDLE_MS);
}

export function pushDelta(
  sessionId: string,
  convId: string,
  slug: string,
  assistantMessageId: string | undefined,
  textDelta: string | undefined,
  reasoningDelta: string | undefined,
  knownUserId?: string,
  /** The block the delta belongs to (claw's `<llm call>:<content index>`). */
  partId?: string,
): void {
  const buf = coalescerFor(sessionId, convId, slug, assistantMessageId, knownUserId);
  const at = new Date().toISOString();
  if (textDelta) {
    buf.batchText += textDelta;
    buf.accText += textDelta;
    buf.batchChunks.push({ type: "text", delta: textDelta, ...(partId ? { partId } : {}) });
    buf.parts = applyPartDelta(buf.parts, { type: "text", partId, delta: textDelta, at });
  }
  if (reasoningDelta) {
    buf.batchReasoning += reasoningDelta;
    buf.batchChunks.push({ type: "reasoning", delta: reasoningDelta, ...(partId ? { partId } : {}) });
    buf.parts = applyPartDelta(buf.parts, { type: "reasoning", partId, delta: reasoningDelta, at });
  }
  armTimers(sessionId, buf, true);
}

/** Record a tool call's place in the run's parts. The invocation itself is
 *  published and persisted by the caller, as before. */
export function pushToolPart(
  sessionId: string,
  convId: string,
  slug: string,
  assistantMessageId: string | undefined,
  invocation: { toolCallId?: unknown; parentToolCallId?: unknown },
  knownUserId?: string,
): void {
  const toolCallId = typeof invocation.toolCallId === "string" ? invocation.toolCallId : undefined;
  if (!toolCallId) return;
  const buf = coalescerFor(sessionId, convId, slug, assistantMessageId, knownUserId);
  const parentToolCallId = typeof invocation.parentToolCallId === "string" ? invocation.parentToolCallId : null;
  const next = applyToolPart(buf.parts, { toolCallId, parentToolCallId }, new Date().toISOString());
  if (next === buf.parts) return;
  // Text streamed before this call belongs before it on the viewer's timeline.
  if (buf.liveTimer) { clearTimeout(buf.liveTimer); flushDeltaLive(sessionId); }
  buf.parts = next;
  armTimers(sessionId, buf, false);
}

/** Stop + drop a session's coalescer (terminal callback, or idle self-expiry).
 *  A late partial write after this is a no-op — flushDeltaPersist is a
 *  status-guarded conditional update the completed row no longer matches. */
export function endDeltaCoalescer(sessionId: string): void {
  const buf = deltaCoalescers.get(sessionId);
  if (!buf) return;
  // Viewers get the last batch before `done` rather than losing it.
  if (buf.liveTimer) { clearTimeout(buf.liveTimer); flushDeltaLive(sessionId); }
  if (buf.persistTimer) clearTimeout(buf.persistTimer);
  if (buf.idleTimer) clearTimeout(buf.idleTimer);
  deltaCoalescers.delete(sessionId);
}
