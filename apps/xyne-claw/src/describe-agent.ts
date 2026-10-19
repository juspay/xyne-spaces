/**
 * describe-agent — the tool behind "what can you do?" / "tell me about yourself".
 *
 * Available to EVERY agent, on every interactive run, with no config: being able
 * to say what you are is table stakes, not a feature to switch on. The agent
 * calls it and claw-auth posts the `agent` artifact (variant "profile") — a
 * capability card built from the agent's OWN row.
 *
 * Deliberately NOT terminal (unlike propose-plan / propose-agent): the card is an
 * attachment to the reply, not the whole reply. "What can you do, and can you
 * help me with X?" should get the card AND the answer to X, so the tool records
 * and returns, letting the turn continue.
 *
 * The tool takes no content — only, optionally, which agent to describe. The
 * agent names a target; the SERVER describes it. Nothing the model writes here
 * reaches the card, so it cannot advertise a tool it wasn't granted.
 */

import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { PendingAgentCard } from "./propose-agent.js";
import { AGENT_TOOL_DEFS } from "xyne-claw-shared";
import { createLogger } from "./logger.js";

const log = createLogger("describe-agent");

export const DESCRIBE_AGENT_TOOL_NAME = "describe-agent";

/** Shared ref the tool writes into; read back by run.ts. */
export interface DescribeAgentRef {
  value?: Extract<PendingAgentCard, { variant: "profile" | "profile-list" | "summary" }>;
  /** Repeat calls after the first — telemetry only, the first target stands. */
  duplicates?: number;
}

export function buildDescribeAgentTool(ref: DescribeAgentRef): ToolDefinition {
  return {
    name: DESCRIBE_AGENT_TOOL_NAME,
    label: "Describe Agent",
    description: [
      "Shows the USER a capability card for an agent. Use it ONLY when the user wants to",
      "SEE an agent:",
      '  • "what can you do?", "introduce yourself", "what tools do you have?" → omit `slug`',
      '    to describe yourself.',
      '  • "tell me about ticket-triage" → pass that agent\'s `slug`.',
      '  • "which agents can review PRs?" → pass `slugs`, best match first (find them with',
      "    list_agents).",
      '  • "list all my agents", "what agents do we have?" → pass `summary: true`. The SERVER',
      "    counts them, so do not state a number or list the agents in text.",
      "",
      "Do NOT call it when:",
      "  • the user asks what MODEL or provider you run on — answer from your run context;",
      "    the card does not show it.",
      "  • you need information for YOURSELF — finding an agent, reading its tools or prompt",
      "    before update-agent, create-agent or delegating. This tool returns NOTHING to you;",
      "    it only puts a card in front of the user. Use list_agents / get_agent_config for that.",
      "  • the user asked to create, change or fix an agent — the approval card for that",
      "    change is the answer; a profile or roster card next to it is noise.",
      "  • an agent is merely mentioned in passing.",
      "",
      "The card is built from the agent's real configuration, so when you do call it, do not",
      "also describe the tools in prose. This does not end your turn; call it at most once per reply.",
    ].join("\n"),
    parameters: Type.Unsafe({
      type: "object",
      additionalProperties: false,
      properties: {
        slug: {
          type: "string",
          description:
            "Optional. The agent to describe, e.g. 'ticket-triage'. Omit to describe yourself.",
        },
        summary: {
          type: "boolean",
          description:
            "Set true to show a roster summary (total agent count + a link to the library) instead of individual cards. Use for 'list all my agents'.",
        },
        slugs: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional. Several agents to show as a stack of cards, e.g. when the user asks which agents can help with X. Use INSTEAD of `slug`, and instead of listing agents in prose. Order them best-match first; the server caps how many render and summarises the rest.",
        },
      },
      required: [],
    }),
    async execute(_toolCallId: string, params: unknown) {
      if (ref.value !== undefined) {
        ref.duplicates = (ref.duplicates ?? 0) + 1;
        return {
          content: [
            {
              type: "text" as const,
              text: "A capability card is already queued for this reply — it will be shown to the user. Do not call describe-agent again; continue with the rest of your answer.",
            },
          ],
          details: { duplicate: true },
        };
      }

      const p = (params as Record<string, unknown> | undefined) ?? {};

      if (p["summary"] === true) {
        ref.value = { variant: "summary" };
        log.info("[describe-agent] queued roster summary card");
        return {
          content: [
            {
              type: "text" as const,
              text: "A roster summary with the agent count and a link to the library will be shown with your reply. Do NOT state a count or list the agents in text — the card carries both. Say at most one short line.",
            },
          ],
          details: { summary: true },
        };
      }

      const rawList = Array.isArray(p["slugs"]) ? (p["slugs"] as unknown[]) : [];
      const slugs = rawList
        .filter((s): s is string => typeof s === "string")
        .map((s) => s.trim().slice(0, 80))
        .filter((s) => s.length > 0);

      if (slugs.length > 0) {
        ref.value = { variant: "profile-list", slugs };
        log.info(`[describe-agent] queued ${slugs.length} profile cards: ${slugs.join(", ")}`);
        return {
          content: [
            {
              type: "text" as const,
              text: `Capability cards for ${slugs.length} agent(s) will be shown with your reply — each one lists its real tools and integrations. Do NOT also list these agents or their tools in text; say at most one short line about why they fit.`,
            },
          ],
          details: { slugs },
        };
      }

      const slug = typeof p["slug"] === "string" ? p["slug"].trim().slice(0, 80) : "";
      ref.value = { variant: "profile", ...(slug ? { slug } : {}) };
      log.info(`[describe-agent] queued profile card for ${slug || "self"}`);

      return {
        content: [
          {
            type: "text" as const,
            text: `A capability card for ${slug || "you"} will be shown to the user with your reply. It lists the tools and integrations from the real configuration — do NOT repeat that list in your text. Keep any remaining answer brief, or say nothing more if the card is the whole answer.`,
          },
        ],
        details: { slug: slug || "self" },
      };
    },
  };
}

const AGENT_AUTHORING_TOOLS = new Set(AGENT_TOOL_DEFS.map((t) => t.slug));

export function describeAgentCardForReply(
  card: DescribeAgentRef["value"],
  pendingActions: ReadonlyArray<unknown>,
): DescribeAgentRef["value"] {
  if (!card) return undefined;
  const authoring = pendingActions.some(
    (action) =>
      !!action &&
      typeof action === "object" &&
      AGENT_AUTHORING_TOOLS.has(String((action as Record<string, unknown>)["tool"] ?? "")),
  );
  if (authoring) {
    log.info(`[describe-agent] dropped ${card.variant} card — the turn queued an agent-authoring action`);
    return undefined;
  }
  return card;
}
