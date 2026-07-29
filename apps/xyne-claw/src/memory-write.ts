/**
 * Memory-write tool — lets the Digital Twin agent durably RECORD a new learning
 * about the user mid-conversation (not just read via memory-search). It retains
 * one fact straight into the user's personal twin bank, tagged like the curator's
 * output (user:<id> + subsystem:<label>) so recall + the respond/ignore gate find
 * it. Marked `origin:agent` so agent-authored memories are distinguishable from
 * curator-distilled ones.
 *
 * Twin-only: personal memory is per-user; this tool is registered only for the
 * digital-twin agent and also hard-gates on isDigitalTwinAgent at call time.
 */

import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { bankIdForAgent, getMemoryProvider, USER_MEMORY_SUBSYSTEMS } from "xyne-claw-shared";
import { HINDSIGHT } from "./config.js";
import { isDigitalTwinAgent } from "./memory.js";

import { createLogger } from "./logger.js";
const log = createLogger("memory-write");

const MAX_TEXT = 1500;

export function buildMemoryWriteTool(
  agentSlug: string,
  userId: string,
  sessionId: string,
): ToolDefinition {
  return {
    name: "memory-write",
    label: "Save Agent Memory",
    description: [
      "Record a NEW durable fact about the user into their personal memory, so",
      "you (and the auto-reply gate) remember it in future conversations.",
      "",
      "Use SPARINGLY and only for a genuine, generalizable learning — e.g. a stable",
      "preference, a working relationship, an expertise area, or a respond/ignore",
      "pattern. Do NOT save one-off facts, transient state, or anything you're unsure",
      "of. If a similar fact may already exist, memory-search first and skip the write.",
      "",
      "Write `text` in the third person ('The user …'), one self-contained fact.",
      `Pick the single best subsystem: ${USER_MEMORY_SUBSYSTEMS.join(", ")}.`,
      "Use 'triage' for respond-vs-ignore behaviour (who/what they engage with vs ignore).",
    ].join("\n"),
    parameters: Type.Unsafe({
      type: "object",
      additionalProperties: false,
      properties: {
        text: {
          type: "string",
          description: "The fact to remember, third person and self-contained. e.g. 'The user ignores @channel broadcasts in #announcements but always replies to direct DMs from their manager.'",
        },
        subsystem: {
          type: "string",
          enum: [...USER_MEMORY_SUBSYSTEMS],
          description: "Which facet this fact belongs to. Use 'triage' for respond/ignore behaviour.",
        },
      },
      required: ["text", "subsystem"],
    }),
    async execute(_toolCallId: string, params: unknown) {
      const fail = (text: string) => ({ content: [{ type: "text" as const, text }], details: { error: true } });

      if (!HINDSIGHT.enabled) {
        log.warn(
          `[memory-write] HINDSIGHT disabled on this pod but agent has memoryEnabled — ` +
          `set HINDSIGHT_URL on xyne-claw and restart. agentSlug=${agentSlug} sessionId=${sessionId}`,
        );
        return fail("Memory not configured for this deployment.");
      }
      // Hard gate: only the twin agent writes personal memories.
      if (!isDigitalTwinAgent(agentSlug)) {
        return fail("memory-write is only available to the Digital Twin agent.");
      }

      const p = (params as Record<string, unknown> | undefined) ?? {};
      const text = typeof p["text"] === "string" ? p["text"].trim() : "";
      const subsystem = typeof p["subsystem"] === "string" ? p["subsystem"].trim() : "";
      if (!text) return fail("Error: text is required.");
      if (!(USER_MEMORY_SUBSYSTEMS as readonly string[]).includes(subsystem)) {
        return fail(`Error: subsystem must be one of ${USER_MEMORY_SUBSYSTEMS.join(", ")}.`);
      }

      try {
        const provider = getMemoryProvider();
        const bankId = bankIdForAgent(agentSlug);
        const out = await provider.retain(bankId, [{
          content: text.slice(0, MAX_TEXT),
          // Same tag shape as the curator's approved memories (memory.ts /
          // digital-twin.ts) so recall + the gate treat it identically; +origin.
          tags: [`user:${userId}`, `subsystem:${subsystem}`, "scope:user", "origin:agent"],
          timestamp: new Date().toISOString(),
          // REQUIRED on the shared twin bank so observations never mix users.
          observationScopes: [[`user:${userId}`]],
        }]);
        const id = out?.[0]?.id;
        log.info(`[memory-write] retained agent memory userId=${userId} subsystem=${subsystem} id=${id ?? "?"} sessionId=${sessionId}`);
        return {
          content: [{ type: "text" as const, text: `Saved to ${subsystem} memory.` }],
          details: { subsystem, id: id ?? null },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn(`[memory-write] retain failed agent=${agentSlug} sessionId=${sessionId}: ${msg}`);
        return fail(`Failed to save memory: ${msg}`);
      }
    },
  };
}
