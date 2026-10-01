/**
 * report_capability_gap — test runs of an unsaved agent draft only.
 *
 * claw-auth's /agents/draft-chat sets `agentConfig.draftTestRun` and lists, in
 * the run's additional instructions, what the draft can use now, what only
 * connects after it is saved, and what could be added. When a request needs
 * something the test can't use, the model calls this once per gap. The tool
 * has no side effects: the dashboard reads the call off the invocation stream
 * and shows it under the reply: Connect for connectors, Add for anything else.
 */

import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { AgentModelSettings } from "./agent-model-settings.js";
import { LITELLM } from "./config.js";

export const CAPABILITY_GAP_TOOL_NAME = "report_capability_gap";

/** agentConfig key claw-auth sets on a draft test run. */
export const DRAFT_TEST_RUN_FLAG = "draftTestRun";

/**
 * Persona when a draft test run arrives with none. Without it the run falls
 * back to the Digital Twin prompt and answers as the user.
 */
export const DRAFT_FALLBACK_PERSONA =
  "You are a new agent that is still being set up. You have no instructions yet.";

const STATUSES = ["not_added", "not_connected", "after_save", "test_blocked"] as const;
type GapStatus = (typeof STATUSES)[number];

const MAX_CAPABILITY = 80;
const MAX_NEED = 160;

export function isDraftTestRun(agentConfig: Record<string, unknown> | undefined): boolean {
  return agentConfig?.[DRAFT_TEST_RUN_FLAG] === true;
}

type LiteLlmModels = Pick<typeof LITELLM, "url" | "suggestUrl" | "suggestModel" | "fastModel">;

/**
 * A draft test run answers on the Build chat's model (the suggest model, with
 * thinking off) so testing feels as quick as building. When the suggest model
 * lives on a different endpoint than runs use, the fast model stands in, as it
 * does for the Build chat. Settings the draft sets itself win.
 */
export function draftTestModelSettings(
  settings: AgentModelSettings | undefined,
  litellm: LiteLlmModels = LITELLM,
): AgentModelSettings {
  const model = litellm.suggestUrl === litellm.url ? litellm.suggestModel : litellm.fastModel;
  return { model, thinkingLevel: "off", ...settings };
}

export function buildCapabilityGapTool(): ToolDefinition {
  // One row per capability and status is enough; a repeat would only duplicate the card.
  const reported = new Set<string>();
  return {
    name: CAPABILITY_GAP_TOOL_NAME,
    label: "Report Capability Gap",
    description: [
      "This is a test run of an unsaved agent. Call this when the user's request needs a",
      "capability this test can't use, once per capability, before you write any text. The",
      "user sees each call as a row under your reply, so don't describe it on screen.",
      "",
      "- not_added: the agent doesn't have it. Name it as it appears in the list of what can be added.",
      "- not_connected: the agent has it, but the user hasn't connected the account it needs.",
      "- after_save: the agent has it, but it only connects once the agent is saved.",
      "- test_blocked: the agent has it, but the request writes (sends, posts, creates, edits,",
      "  deletes) and test runs are read-only.",
      "",
      "Don't call it for things you can already do.",
    ].join("\n"),
    parameters: Type.Unsafe({
      type: "object",
      additionalProperties: false,
      properties: {
        capability: {
          type: "string",
          description: "The capability's name exactly as listed in this run's instructions, e.g. \"Linear\" or \"Web search\".",
        },
        status: {
          type: "string",
          enum: [...STATUSES],
          description: "not_added, not_connected, after_save or test_blocked.",
        },
        need: {
          type: "string",
          description: "What the request needs it for, in a few words starting with a verb, e.g. \"list your open issues\".",
        },
      },
      required: ["capability", "status", "need"],
    }),
    async execute(_toolCallId: string, params: unknown) {
      const p = (params as Record<string, unknown> | undefined) ?? {};
      const capability = typeof p["capability"] === "string" ? p["capability"].trim().slice(0, MAX_CAPABILITY) : "";
      const status = p["status"];
      const need = typeof p["need"] === "string" ? p["need"].trim().slice(0, MAX_NEED) : "";
      if (!capability || !need || !STATUSES.includes(status as GapStatus)) {
        return {
          content: [{
            type: "text" as const,
            text: `Rejected: pass capability, need, and status (one of ${STATUSES.join(", ")}). Call ${CAPABILITY_GAP_TOOL_NAME} again.`,
          }],
          details: { error: true },
        };
      }
      const key = `${capability.toLowerCase()}:${status as GapStatus}`;
      if (reported.has(key)) {
        return {
          content: [{ type: "text" as const, text: `Already reported ${capability}. Don't report it again.` }],
          details: { duplicate: true },
        };
      }
      reported.add(key);
      return {
        content: [{
          type: "text" as const,
          text: `Shown to the user under your reply. Don't repeat the details; say briefly what you can do now and what ${capability} would add.`,
        }],
        details: { capability, status, need },
      };
    },
  };
}
