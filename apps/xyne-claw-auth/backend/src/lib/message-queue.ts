/**
 * Mid-run message queue for Spaces agent conversations.
 *
 * Problem this solves
 * -------------------
 * xyne-claw holds a per-conversation session lock (xyne-claw/src/session-lock.ts,
 * keyed by conversationId) for the duration of an agent run. If a user sends a
 * second message while the agent is still processing the first, the second
 * /internal/run hits `SessionLockedError` inside the runtime and is silently
 * dropped (run.ts logs + returns with no callback) — the user gets nothing.
 *
 * This module lets claw-auth (which owns Redis; the runtime pod does not) put a
 * per-conversation "busy" marker down at dispatch time and, when busy, FIFO-queue
 * the incoming message + reply "queued". When the active run finishes, the
 * /webhook/result handler drains the next queued message and re-dispatches it.
 *
 * Ownership boundary
 * ------------------
 * All state lives in Redis under `claw:*` keys, written ONLY by claw-auth. The
 * runtime pod is untouched — it keeps its own session lock as the last line of
 * defence (fail-open). This module is additive: with the feature flag off it is
 * inert and behaviour is exactly the legacy drop.
 *
 * Keys (all per conversation + agent):
 *   claw:busy:{conversationId}:{agentSlug}       string  — presence = a run is active. PX TTL.
 *   claw:mq:{conversationId}:{agentSlug}         list    — FIFO of QueuedMessage JSON blobs.
 *   claw:mq:seen:{conversationId}:{agentSlug}    set     — eventIds already enqueued (dedupe).
 */

import { redisService } from "../redis.js";
import { errMsg } from "./errors.js";
import { createLogger } from "../logger.js";

const log = createLogger("message-queue");


/** Max messages held per conversation. Beyond this we reject with a notice. */
export const QUEUE_CAP = Number(process.env["CLAW_MSG_QUEUE_CAP"] ?? "10");

/**
 * How long the busy marker survives without a completion callback. This is the
 * backstop that unwedges a conversation if a run crashes and its /webhook/result
 * never fires (so the drain never runs). Must comfortably exceed the longest
 * expected run. The runtime session lock TTL is 15 min; we use 20 to outlast it.
 */
export const BUSY_TTL_MS = Number(process.env["CLAW_MSG_QUEUE_BUSY_TTL_MS"] ?? String(20 * 60 * 1000));

/** Dedupe window for eventIds — comfortably longer than any queued wait. */
const SEEN_TTL_SEC = Number(process.env["CLAW_MSG_QUEUE_SEEN_TTL_SEC"] ?? String(60 * 60));

const BUSY_PREFIX = "claw:busy:";
const BUSY_META_PREFIX = "claw:busymeta:";
const QUEUE_PREFIX = "claw:mq:";
const SEEN_PREFIX = "claw:mq:seen:";

// Per-user scoping (Digital Twin ONLY). A twin thread shares one conversationId
// across every mentioned user, but each owner has a PRIVATE session/lock (see
// buildSandboxStoreKey) — so their mid-run queues must be private too, else
// user B's tag would serialize behind user A's run instead of running in
// parallel. Only `digital-twin` opts in; every other agent keeps the 2-part key
// (backward compatible — an omitted/undefined twinUserScopeId is a no-op). Mirrors
// convKey's twin scoping in webhook.ts.
const scoped = (base: string, agentSlug: string, twinUserScopeId?: string): string =>
  agentSlug === "digital-twin" && twinUserScopeId ? `${base}:${twinUserScopeId}` : base;

const busyKey = (conversationId: string, agentSlug: string, twinUserScopeId?: string): string =>
  scoped(`${BUSY_PREFIX}${conversationId}:${agentSlug}`, agentSlug, twinUserScopeId);
const busyMetaKey = (conversationId: string, agentSlug: string, twinUserScopeId?: string): string =>
  scoped(`${BUSY_META_PREFIX}${conversationId}:${agentSlug}`, agentSlug, twinUserScopeId);
