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

const MAX_LIMIT = 12;
const MIN_LIMIT = 1;

export function buildMemorySearchTool(
  agentSlug: string,
  userId: string,
  sessionId: string,
): ToolDefinition {
  return {
    name: "memory-search",
    label: "Search Agent Memory",
    description: [
      "Search the agent's shared knowledge bank for facts relevant to a query.",
      "",
      "Use this for anything that overlaps a known subsystem (see system prompt for the list).",
      "Examples: 'how to mention a user in Spaces', 'ticket creation API requirements'.",
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
          description: "Natural language search query. Be specific — semantic match works better than keywords.",
        },
        subsystem: {
          type: "string",
          description: "Optional: restrict to one subsystem (e.g. 'spaces', 'ticket-creation').",
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
      // Subsystem filtering is disallowed for twin recalls; the gate always
      // narrows to the user's own bank.
      //
      // The "assistant" agent (also seeded with a Digital-Twin-style prompt)
      // is the default-everywhere agent and does NOT get personal memory —
      // routing every assistant call through user recall would be wasteful
      // and noisy for the many quick general queries it handles.
      const isDigitalTwin = agentSlug === "digital-twin";
      const tags = isDigitalTwin
        ? [`user:${userId}`]
        : subsystem
          ? [`subsystem:${subsystem}`]
          : ["shared"];
      try {
        const provider = getMemoryProvider();
        const bankId = bankIdForAgent(agentSlug);
        const hits = await provider.recall(bankId, query.slice(0, 1000), {
          budget: "low",
          tags,
          maxTokens: limit * 250,
        });
        const trimmed = hits.slice(0, limit);

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
        console.warn(`[memory-search] recall failed agent=${agentSlug} sessionId=${sessionId}: ${msg}`);
        return {
          content: [{ type: "text" as const, text: `Memory search failed: ${msg}` }],
          details: { error: true },
        };
      }
    },
  };
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
