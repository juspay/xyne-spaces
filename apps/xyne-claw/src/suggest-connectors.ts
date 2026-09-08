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
 *
 * The tool checks the catalog BEFORE promising a card. It used to answer "cards
 * will be shown" unconditionally, so a request for a connector we do not carry
 * (prod: figma) had the model write "hit Connect on the card" over a card the
 * server then silently dropped. Unknown types are now reported back instead.
 */

import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { createLogger } from "./logger.js";
import { SERVER } from "./config.js";

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
const AVAILABILITY_TIMEOUT_MS = 2000;

interface ConnectorAvailability {
  connected: string[];
  known: boolean;
  existing: string[];
  catalogKnown: boolean;
}

const UNKNOWN_AVAILABILITY: ConnectorAvailability = {
  connected: [],
  known: false,
  existing: [],
  catalogKnown: false,
};

async function fetchAvailability(
  userId: string | undefined,
  serverTypes: string[],
): Promise<ConnectorAvailability> {
  if (!userId || !SERVER.s2sKey || serverTypes.length === 0) return UNKNOWN_AVAILABILITY;
  try {
    const base = SERVER.authServiceUrl.replace(/\/$/, "");
    const res = await fetch(`${base}/claw/api/v1/internal/connectors/available`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-s2s-key": SERVER.s2sKey },
      body: JSON.stringify({ userId, serverTypes }),
      signal: AbortSignal.timeout(AVAILABILITY_TIMEOUT_MS),
    });
    if (!res.ok) return UNKNOWN_AVAILABILITY;
    const body = (await res.json()) as {
      connected?: unknown;
      known?: unknown;
      existing?: unknown;
      catalogKnown?: unknown;
    };
    if (body.known !== true || !Array.isArray(body.connected)) return UNKNOWN_AVAILABILITY;
    const catalogKnown = body.catalogKnown === true && Array.isArray(body.existing);
    return {
      connected: body.connected.filter((t): t is string => typeof t === "string"),
      known: true,
      existing: catalogKnown
        ? (body.existing as unknown[]).filter((t): t is string => typeof t === "string")
        : [],
      catalogKnown,
    };
  } catch (err) {
    log.warn(
      `[suggest-connectors] availability lookup failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
    );
    return UNKNOWN_AVAILABILITY;
  }
}

export function buildSuggestConnectorsTool(
  ref: SuggestConnectorsRef,
  userId?: string,
): ToolDefinition {
  return {
    name: SUGGEST_CONNECTORS_TOOL_NAME,
    label: "Suggest Connectors",
    description: [
      "Shows connector / MCP cards with Connect buttons. Use it instead of describing",
      "connectors in prose.",
      "",
      "Call it with `listAll: true` (and no serverTypes) whenever the user asks what connectors",
      "or MCPs exist — e.g. \"list all the MCPs\", \"list down all the connectors\", \"what",
      "integrations do we have\", \"show me the MCPs\". Do NOT enumerate them in text: the card",
      "shows a sample plus a Browse button, and the server owns the list.",
      "",
      "Call it with `serverTypes` (most relevant first) only when a connection is genuinely",
      "MISSING and would unblock the work:",
      "  • the user PASTES A LINK to a service you cannot open — a Google Doc/Drive/Sheet, a",
      "    GitHub or Bitbucket repo or PR, a Figma file, a Notion page, a Jira ticket.",
      "  • a task needs an account you have no working tools for (e.g. summarising a Google",
      "    Doc with no Google tools available),",
      "  • the user asks to connect something by name (\"connect Figma\"),",
      "  • a tool you tried FAILED with a permission / auth error (401, 403, \"access denied\").",
      "    That means the shared org account cannot reach THIS user\'s data, and their own",
      "    connection is the fix. Call it even though tools for that service exist.",
      "",
      "Do NOT call it when:",
      "  • you have working tools for that service and they are WORKING — an admin may have",
      "    connected it org-wide, so tools can work without the user connecting anything,",
      "  • the user merely mentions a product by name, or the name appears in a task handed",
      "    to you by another agent,",
      "  • you are only explaining what a connector does.",
      "",
      "The server resolves each type against the catalog and fills in the name, description",
      "and connected state — nothing you write reaches the card. It DROPS a connector the",
      "user has already connected themselves. One shared org-wide is dropped too, UNLESS a",
      "tool call actually failed against it this turn, or the USER asked for it by name —",
      "read from their own message, not from your claim.",
      "",
      "The tool result tells you exactly what will render. Follow it literally:",
      "  • it names the connectors whose cards will appear → you may point at them,",
      "  • it says a connector is NOT available → say so plainly; there is no card to press,",
      "  • it says something is already connected → do not tell the user to connect it again.",
      "Never refer to a card the result did not promise.",
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
      const availability = listAll
        ? UNKNOWN_AVAILABILITY
        : await fetchAvailability(userId, serverTypes);

      const renderable =
        listAll || !availability.catalogKnown
          ? serverTypes
          : serverTypes.filter((t) => availability.existing.includes(t));

      if (!listAll && availability.catalogKnown && renderable.length === 0) {
        log.info(`[suggest-connectors] no catalog entry for: ${serverTypes.join(", ")}`);
        return {
          content: [
            {
              type: "text" as const,
              text: `No connector is available for ${serverTypes.join(", ")}. NO card will be shown. Tell the user plainly that this connector is not available on Xyne yet — do NOT tell them to press Connect or refer to a card.`,
            },
          ],
          details: { serverTypes, unavailable: serverTypes },
        };
      }

      ref.value = { serverTypes: renderable, ...(title ? { title } : {}), ...(listAll ? { listAll: true } : {}) };
      log.info(
        listAll
          ? "[suggest-connectors] queued roster listing"
          : `[suggest-connectors] queued ${serverTypes.length}: ${serverTypes.join(", ")}`,
      );

      const connected = availability.connected.filter((t) => renderable.includes(t));

      const stateNote = connected.length
        ? ` ${connected.join(", ")} ${connected.length === 1 ? "is" : "are"} ALREADY CONNECTED and the card shows it that way — do NOT tell the user to press Connect or link an account for ${connected.length === 1 ? "it" : "them"}; say what you can already do with ${connected.length === 1 ? "it" : "them"}.`
        : availability.known
          ? " None of them are connected yet, so each card carries a Connect button."
          : "";

      return {
        content: [
          {
            type: "text" as const,
            text: listAll
              ? "A connector list with a Browse button will be shown with your reply. Do NOT list the connectors in your text — say at most one short line."
              : `Connector cards for ${renderable.join(", ")} will be shown with your reply. Do NOT list or describe these connectors in your text — say at most one short line about why they help.${stateNote}`,
          },
        ],
        details: { serverTypes: renderable, listAll, ...(availability.known ? { connected } : {}) },
      };
    },
  };
}
