/**
 * mutate-memory tool — lets an AUTHORIZED human (via the agent) change the
 * agent's shared memory bank: add a new curated memory, or delete one by id.
 * The read half is inspect-memory.
 *
 * The provider has no in-place update primitive, so "edit" = delete + add.
 * v1 deliberately exposes only `add` and `delete` (a single id). Bulk-
 * destructive ops (deleteByTag / clearAll) are intentionally NOT surfaced
 * here — they belong behind a CLAW_ADMIN-only, confirm-token path if ever
 * added.
 *
 * `delete` maps to the provider's deleteMemory. In Hindsight that is a
 * soft-retire (state=invalidated, filtered out of listMemories/recall), so
 * from the app's perspective the memory is gone but it is effectively
 * irreversible from the tool — there is no undo. The tool says so.
 *
 * Authorization is decided ONCE per session in run.ts (owner / contributor /
 * CLAW_ADMIN via claw-auth S2S) and passed in as `allowed`; every call
 * re-checks it and FAILS CLOSED. The personal-memory (twin) bank is blocked
 * outright — its per-user memories must never be mutated through a shared
 * admin tool.
 */

import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { bankIdForAgent, getMemoryProvider } from "xyne-claw-shared";
import { HINDSIGHT } from "./config.js";
import { isDigitalTwinAgent } from "./memory.js";
import { MEMORY_ADMIN_DENIED } from "./memory-inspect.js";

import { createLogger } from "./logger.js";
const log = createLogger("memory-mutate");

const MAX_TEXT = 1500;

export function buildMutateMemoryTool(
  agentSlug: string,
  userId: string,
  sessionId: string,
  memoryBankId: string | undefined,
  allowed: boolean,
): ToolDefinition {
  return {
    name: "mutate-memory",
    label: "Mutate Agent Memory",
    description: [
      "Change this agent's stored long-term memory bank (admin action).",
      "",
      "Actions:",
      "  • add    — store a NEW shared memory. Requires `text`; optional `subsystem`",
      "             groups it (e.g. 'spaces'). Written third-person and self-contained.",
      "  • delete — remove ONE memory. Requires `memoryId` (get it from inspect-memory).",
      "             Deletion is effectively permanent — there is no undo.",
      "",
      "To correct a memory, delete the old id and add the fixed text (there is no",
      "in-place edit). Restricted to the agent owner, contributors, or CLAW_ADMINs.",
    ].join("\n"),
    parameters: Type.Unsafe({
      type: "object",
      additionalProperties: false,
      properties: {
        action: {
          type: "string",
          enum: ["add", "delete"],
          description: "'add' to store a new memory, 'delete' to remove one by id.",
        },
        text: {
          type: "string",
          description: "add only: the memory content, third-person and self-contained.",
        },
        subsystem: {
          type: "string",
          description: "add only (optional): group tag, e.g. 'spaces', 'ticket-creation'.",
        },
        memoryId: {
          type: "string",
          description: "delete only: the id of the memory to remove (from inspect-memory).",
        },
      },
      required: ["action"],
    }),
    async execute(_toolCallId: string, params: unknown) {
      const fail = (text: string) => ({ content: [{ type: "text" as const, text }], details: { error: true } });
      const ok = (text: string, details: Record<string, unknown>) => ({ content: [{ type: "text" as const, text }], details });

      // Gate 1 — authorization (fail closed).
      if (!allowed) return fail(MEMORY_ADMIN_DENIED);

      if (!HINDSIGHT.enabled) {
        log.warn(
          `[mutate-memory] HINDSIGHT disabled on this pod but agent has memoryEnabled — ` +
          `set HINDSIGHT_URL on xyne-claw and restart. agentSlug=${agentSlug} sessionId=${sessionId}`,
        );
        return fail("Memory not configured for this deployment.");
      }

      // Gate 2 — never mutate the personal-memory (twin) bank via this shared tool.
      if (isDigitalTwinAgent(agentSlug)) {
        return fail("mutate-memory is not available for personal-memory (digital-twin) agents.");
      }

      const p = (params as Record<string, unknown> | undefined) ?? {};
      const action = typeof p["action"] === "string" ? p["action"].trim() : "";

      const provider = getMemoryProvider();
      const bankId = memoryBankId?.trim() || bankIdForAgent(agentSlug);

      try {
        if (action === "add") {
          const text = typeof p["text"] === "string" ? p["text"].trim() : "";
          const subsystem = typeof p["subsystem"] === "string" ? p["subsystem"].trim() : "";
          if (!text) return fail("Error: text is required for action 'add'.");
          const out = await provider.retain(bankId, [{
            content: text.slice(0, MAX_TEXT),
            // Mirror the curator's shared-memory tag shape (routes/memory.ts approve
            // path) so recall + the Memory tab treat it identically; +origin marks it
            // agent-admin-authored, +by records the human who added it.
            tags: [
              `agent:${agentSlug}`,
              "shared",
              ...(subsystem ? [`subsystem:${subsystem}`] : []),
              "origin:agent-admin",
            ],
            metadata: {
              agentSlug,
              ...(subsystem ? { subsystem } : {}),
              source: "agent-admin-tool",
              addedByUserId: userId,
            },
            timestamp: new Date().toISOString(),
          }]);
          const id = out?.[0]?.id ?? null;
          // Audit: agent-admin writes bypass the HITL curator review, so the log
          // line is the record of who added what.
          log.info(
            `[mutate-memory] add userId=${userId} agent=${agentSlug} bank=${bankId} ` +
            `id=${id ?? "?"} subsystem=${subsystem || "-"} sessionId=${sessionId}`,
          );
          return ok(`Added memory${subsystem ? ` under subsystem '${subsystem}'` : ""}${id ? ` (id: ${id})` : ""}.`, { action, id, subsystem: subsystem || null });
        }

        if (action === "delete") {
          const memoryId = typeof p["memoryId"] === "string" ? p["memoryId"].trim() : "";
          if (!memoryId) return fail("Error: memoryId is required for action 'delete'.");
          await provider.deleteMemory(bankId, memoryId);
          log.info(`[mutate-memory] delete userId=${userId} agent=${agentSlug} bank=${bankId} id=${memoryId} sessionId=${sessionId}`);
          return ok(`Deleted memory ${memoryId}. This cannot be undone.`, { action, memoryId });
        }

        return fail("Error: action must be 'add' or 'delete'.");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn(`[mutate-memory] ${action} failed agent=${agentSlug} sessionId=${sessionId}: ${msg}`);
        return fail(`mutate-memory failed: ${msg}`);
      }
    },
  };
}
