/**
 * inspect-memory tool — lets an AUTHORIZED human (via the agent) browse the
 * agent's shared memory bank directly: list/filter the stored memories and
 * fetch one by id. This is the read half of agent-memory management; the write
 * half is mutate-memory.
 *
 * Authorization is decided ONCE per session in run.ts (owner / contributor /
 * CLAW_ADMIN, resolved via claw-auth over S2S) and passed in as `allowed`.
 * The tool re-checks `allowed` on every call and FAILS CLOSED.
 *
 * Hard twin block: the personal-memory ("digital-twin") bank holds every
 * opted-in user's private memories separated ONLY by a `user:<id>` tag that
 * Hindsight is known to over-match (incident 2026-05-25). A bank-wide browse
 * there would leak other users' data, so this tool refuses the twin bank
 * outright — the mirror of memory-write being twin-ONLY.
 */

import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { bankIdForAgent, getMemoryProvider } from "xyne-claw-shared";
import type { MemoryRecord as Memory } from "xyne-claw-shared";
import { HINDSIGHT } from "./config.js";
import { isDigitalTwinAgent } from "./memory.js";

import { createLogger } from "./logger.js";
const log = createLogger("memory-inspect");

const MAX_LIMIT = 50;
const MIN_LIMIT = 1;
const DEFAULT_LIMIT = 20;

export const MEMORY_ADMIN_DENIED =
  "Only the agent owner, contributors, or a CLAW_ADMIN can inspect or mutate this agent's memory.";

function renderMemory(m: Memory, index?: number): string {
  const tags = (m.tags ?? []).join(", ");
  const head = index != null ? `${index}. ` : "";
  const parts = [
    `${head}[id: ${m.id}]`,
    m.factType ? `(${m.factType})` : "",
  ].filter(Boolean).join(" ");
  const body = (m.content ?? "").trim();
  const meta = [
    tags ? `tags: ${tags}` : "",
    m.createdAt ? `created: ${m.createdAt}` : "",
  ].filter(Boolean).join(" · ");
  return [parts, body, meta ? `   ${meta}` : ""].filter(Boolean).join("\n   ");
}

export function buildInspectMemoryTool(
  agentSlug: string,
  userId: string,
  sessionId: string,
  memoryBankId: string | undefined,
  allowed: boolean,
): ToolDefinition {
  return {
    name: "inspect-memory",
    label: "Inspect Agent Memory",
    description: [
      "Browse this agent's stored long-term memory bank directly (admin view).",
      "",
      "Two modes:",
      "  • List/filter — pass `query` (substring/keyword), `tags`, `limit`, `offset`",
      "    to page through stored memories.",
      "  • Fetch one — pass `memoryId` to read a single memory in full.",
      "",
      "Each result shows the memory's id, content, tags and creation time. Use the",
      "id with `mutate-memory` to delete a specific memory. Restricted to the agent",
      "owner, contributors, or CLAW_ADMINs — other callers get an error.",
    ].join("\n"),
    parameters: Type.Unsafe({
      type: "object",
      additionalProperties: false,
      properties: {
        query: {
          type: "string",
          description: "Optional substring/keyword filter over memory content.",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Optional tag filter, e.g. ['subsystem:spaces'] or ['shared'].",
        },
        limit: {
          type: "number",
          description: `Max memories to return (${MIN_LIMIT}-${MAX_LIMIT}, default ${DEFAULT_LIMIT}). Ignored when memoryId is set.`,
        },
        offset: {
          type: "number",
          description: "Pagination offset (default 0). Ignored when memoryId is set.",
        },
        memoryId: {
          type: "string",
          description: "Fetch exactly this memory by id instead of listing.",
        },
      },
    }),
    async execute(_toolCallId: string, params: unknown) {
      const fail = (text: string) => ({ content: [{ type: "text" as const, text }], details: { error: true } });

      // Gate 1 — authorization (fail closed; decided once per session in run.ts).
      if (!allowed) return fail(MEMORY_ADMIN_DENIED);

      if (!HINDSIGHT.enabled) {
        log.warn(
          `[inspect-memory] HINDSIGHT disabled on this pod but agent has memoryEnabled — ` +
          `set HINDSIGHT_URL on xyne-claw and restart. agentSlug=${agentSlug} sessionId=${sessionId}`,
        );
        return fail("Memory not configured for this deployment.");
      }

      // Gate 2 — never expose the personal-memory (twin) bank. It multiplexes
      // every user's private memories behind a user: tag Hindsight over-matches;
      // an admin browse would cross the user boundary.
      if (isDigitalTwinAgent(agentSlug)) {
        return fail("inspect-memory is not available for personal-memory (digital-twin) agents.");
      }

      const p = (params as Record<string, unknown> | undefined) ?? {};
      const memoryId = typeof p["memoryId"] === "string" ? p["memoryId"].trim() : "";
      const query = typeof p["query"] === "string" ? p["query"].trim() : "";
      const tags = Array.isArray(p["tags"])
        ? (p["tags"] as unknown[]).filter((t): t is string => typeof t === "string" && t.trim().length > 0)
        : [];
      const rawLimit = typeof p["limit"] === "number" ? Math.floor(p["limit"]) : DEFAULT_LIMIT;
      const limit = Math.max(MIN_LIMIT, Math.min(MAX_LIMIT, rawLimit));
      const offset = typeof p["offset"] === "number" && p["offset"] > 0 ? Math.floor(p["offset"]) : 0;

      const provider = getMemoryProvider();
      const bankId = memoryBankId?.trim() || bankIdForAgent(agentSlug);

      try {
        // Single-memory fetch by id.
        if (memoryId) {
          if (typeof provider.getMemory !== "function") {
            return fail("This memory provider does not support fetch-by-id; list with filters instead.");
          }
          const one = await provider.getMemory(bankId, memoryId);
          if (!one) return { content: [{ type: "text" as const, text: `No memory found with id ${memoryId}.` }], details: { count: 0 } };
          log.info(`[inspect-memory] get userId=${userId} agent=${agentSlug} bank=${bankId} id=${memoryId} sessionId=${sessionId}`);
          return {
            content: [{ type: "text" as const, text: renderMemory(one) }],
            details: { count: 1, memoryId },
          };
        }

        // List / filter.
        const page = await provider.listMemories(bankId, {
          ...(query ? { search: query } : {}),
          ...(tags.length ? { tags } : {}),
          limit,
          offset,
        });
        log.info(
          `[inspect-memory] list userId=${userId} agent=${agentSlug} bank=${bankId} ` +
          `n=${page.memories.length} total=${page.total ?? "?"} offset=${offset} sessionId=${sessionId}`,
        );
        if (page.memories.length === 0) {
          return { content: [{ type: "text" as const, text: "No memories matched." }], details: { count: 0 } };
        }
        const body = page.memories.map((m, i) => renderMemory(m, offset + i + 1)).join("\n\n");
        const totalNote = typeof page.total === "number" ? ` of ${page.total}` : "";
        const header = `Showing ${page.memories.length}${totalNote} memor${page.memories.length === 1 ? "y" : "ies"} (offset ${offset}):\n\n`;
        return {
          content: [{ type: "text" as const, text: header + body }],
          details: { count: page.memories.length, total: page.total ?? null, offset },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn(`[inspect-memory] failed agent=${agentSlug} sessionId=${sessionId}: ${msg}`);
        return fail(`inspect-memory failed: ${msg}`);
      }
    },
  };
}