const queueKey = (conversationId: string, agentSlug: string, twinUserScopeId?: string): string =>
  scoped(`${QUEUE_PREFIX}${conversationId}:${agentSlug}`, agentSlug, twinUserScopeId);
const seenKey = (conversationId: string, agentSlug: string, twinUserScopeId?: string): string =>
  scoped(`${SEEN_PREFIX}${conversationId}:${agentSlug}`, agentSlug, twinUserScopeId);

/**
 * A queued message carries exactly what /webhook/result needs to re-dispatch the
 * run to xyne-claw's /internal/run. It is intentionally minimal: the agent's
 * conversation context (thread memory) is preserved by the persisted claw
 * session, so we only replay the identity + task, not the full history/skills
 * payload. Parity with the full first-turn payload is a documented follow-up.
 */
export interface QueuedMessage {
  eventId: string;
  conversationId: string;
  channelId: string;
  channelName?: string;
  userId: string;
  senderName?: string;
  agentSlug: string;
  orgId?: string;
  workspaceId?: string;
  task: string;
  eventType: string;
  context?: string;
  resultForwardUrl?: string;
  resolveMentions?: boolean;
  /** Experiment context (/experiment). Carried so a lock-contention re-queue of
   *  an experiment epoch keeps its ledger tools on drain — xyne-claw injects
   *  experiment-ledger/-review/end-experiment ONLY when this reaches /run. */
  experiment?: {
    id: string;
    epoch: number;
    deadlineAt: string;
    focus?: string;
    mode?: "review";
  };
  /** /record-skill recording refs. Carried for the same reason as `experiment`:
   *  the redispatch rebuilds the /run payload field-by-field, and a dropped ref
   *  list re-binds NOTHING in Redis for the new sessionId — analyze-skill-recording
   *  then 404s ("No recordings are registered for this run") mid-conversation. */
  recordingRefs?: Array<{
    attachmentId: string;
    fileName: string;
    mimeType: string;
    fileSize: number;
  }>;
  /**
   * True when this run's user ChatMessage was ALREADY persisted on its original
   * dispatch — set by the lock-contention re-queue (a run that dispatched, hit
   * "session_locked", and is retried). The drain re-dispatch must then pass
   * __skipUserMessagePersist so the retry does NOT create a duplicate user row
   * (which would surface as a second root message → a branch). Absent for a
   * proactively-queued mention that never dispatched (it SHOULD persist on drain).
   */
  alreadyPersisted?: boolean;
  /**
   * Digital-Twin FIFO scope (= mentionedUserId / twin owner). Drives per-user
   * key selection in enqueueMessage; the matching drain must pass the same
   * value. Absent for conversation/automation messages (2-part key).
   */
  twinUserScopeId?: string;
  /**
   * Twin-only byte-identical replay blobs. Unlike conversation-mode messages —
   * which carry a thin task and re-derive context on drain — a twin tag is
   * enqueued BEFORE it ever dispatches, so the full /internal/run body and the
   * SessionContext (approval mode preserved) are stored here and replayed
   * verbatim by the twin drain. Present ONLY for twin FIFO entries. NOTE: the
   * sessionContext carries a decrypted appToken (parity with RunRecoveryState,
   * which already persists the same in Redis) — never log this blob.
   */
  dispatchPayload?: Record<string, unknown>;
  sessionContext?: Record<string, unknown>;
  /** Defaults to "conversation" on drain when absent (legacy-safe). */
  responseMode?: "conversation" | "approval";
  /** Why this message is waiting. Used to distinguish explicit `/queue <msg>`
   *  from a normal busy-thread enqueue and from a same-user interrupt follow-up. */
  queueReason?: "busy" | "explicit_queue" | "interrupt_followup";
  /** Requested handling mode for the active run when this message was queued. */
  interruptMode?: "queue_only" | "interrupt_with_reply";
  /** Suppress the normal "queued" notice when another control path already
   *  posts a better acknowledgement. */
  suppressQueuedNotice?: boolean;
  /** epoch ms when enqueued */
  ts: number;
}

