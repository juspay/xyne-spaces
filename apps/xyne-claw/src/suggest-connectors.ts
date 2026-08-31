/**
 * suggest-connectors — surfaces connector cards inside the conversation.
 *
 * Covers the moments where an integration is the real answer:
 *   1. the user pastes a link to a service (Google Doc, GitHub repo, Figma file)
 *   2. mid-task, when the work needs an account the user has not connected
 *   3. when the user asks to connect something by name, or to list what exists
 *
 * Deliberately NOT wired into agent creation: propose-agent is terminal, so a
 * suggestion would have to precede the draft, and that ordering constraint made
 * the flow unreliable. Agent creation stays as it is.
 *
 * Deliberately NOT terminal (like describe-agent): the card is an attachment to
 * the reply, so the model can explain why it needs Google Drive AND post the
 * card to connect it in the same turn.
 *
 * The model names connector types; the SERVER resolves each one against the
 * catalog and drops anything it does not recognise. Nothing the model writes
 * reaches the card's title or description, so it cannot invent an integration
 * or misdescribe what one does.
 */

import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { createLogger } from "./logger.js";

const log = createLogger("suggest-connectors");

export const SUGGEST_CONNECTORS_TOOL_NAME = "suggest-connectors";

export interface PendingConnectorSuggestions {
  serverTypes: string[];
  title?: string;
  /** The user asked to see what exists — server picks the sample and adds Browse. */
  listAll?: boolean;
}

export interface SuggestConnectorsRef {
  value?: PendingConnectorSuggestions;
  /** Repeat calls after the first — telemetry only, the first set stands. */
  duplicates?: number;
}

const MAX_SUGGESTIONS = 6;

export function buildSuggestConnectorsTool(ref: SuggestConnectorsRef): ToolDefinition {
  return {
    name: SUGGEST_CONNECTORS_TOOL_NAME,
    label: "Suggest Connectors",
    description: [
      "MANDATORY for any question about connectors / MCPs / integrations. These are shown as",
      "cards with Connect buttons — you MUST NOT answer such questions in prose.",
      "",
      "Call it with `listAll: true` (and no serverTypes) whenever the user asks what connectors",
      "or MCPs exist — e.g. \"list all the MCPs\", \"list down all the connectors\", \"what",
      "integrations do we have\", \"show me the MCPs\". Do NOT enumerate them in text: the card",
      "shows a sample plus a Browse button, and the server owns the list.",
      "",
      "Call it with `serverTypes` (most relevant first) when:",
      "  • the user PASTES A LINK to a service — a Google Doc/Drive/Sheet, a GitHub or",
      "    Bitbucket repo or PR, a Figma file, a Notion page, a Jira ticket — and that",
      "    connector is not connected. Read the domain, post its card, then say what you",
      "    will do once it is on. Do this even if they only ask a question about the link.",
      "  • a task needs an account that is not connected (e.g. summarising a Google Doc",
      "    without Google connected),",
      "  • the user asks to connect something by name (\"connect Figma\").",
      "",
      "The server fills in each name, description and connected state from the catalog and skips",
      "unknown types, so never describe the connectors yourself.",
      "",
      "This does not end your turn. Call it at most once per reply.",
    ].join("\n"),
    parameters: Type.Unsafe({
      type: "object",
      additionalProperties: false,
      properties: {
        serverTypes: {
          type: "array",
          items: { type: "string" },
          description: "Connector types to show, most relevant first. e.g. ['google','github'].",
        },
        listAll: {
          type: "boolean",
          description:
            "True when the user asked to browse or list the available connectors, rather than naming specific ones.",
        },
        title: {
          type: "string",
          description:
            "Optional heading, e.g. 'Connectors that could help this agent' or 'Connect Google to continue'.",
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
              text: "Connector cards are already queued for this reply. Do not call suggest-connectors again; continue with the rest of your answer.",
            },
          ],
          details: { duplicate: true },
        };
      }

      const p = (params as Record<string, unknown> | undefined) ?? {};
      const raw = Array.isArray(p["serverTypes"]) ? (p["serverTypes"] as unknown[]) : [];
      const serverTypes = [
        ...new Set(
          raw
            .filter((t): t is string => typeof t === "string")
            .map((t) => t.trim().toLowerCase())
            .filter((t) => t.length > 0),
        ),
      ].slice(0, MAX_SUGGESTIONS);

      const listAll = p["listAll"] === true;

      if (serverTypes.length === 0 && !listAll) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Rejected: name at least one connector type in `serverTypes`, or pass `listAll: true` to show what is available.",
            },
          ],
          details: { rejected: true },
        };
      }

      const title = typeof p["title"] === "string" ? p["title"].trim().slice(0, 120) : "";
      ref.value = { serverTypes, ...(title ? { title } : {}), ...(listAll ? { listAll: true } : {}) };
      log.info(
        listAll
          ? "[suggest-connectors] queued roster listing"
          : `[suggest-connectors] queued ${serverTypes.length}: ${serverTypes.join(", ")}`,
      );

      return {
        content: [
          {
            type: "text" as const,
            text: listAll
              ? "A connector list with a Browse button will be shown with your reply. Do NOT list the connectors in your text — say at most one short line."
              : `Connector cards for ${serverTypes.join(", ")} will be shown with your reply, each with a Connect button. Do NOT list or describe these connectors in your text — say at most one short line about why they help.`,
          },
        ],
        details: { serverTypes, listAll },
      };
    },
  };
}
