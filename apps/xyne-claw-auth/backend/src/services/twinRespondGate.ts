/**
 * Digital Twin respond/ignore gate — claw-auth side (Memory v2, gap-2).
 *
 * Before the webhook dispatches a twin run for an @mention, this consults the
 * user's LEARNED patterns to decide whether the Twin should reply or stay
 * silent. It gathers (a) recalled response/ignore memories and (b) durable
 * behavioural stats (TwinBehaviorSignal), then asks claw's LLM gate. FAIL-CLOSED:
 * any error / no data → STAY SILENT (the twin only posts confident replies). A
 * wrong silence is recoverable — the daily pipeline reconciles it into a
 * should-have-replied signal if the user answers themselves; a wrong post AS the
 * user is not. Only used when the user opted into the "learned" respond policy;
 * "always" skips this entirely.
 */

import { bankIdForAgent, getMemoryProvider } from "xyne-claw-shared";
import { errMsg } from "../lib/errors.js";
import { CONFIG } from "../config.js";
import { prisma } from "../db.js";
import { interact } from "../mcp/servers/xyne-spaces-client.js";
import { resolveAuthForUser } from "./userMemoryFetcher.js";
import { recordGateEvent } from "./digitalTwinPipelineEvents.js";
import { createLogger, createTraceId } from "../logger.js";

const logger = createLogger("twin-respond-gate-client", createTraceId());
const memory = getMemoryProvider();
const TWIN_BANK_ID = bankIdForAgent("digital-twin");
// Budget for the S2S call to claw's /should-respond (which runs the gate LLM).
// MUST exceed claw's own TWIN_RESPOND_GATE_TIMEOUT_MS (default 4min) so claw
// returns a clean, traced fail-closed decision instead of this client aborting
// the HTTP call ("operation was aborted due to timeout" — which loses the trace).
// The shared LiteLLM gateway decodes slowly (~10-14 tok/s), so the gate LLM call
// legitimately takes ~6-20s and, under load, longer — this is the slow-tail
// ceiling, not the common case (which returns in seconds). Only wraps the
// /should-respond fetch, not the memory/stats recalls that precede it.
const GATE_TIMEOUT_MS = Number(process.env["TWIN_RESPOND_GATE_CLIENT_TIMEOUT_MS"] ?? 270_000);

export interface TwinRespondDecision {
  respond: boolean;
  confidence: number;
  reason: string;
  source: string;
}

/** Fail-CLOSED default: when the gate can't reach a decision (missing S2S key,
 *  recall/LLM error, HTTP failure, unusable response) DON'T post. respond:false
 *  so the webhook stays silent; the silence is recorded as pending and reconciled
 *  later if the user replies themselves. */
export const FAIL_CLOSED: TwinRespondDecision = { respond: false, confidence: 0, reason: "gate unavailable — stay silent (fail-closed)", source: "fail-closed" };

async function ratio(where: Record<string, unknown>): Promise<{ r: number; ig: number } | null> {
  const g = await prisma.twinBehaviorSignal.groupBy({ by: ["outcome"], where, _count: { _all: true } });
  const r = g.find((x) => x.outcome === "responded")?._count._all ?? 0;
  const ig = g.find((x) => x.outcome === "ignored")?._count._all ?? 0;
  return r + ig > 0 ? { r, ig } : null;
}

interface StatsArgs {
  channelType?: string;
  channelId?: string;
  channelName?: string;
  senderId?: string;
  senderName?: string;
}

/** Human-readable stats: overall + this channel-type + THIS channel + THIS
 *  sender — the per-sender / per-channel breakdown is a much stronger signal
 *  than the overall rate. */