export interface EnqueueResult {
  /** true when the message was appended to the queue */
  enqueued: boolean;
  /** 1-based position in the queue after enqueue (0 when not enqueued) */
  position: number;
  /** true when this eventId was already queued (idempotent no-op) */
  deduped: boolean;
  /** true when the queue was at capacity and the message was rejected */
  full: boolean;
}

/**
 * Try to become the active run for this conversation.
 * Returns a token on success (caller now owns the slot until releaseSlot /
 * TTL), or null when another run already holds it (caller should enqueue).
 *
 * Fail-open: if Redis is unreachable we return a token so dispatch proceeds and
 * the runtime session lock remains the safety net — we never block a first
 * message on a queue-infra outage.
 */
export async function tryAcquireSlot(conversationId: string, agentSlug: string, twinUserScopeId?: string, ownerUserId?: string): Promise<string | null> {
  if (!conversationId || !agentSlug) return `no-conv-${Date.now()}`;
  const token = `${process.env["POD_ID"] ?? "pod"}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    const redis = redisService.getConnection();
    const res = await redis.set(busyKey(conversationId, agentSlug, twinUserScopeId), token, "PX", BUSY_TTL_MS, "NX");
    if (res === "OK" && ownerUserId) {
      await redis.set(busyMetaKey(conversationId, agentSlug, twinUserScopeId), JSON.stringify({ userId: ownerUserId }), "PX", BUSY_TTL_MS).catch(() => {});
    }
    return res === "OK" ? token : null;
  } catch (err) {
    log.warn("tryAcquireSlot failed — failing open (dispatch proceeds, runtime lock guards)", {
      conversationId,
      agentSlug,
      error: errMsg(err),
    });
    return `failopen-${Date.now()}`;
  }
}

export interface SlotOwner {
  userId?: string;
  sessionId?: string;
}

export async function attachSlotSession(conversationId: string, agentSlug: string, sessionId: string, twinUserScopeId?: string): Promise<void> {
  if (!conversationId || !agentSlug || !sessionId) return;
  try {
    const redis = redisService.getConnection();
    const key = busyMetaKey(conversationId, agentSlug, twinUserScopeId);
    let owner: SlotOwner = {};
    try {
      const raw = await redis.get(key);
      if (raw) owner = JSON.parse(raw) as SlotOwner;
    } catch { owner = {}; }
    if (owner.sessionId === sessionId) {
      await redis.pexpire(key, BUSY_TTL_MS).catch(() => {});
      return;
    }
    await redis.set(key, JSON.stringify({ ...owner, sessionId }), "PX", BUSY_TTL_MS);
  } catch (err) {
    log.warn("attachSlotSession failed", { conversationId, agentSlug, error: errMsg(err) });
  }
}

export async function getSlotOwner(conversationId: string, agentSlug: string, twinUserScopeId?: string): Promise<SlotOwner | null> {
  if (!conversationId || !agentSlug) return null;
  try {
    const redis = redisService.getConnection();
    const raw = await redis.get(busyMetaKey(conversationId, agentSlug, twinUserScopeId));
    if (!raw) return null;
    return JSON.parse(raw) as SlotOwner;
  } catch (err) {
    log.warn("getSlotOwner failed — treating as no owner (fail-safe)", { conversationId, agentSlug, error: errMsg(err) });
    return null;
  }
}

/**
 * Non-destructive check: is a run currently active for this conversation?
 * Reads the busy marker WITHOUT acquiring it — used by paths that must REFUSE
 * (not queue) when a run is in flight, e.g. plan-approval (approving mid-run
 * dispatches a second run that races the active one at the runtime session lock
 * → one dies "session_locked" and re-fires as a duplicate turn / branch).
 *
 * Fail-open (returns false on Redis error): an infra outage must not block every
 * approval — the runtime session lock is still the last line of defence.
 */
export async function isSlotBusy(conversationId: string, agentSlug: string, twinUserScopeId?: string): Promise<boolean> {
  if (!conversationId || !agentSlug) return false;
  try {
    const redis = redisService.getConnection();
    const v = await redis.get(busyKey(conversationId, agentSlug, twinUserScopeId));
    return v != null;
  } catch (err) {
    log.warn("isSlotBusy failed — assuming not busy (fail-open)", {
      conversationId,
      agentSlug,
      error: errMsg(err),
    });
    return false;
  }
}

/**
 * Refresh the busy TTL for a still-running conversation. Called on every
 * progress callback so a live run keeps owning its slot — this is what closes
 * the slot-theft window: as long as the active run is emitting progress, its
 * marker never TTL-expires, so a second message can't `SET NX` its way in and
 * a late finalizer can't release someone else's slot.
 *
 * When `token` is given, only refreshes if the slot is still ours (compare-and-
 * pexpire) — a stale run can't keep a newer owner's slot alive. Progress
 * callbacks don't carry the token; a token-less refresh is safe there because
 * emitting progress already proves the caller is the live run.
 */
export async function refreshSlot(conversationId: string, agentSlug: string, token?: string, twinUserScopeId?: string): Promise<void> {
  if (!conversationId || !agentSlug) return;
  try {
    const redis = redisService.getConnection();
    if (token) {
      await redis.eval(
        `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE', KEYS[1], ARGV[2]) else return 0 end`,
        1,
        busyKey(conversationId, agentSlug, twinUserScopeId),
        token,
        String(BUSY_TTL_MS),
      );
    } else {
      await redis.pexpire(busyKey(conversationId, agentSlug, twinUserScopeId), BUSY_TTL_MS);
    }
    await redis.pexpire(busyMetaKey(conversationId, agentSlug, twinUserScopeId), BUSY_TTL_MS).catch(() => {});
  } catch (err) {
    log.warn("refreshSlot failed", { conversationId, agentSlug, error: errMsg(err) });
  }
}

