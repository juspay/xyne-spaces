/**
 * Memory-search tool. Built per-session and injected when an agent has
 * memoryEnabled=true. Replaces the old inject-all-recalled-facts pattern in
 * prefetchMemory — the agent now searches on demand instead of carrying 18
 * pre-stuffed facts in the system prompt.
 */

import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { bankIdForAgent, getMemoryProvider } from "xyne-claw-shared";
import type { RecalledMemory } from "xyne-claw-shared";
import { HINDSIGHT, SERVER } from "./config.js";
import { isDigitalTwinAgent } from "./memory.js";

import { createLogger } from "./logger.js";
const log = createLogger("memory-search");

const MAX_LIMIT = 12;
const MIN_LIMIT = 1;

export function buildMemorySearchTool(
  agentSlug: string,
  userId: string,
  sessionId: string,
  memoryBankId?: string,
): ToolDefinition {
  // The twin's recall is hard-gated server-side to the caller's `user:` tag and
  // the subsystem param is ignored for it (see execute below) — so only the
  // shared-agent description needs to warn that session-ingested facts carry no
  // subsystem tags (twin facts still do, via user-memory-curator's taxonomy).
  const twin = isDigitalTwinAgent(agentSlug);
  return {
    name: "memory-search",
    label: "Search Agent Memory",
    description: twin
      ? [
          "Search this user's personal memory bank for facts relevant to a query.",
          "Use it to understand the user's communication style, preferences,",
          "relationships, ongoing work, and approved personal context. Do not invent",
          "facts from memory — only use what the tool returns.",
          "",
          "Returns up to N memories as a numbered list. If empty, the bank has no",
          "matching knowledge — proceed without calling again on the same query.",
        ].join("\n")
      : [
          "Search this agent's shared memory. These memories are created by users",
          "of this agent and may contain business knowledge, past mistakes, debugging",
          "approaches, tool-use guidance, and reasons behind previous decisions.",
          "",
          "Memory can be stale or incomplete, so do not use it to make up answers.",
          "For current facts, code behavior, production RCA, metrics, counts, audits,",
          "and reports, the source of truth is code, logs, databases, and live tools.",
          "Use memory as supporting context, not as proof.",
          "",
          "Scope to a subsystem whenever the query fits one (for example: 'spaces',",
          "'ticket-creation'). Search unscoped when none fits. Time-aware queries are",
          "supported: include the time reference in the query, such as 'now', 'last",
          "month', or 'before the launch'.",
          "",
          "Returns up to N memories as a numbered list. If empty, the bank has no",
          "matching knowledge — proceed without calling again on the same query.",
        ].join("\n"),
    parameters: Type.Unsafe({
      type: "object",
      additionalProperties: false,
      properties: {
        query: {
          type: "string",
          description: "Natural language search query. Be specific — semantic match works better than keywords. Include a time reference for temporal questions (e.g. 'now', 'before the X launch', 'last month').",
        },
        subsystem: {
          type: "string",
          description: twin
            ? "Ignored for personal memory — recall always searches your whole personal bank."
            : "Restrict to one subsystem from the system-prompt list (e.g. 'spaces', 'ticket-creation'). " +
              "Prefer this when the query fits — scoped recall is much faster than unscoped.",
        },
        limit: {
          type: "number",
          description: `Max memories to return (${MIN_LIMIT}-${MAX_LIMIT}, default 5).`,
        },
      },
      required: ["query"],
    }),
    async execute(_toolCallId: string, params: unknown) {
      if (!HINDSIGHT.enabled) {
        // Loud on purpose: the tool exists because the agent row says
        // memoryEnabled=true, but this pod booted without HINDSIGHT_URL /
        // MEMORY_PROVIDER. Without this line the split-brain (claw-auth
        // retains fine, claw recall dead) is invisible in logs.
        log.warn(
          `[memory-search] HINDSIGHT disabled on this pod but agent has memoryEnabled — ` +
          `set HINDSIGHT_URL (or MEMORY_PROVIDER) on the xyne-claw deployment and restart. ` +
          `agentSlug=${agentSlug} sessionId=${sessionId}`,
        );
        return {
          content: [{ type: "text" as const, text: "Memory not configured for this deployment." }],
          details: {},
        };
      }
      const p = (params as Record<string, unknown> | undefined) ?? {};
      const query = typeof p["query"] === "string" ? p["query"].trim() : "";
      const subsystem = typeof p["subsystem"] === "string" ? p["subsystem"].trim() : "";
      const rawLimit = typeof p["limit"] === "number" ? Math.floor(p["limit"]) : 5;
      const limit = Math.max(MIN_LIMIT, Math.min(MAX_LIMIT, rawLimit));

      if (!query) {
        return {
          content: [{ type: "text" as const, text: "Error: query is required." }],
          details: {},
        };
      }

      // Digital Twin recall hard-gate. The dedicated "digital-twin" agent
      // (seeded in 20260522000000_digital_twin_agent) is the only agent
      // allowed to read this user's personal memories. When invoked, it
      // recalls ONLY this user's personal memories (tag `user:<id>`), never
      // shared agent memory — enforced server-side, ignored by the LLM.
      // An optional `subsystem` narrows WITHIN the user's own facts (the twin's
      // curator labels: style / expertise / projects / relationships /
      // preferences / decisions / context / docs). The `user:` gate is still
      // authoritative and always applied on top.
      //
      // The "assistant" agent (also seeded with a Digital-Twin-style prompt)
      // is the default-everywhere agent and does NOT get personal memory —
      // routing every assistant call through user recall would be wasteful
      // and noisy for the many quick general queries it handles.
      // Keyed on the bank id (not the raw slug) so sanitization collisions
      // like "digital--twin" can't reach the twin bank ungated — see
      // isDigitalTwinAgent in memory.ts.
      const isDigitalTwin = isDigitalTwinAgent(agentSlug);
      const tags = isDigitalTwin
        ? subsystem
          ? [`user:${userId}`, `subsystem:${subsystem}`]
          : [`user:${userId}`]
        : subsystem
          ? [`subsystem:${subsystem}`]
          : ["shared"];
      try {
        const provider = getMemoryProvider();
        const bankId = isDigitalTwin
          ? bankIdForAgent(agentSlug)
          : memoryBankId?.trim() || bankIdForAgent(agentSlug);
        // Over-fetch 2x: session-ingest banks hold many near-copies of the
        // same fact (447 overlapping sessions), and the reranker happily fills
        // the top-N with them. dedupeSimilar below collapses the copies, so we
        // need surplus candidates to still return `limit` distinct facts.
        const hits = await provider.recall(bankId, query.slice(0, 1000), {
          // "mid" won the 2026-07-20 retrieval eval: P@5 72% vs 62% on "low"
          // (deeper candidate fetch gives RRF better material; boosts made
          // things worse — 57-66%). Latency stays sub-second scoped, ~1-2s
          // unscoped with the rrf reranker.
          budget: "mid",
          tags,
          // Over-fetch 2× so dedupeSimilar still returns `limit` distinct facts.
          maxTokens: limit * 2 * 250,
          // Twin recall is temporal: anchor relative time expressions in the
          // query to "now", and prefer evolution-aware observation memories
          // (e.g. "switched from A to B") over raw facts when they exist.
          ...(isDigitalTwin
            ? { preferObservations: true, queryTimestamp: new Date().toISOString() }
            : {}),
        });
        // AUTHORITATIVE privacy filter for the digital-twin bank — do NOT trust
        // the provider's tag filter. Hindsight over-matches tag queries
        // (incident 2026-05-25: returns ALL bank memories regardless of the tag
        // passed). In the twin bank the `user:` tag is the ONLY thing separating
        // users, so re-filter in JS by the requester's tag before anything
        // reaches the model. Mirrors memory.ts:recall — every Memory-tab read
        // already does this; the agent recall path must too. (Non-twin/shared
        // banks hold agent knowledge, not personal data — left as provider-filtered
        // to avoid changing their recall behaviour.)
        const scoped = isDigitalTwin
          ? hits.filter((m) => {
              const t = m.tags ?? [];
              // user gate is authoritative; the optional subsystem narrows within it.
              if (!t.includes(`user:${userId}`)) return false;
              if (subsystem && !t.includes(`subsystem:${subsystem}`)) return false;
              return true;
            })
          : hits;
        const trimmed = dedupeSimilar(scoped).slice(0, limit);

        if (sessionId) {
          // Fire-and-forget: POST recall hits to claw-auth so the Memory tab's
          // hot-memory + 7d recall counters update in real-time. The old
          // append-to-disk + nightly cron path didn't work because claw and
          // claw-auth are separate pods with separate filesystems.
          logRecallHits(agentSlug, userId, sessionId, trimmed, isDigitalTwin).catch(() => {});
        }

        if (trimmed.length === 0) {
          const scopeLabel = isDigitalTwin ? "your personal memory" : subsystem ? `subsystem '${subsystem}'` : "shared memory";
          return {
            content: [{ type: "text" as const, text: `No memories matched the query in ${scopeLabel}.` }],
            details: { count: 0 },
          };
        }

        const body = trimmed
          .map((m, i) => `${i + 1}. ${m.text}`)
          .join("\n");
        const scopeLabel = isDigitalTwin ? "personal" : subsystem ? `subsystem '${subsystem}'` : "shared";
        const header = `Found ${trimmed.length} ${scopeLabel} memor${trimmed.length === 1 ? "y" : "ies"}:\n`;
        return {
          content: [{ type: "text" as const, text: header + body }],
          details: { count: trimmed.length },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn(`[memory-search] recall failed agent=${agentSlug} sessionId=${sessionId}: ${msg}`);
        return {
          content: [{ type: "text" as const, text: `Memory search failed: ${msg}` }],
          details: { error: true },
        };
      }
    },
  };
}

/**
 * Collapse near-duplicate recall hits, keeping the highest-ranked copy.
 * Session-ingest extracts the same fact from many overlapping sessions
 * ("REDIS_HOST is..." x40); rerankers surface the copies together and crowd
 * distinct knowledge out of the top-N. Token-set Jaccard on normalized text
 * is enough to catch these copies — they're paraphrases of one sentence, not
 * subtle semantic overlaps. Observations (consolidated facts) rank first when
 * present, so the kept copy tends to be the canonical one.
 */
function dedupeSimilar(hits: RecalledMemory[]): RecalledMemory[] {
  const kept: { hit: RecalledMemory; tokens: Set<string> }[] = [];
  for (const hit of hits) {
    const tokens = new Set(
      hit.text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((t) => t.length > 2),
    );
    const isDup = kept.some((k) => {
      let overlap = 0;
      for (const t of tokens) if (k.tokens.has(t)) overlap++;
      const union = k.tokens.size + tokens.size - overlap;
      return union > 0 && overlap / union >= 0.6;
    });
    if (!isDup) kept.push({ hit, tokens });
  }
  return kept.map((k) => k.hit);
}

async function logRecallHits(
  agentSlug: string,
  userId: string,
  sessionId: string,
  hits: RecalledMemory[],
  isDigitalTwin: boolean,
): Promise<void> {
  if (hits.length === 0) return;
  const recalledAt = new Date().toISOString();
  const scope = isDigitalTwin ? "user" : "shared";
  const payload = hits
    .filter((m) => !!m.id)
    .map((m, i) => ({
      agentSlug,
      hindsightMemoryId: m.id,
      userId,
      sessionId,
      scope,
      rank: i + 1,
      recalledAt,
    }));
  if (payload.length === 0) return;
  try {
    await fetch(`${SERVER.authServiceUrl}/claw/api/v1/memory/recall-hits`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(SERVER.s2sKey ? { "x-s2s-key": SERVER.s2sKey } : {}),
      },
      body: JSON.stringify({ hits: payload }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    // Non-fatal — recall log is for analytics, not correctness.
  }
}