async function fetchStats(userId: string, a: StatsArgs): Promise<string> {
  try {
    const overall = await ratio({ userId });
    if (!overall) return "";
    const parts = [`overall responded ${overall.r}/${overall.r + overall.ig}`];
    if (a.channelType) {
      const c = await ratio({ userId, channelType: a.channelType });
      if (c) parts.push(`in ${a.channelType} responded ${c.r}/${c.r + c.ig}`);
    }
    if (a.channelId) {
      const c = await ratio({ userId, channelId: a.channelId });
      if (c) parts.push(`in ${a.channelName ? `#${a.channelName}` : "this channel"} responded ${c.r}/${c.r + c.ig}`);
    }
    if (a.senderId) {
      const c = await ratio({ userId, actorId: a.senderId });
      if (c) parts.push(`to ${a.senderName ? `@${a.senderName}` : "this person"} responded ${c.r}/${c.r + c.ig}`);
    }
    return parts.join("; ");
  } catch {
    return "";
  }
}

/** Thread-participation signal: is the user already active in this conversation,
 *  i.e. has authored at least one message in it? Uses MESSAGE AUTHORSHIP — the
 *  ground truth. NOT conversationParticipant.lastReplyAt, which is
 *  conversation-level (populated for every participant once the thread has any
 *  activity — including merely being @-mentioned), so it would report "active"
 *  for threads the user never posted in and make the twin always reply. */
async function isThreadParticipant(userId: string, conversationId: string): Promise<boolean> {
  try {
    const auth = await resolveAuthForUser(userId);
    if (!auth) return false;
    const data = await interact(
      {
        model: "message",
        operation: "findMany",
        where: { senderId: { equals: userId }, conversationId: { equals: conversationId } },
        take: 1,
      },
      auth,
    );
    return Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
}

/** Feedback corrections: cases where the gate WRONGLY stayed silent (the twin
 *  didn't reply but the user did). Fed to the gate as high-priority guidance. */
async function fetchCorrections(userId: string): Promise<string[]> {
  try {
    const rows = await prisma.twinBehaviorSignal.findMany({
      where: { userId, shouldHaveResponded: true },
      orderBy: { occurredAt: "desc" },
      take: 4,
      select: { channelType: true, triggerPreview: true },
    });
    return rows
      .filter((r) => r.triggerPreview)
      .map(
        (r) =>
          `CORRECTION — the twin previously stayed SILENT but the user DID respond themselves (${r.channelType ?? "?"}): "${r.triggerPreview!.slice(0, 120)}". Lean toward REPLYING to similar messages.`,
      );
  } catch {
    return [];
  }
}

/**
 * Record that the twin STAYED SILENT for this mention (gate said ignore). Keyed
 * on the trigger messageId so the daily assembler can later reconcile it: if the
 * user replied themselves, it flags shouldHaveResponded (a wrong silence) which
 * feeds future decisions. outcome starts "pending" until the assembler resolves it.
 */
export async function recordTwinSilence(
  userId: string,
  args: {
    sourceMessageId?: string;
    channelId?: string;
    channelName?: string;
    channelType?: string;
    senderId?: string;
    occurredAt?: string | number;
    triggerPreview?: string;
  },
  decision: TwinRespondDecision,
): Promise<void> {
  if (!args.sourceMessageId) return;
  try {
    const occurredAt = args.occurredAt ? new Date(args.occurredAt) : new Date();
    const gate = {
      gateDecision: "ignore",
      gateConfidence: decision.confidence,
      gateReason: decision.reason.slice(0, 300),
      gateAt: new Date(),
    };
    await prisma.twinBehaviorSignal.upsert({
      where: { userId_sourceMessageId: { userId, sourceMessageId: args.sourceMessageId } },
      create: {
        userId,
        eventType: args.channelType === "dm" || args.channelType === "group_dm" ? "dm" : "mention",
        outcome: "pending",
        channelId: args.channelId ?? null,
        channelName: args.channelName ?? null,
        channelType: args.channelType ?? null,
        actorId: args.senderId ?? null,
        sourceMessageId: args.sourceMessageId,
        triggerPreview: args.triggerPreview?.slice(0, 240) ?? null,
        occurredAt,
        ...gate,
      },
      update: gate,
    });
  } catch (err) {
    logger.warn("[twin-respond-gate] recordTwinSilence failed", {
      userId,
      err: errMsg(err),
    });
  }
}

/** The user's recalled response/ignore facts + a few recent ignored examples. */
async function fetchPatterns(userId: string): Promise<string[]> {
  const patterns: string[] = [];
  const seen = new Set<string>();
  const add = (text: string) => {
    if (text && !seen.has(text)) { seen.add(text); patterns.push(text); }
  };

  // 1. SHARP: memories the curator explicitly labelled as respond/ignore
  //    behaviour (subsystem:triage). Re-filtered in JS by BOTH tags because
  //    Hindsight's tag filter over-matches (see memory-search.ts).
  try {
    const hits = await memory.recall(
      TWIN_BANK_ID,
      "when the user responds versus ignores messages and @mentions — who and what they engage with vs stay silent on",
      { budget: "low", tags: [`user:${userId}`, "subsystem:triage"], maxTokens: 1500 },
    );
    for (const m of hits) {
      const t = m.tags ?? [];
      if (t.includes(`user:${userId}`) && t.includes("subsystem:triage")) add(m.text);
      if (patterns.length >= 6) break;
    }
  } catch {
    /* best-effort */
  }
  // 2. FALLBACK: broad semantic recall — covers memories written before the
  //    triage facet existed / not yet re-backfilled.
  if (patterns.length < 6) {
    try {
      const hits = await memory.recall(
        TWIN_BANK_ID,
        "how the user decides when to respond to or ignore messages and @mentions; their response patterns and what they ignore",
        { budget: "low", tags: [`user:${userId}`], maxTokens: 1500 },
      );
      for (const m of hits) {
        if ((m.tags ?? []).includes(`user:${userId}`)) add(m.text);
        if (patterns.length >= 6) break;
      }
    } catch {
      /* recall failed — continue with stats only */
    }
  }
  try {
    const ignored = await prisma.twinBehaviorSignal.findMany({
      where: { userId, outcome: "ignored", triggerPreview: { not: null } },
      orderBy: { occurredAt: "desc" },
      take: 4,
      select: { channelType: true, triggerPreview: true },
    });
    for (const s of ignored) {
      if (s.triggerPreview) add(`Previously IGNORED (${s.channelType ?? "?"}): "${s.triggerPreview.slice(0, 120)}"`);
    }
  } catch {
    /* best-effort */
  }
  return patterns;
}

/** Memories semantically RELATED to the incoming message — so the gate knows
 *  what the user knows about THIS topic/project/person (e.g. "actively drives
 *  Project X" → likely responds). Recalled with the message itself as the query. */
async function fetchRelevantMemories(userId: string, incoming: string): Promise<string[]> {
  const out: string[] = [];
  try {
    const hits = await memory.recall(TWIN_BANK_ID, incoming.slice(0, 800), {
      budget: "low",
      tags: [`user:${userId}`],
      maxTokens: 1200,
    });
    for (const m of hits) {
      if ((m.tags ?? []).includes(`user:${userId}`)) out.push(m.text);
      if (out.length >= 5) break;
    }
  } catch {
    /* best-effort */
  }
  return out;
}

export interface RespondGateArgs {
  incoming: string;
  channelName?: string;
  channelType?: string;
  channelId?: string;
  conversationId?: string;
  senderName?: string;
  senderId?: string;
  /** The triggering message id — keys the gate pipeline event (optional). */
  sourceMessageId?: string;
}

export async function shouldTwinRespond(userId: string, args: RespondGateArgs): Promise<TwinRespondDecision> {
  const tStart = Date.now();
  // Record a fail-closed as a status="error" gate event so gate FAILURES (recall/
  // LLM timeout, HTTP error, unusable response) are visible + filterable in the
  // pipeline UI instead of being silently dropped. Best-effort; never throws.
  const recordFailure = (
    error: string,
    llm: { systemPrompt: string; userPrompt: string; response: string; thinking?: string; model: string } | null = null,
  ): void => {
    void recordGateEvent({
      userId,
      incoming: args.incoming,
      ...(args.channelName ? { channelName: args.channelName } : {}),
      ...(args.channelType ? { channelType: args.channelType } : {}),
      ...(args.senderName ? { senderName: args.senderName } : {}),
      ...(args.sourceMessageId ? { sourceMessageId: args.sourceMessageId } : {}),
      decision: FAIL_CLOSED,
      llm,
      error,
      durationMs: Date.now() - tStart,
    });
  };

  if (!CONFIG.xyneClawS2sKey) return FAIL_CLOSED;

  try {
    // EVERY mention goes through the LLM gate — no deterministic short-circuits.
    // DM + thread-participation are still computed and fed to the LLM as strong
    // "respond" signals (the LLM leans respond for them) rather than hard rails.
    const [patterns, corrections, relevant, stats, activeInThread] = await Promise.all([
      fetchPatterns(userId),
      fetchCorrections(userId),
      fetchRelevantMemories(userId, args.incoming),
      fetchStats(userId, {
        ...(args.channelType ? { channelType: args.channelType } : {}),
        ...(args.channelId ? { channelId: args.channelId } : {}),
        ...(args.channelName ? { channelName: args.channelName } : {}),
        ...(args.senderId ? { senderId: args.senderId } : {}),
        ...(args.senderName ? { senderName: args.senderName } : {}),
      }),
      args.conversationId ? isThreadParticipant(userId, args.conversationId) : Promise.resolve(false),
    ]);
    // Corrections (wrong-silence cases) are the highest-priority guidance.
    const allPatterns = [...corrections, ...patterns];

    const res = await fetch(`${CONFIG.xyneClawUrl.replace(/\/$/, "")}/internal/user-memory/should-respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-s2s-key": CONFIG.xyneClawS2sKey },
      body: JSON.stringify({
        incoming: args.incoming,
        ...(args.channelName ? { channelName: args.channelName } : {}),
        ...(args.channelType ? { channelType: args.channelType } : {}),
        ...(args.senderName ? { senderName: args.senderName } : {}),
        patterns: allPatterns,
        relevantContext: relevant,
        ...(stats ? { stats } : {}),
        isDirectMessage: args.channelType === "dm",
        isThreadParticipant: activeInThread,
        includeTrace: true,
      }),
      signal: AbortSignal.timeout(GATE_TIMEOUT_MS),
    });
    if (!res.ok) {
      recordFailure(`gate LLM HTTP ${res.status}`);
      return FAIL_CLOSED;
    }
    const d = (await res.json()) as Partial<TwinRespondDecision> & {
      trace?: { systemPrompt: string; userPrompt: string; response: string; thinking?: string; model: string };
    };
    if (typeof d.respond !== "boolean") {
      recordFailure("gate returned no usable decision", d.trace ?? null);
      return FAIL_CLOSED;
    }
    const decision: TwinRespondDecision = {
      respond: d.respond,
      confidence: typeof d.confidence === "number" ? d.confidence : 0.5,
      reason: typeof d.reason === "string" ? d.reason : "",
      source: typeof d.source === "string" ? d.source : "llm",
    };
    // Record the gate decision + LLM exchange for the pipeline UI (best-effort).
    void recordGateEvent({
      userId,
      incoming: args.incoming,
      ...(args.channelName ? { channelName: args.channelName } : {}),
      ...(args.channelType ? { channelType: args.channelType } : {}),
      ...(args.senderName ? { senderName: args.senderName } : {}),
      ...(args.sourceMessageId ? { sourceMessageId: args.sourceMessageId } : {}),
      decision,
      llm: d.trace ?? null,
      durationMs: Date.now() - tStart,
    });
    return decision;
  } catch (err) {
    const msg = errMsg(err);
    logger.warn("[twin-respond-gate] client failed — fail-closed (stay silent)", { userId, err: msg });
    recordFailure(`gate client error: ${msg}`);
    return FAIL_CLOSED;
  }
}