/**
 * Release the active-run marker. Idempotent.
 *
 * When `token` is provided, this is an OWNER-CHECKED release (compare-and-del):
 * it only deletes the marker if it still holds our token, so a run whose slot
 * already TTL-expired and was re-acquired by a newer run can't delete the newer
 * run's slot. Callers that hold the token (same-request dispatch-failure paths)
 * MUST pass it. The cross-request `/webhook/result` finalizer has no token and
 * releases unconditionally — safe because refreshSlot keeps a live run's slot
 * owned, so the finalizer that fires is the current owner.
 */
export async function releaseSlot(conversationId: string, agentSlug: string, token?: string, twinUserScopeId?: string): Promise<void> {
  if (!conversationId || !agentSlug) return;
  try {
    const redis = redisService.getConnection();
    if (token) {
      await redis.eval(
        `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`,
        1,
        busyKey(conversationId, agentSlug, twinUserScopeId),
        token,
      );
    } else {
      await redis.del(busyKey(conversationId, agentSlug, twinUserScopeId));
    }
    await redis.del(busyMetaKey(conversationId, agentSlug, twinUserScopeId)).catch(() => {});
  } catch (err) {
    log.warn("releaseSlot failed", { conversationId, agentSlug, error: errMsg(err) });
  }
}

// Atomic enqueue: dedupe on eventId, enforce cap, RPUSH. Returns
// { enqueued, position, deduped, full } encoded as an array from Lua.
//   KEYS[1] = queue list   KEYS[2] = seen set
//   ARGV[1] = eventId      ARGV[2] = message JSON
//   ARGV[3] = cap          ARGV[4] = seen-set TTL seconds
const ENQUEUE_LUA = `
local isMember = redis.call('SISMEMBER', KEYS[2], ARGV[1])
if isMember == 1 then
  local depth = redis.call('LLEN', KEYS[1])
  return {0, depth, 1, 0}
end
local depth = redis.call('LLEN', KEYS[1])
if depth >= tonumber(ARGV[3]) then
  return {0, depth, 0, 1}
end
redis.call('RPUSH', KEYS[1], ARGV[2])
redis.call('SADD', KEYS[2], ARGV[1])
redis.call('EXPIRE', KEYS[2], tonumber(ARGV[4]))
local newDepth = redis.call('LLEN', KEYS[1])
return {1, newDepth, 0, 0}
`;

/**
 * Append a message to the conversation's FIFO queue.
 * Idempotent per eventId (a Spaces webhook retry won't double-enqueue).
 * Rejects when the queue is at QUEUE_CAP.
 */
export async function enqueueMessage(msg: QueuedMessage): Promise<EnqueueResult> {
  try {
    const redis = redisService.getConnection();
    const raw = (await redis.eval(
      ENQUEUE_LUA,
      2,
      queueKey(msg.conversationId, msg.agentSlug, msg.twinUserScopeId),
      seenKey(msg.conversationId, msg.agentSlug, msg.twinUserScopeId),
      msg.eventId,
      JSON.stringify(msg),
      String(QUEUE_CAP),
      String(SEEN_TTL_SEC),
    )) as [number, number, number, number];
    return {
      enqueued: raw[0] === 1,
      position: raw[1] ?? 0,
      deduped: raw[2] === 1,
      full: raw[3] === 1,
    };
  } catch (err) {
    log.warn("enqueueMessage failed", {
      conversationId: msg.conversationId,
      agentSlug: msg.agentSlug,
      error: errMsg(err),
    });
    // Fail-closed on enqueue: report not-enqueued so the caller can tell the
    // user we couldn't queue it (better than a false "queued" promise).
    return { enqueued: false, position: 0, deduped: false, full: false };
  }
}

/** Pop (FIFO) the next queued message, or null when the queue is empty. */
export async function dequeueMessage(conversationId: string, agentSlug: string, twinUserScopeId?: string): Promise<QueuedMessage | null> {
  if (!conversationId || !agentSlug) return null;
  try {
    const redis = redisService.getConnection();
    const raw = await redis.lpop(queueKey(conversationId, agentSlug, twinUserScopeId));
    if (!raw) return null;
    return JSON.parse(raw) as QueuedMessage;
  } catch (err) {
    log.warn("dequeueMessage failed", { conversationId, agentSlug, error: errMsg(err) });
    return null;
  }
}

/**
 * Drop the WAITING messages for a conversation (the FIFO list + dedupe set),
 * WITHOUT touching the busy marker — the active run keeps running and keeps its
 * slot. Used by `/queue clear`. `/stop` handles cancelling the active run
 * separately. Returns the number of queued messages that were discarded.
 */
export async function clearQueue(conversationId: string, agentSlug: string, twinUserScopeId?: string): Promise<number> {
  if (!conversationId || !agentSlug) return 0;
  try {
    const redis = redisService.getConnection();
    const discarded = await redis.llen(queueKey(conversationId, agentSlug, twinUserScopeId)).catch(() => 0);
    await redis.del(queueKey(conversationId, agentSlug, twinUserScopeId), seenKey(conversationId, agentSlug, twinUserScopeId));
    return discarded;
  } catch (err) {
    log.warn("clearQueue failed", { conversationId, agentSlug, error: errMsg(err) });
    return 0;
  }
}

/** Current queue depth for a conversation. */
export async function queueDepth(conversationId: string, agentSlug: string, twinUserScopeId?: string): Promise<number> {
  if (!conversationId || !agentSlug) return 0;
  try {
    const redis = redisService.getConnection();
    return await redis.llen(queueKey(conversationId, agentSlug, twinUserScopeId));
  } catch {
    return 0;
  }
}

/** Peek up to `n` queued messages without removing them (for /queue). */
export async function peekQueue(conversationId: string, agentSlug: string, twinUserScopeId?: string, n = QUEUE_CAP): Promise<QueuedMessage[]> {
  if (!conversationId || !agentSlug) return [];
  try {
    const redis = redisService.getConnection();
    const raws = await redis.lrange(queueKey(conversationId, agentSlug, twinUserScopeId), 0, n - 1);
    return raws
      .map((r) => {
        try {
          return JSON.parse(r) as QueuedMessage;
        } catch {
          return null;
        }
      })
      .filter((m): m is QueuedMessage => m !== null);
  } catch (err) {
    log.warn("peekQueue failed", { conversationId, agentSlug, error: errMsg(err) });
    return [];
  }
}
