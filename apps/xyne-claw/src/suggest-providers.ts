import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { createLogger } from "./logger.js";
import { SERVER } from "./config.js";

const log = createLogger("suggest-providers");

export const SUGGEST_PROVIDERS_TOOL_NAME = "suggest-providers";

const MAX_SUGGESTIONS = 6;
const AVAILABILITY_TIMEOUT_MS = 2000;

export interface PendingProviderSuggestions {
  providers: string[];
  title?: string;
  listAll?: boolean;
}

export interface SuggestProvidersRef {
  value?: PendingProviderSuggestions;
  duplicates?: number;
}

interface ProviderAvailability {
  connected: string[];
  existing: string[];
  unknown: string[];
  known: boolean;
}

const UNKNOWN_AVAILABILITY: ProviderAvailability = {
  connected: [],
  existing: [],
  unknown: [],
  known: false,
};

async function fetchAvailability(
  userId: string | undefined,
  providers: string[],
): Promise<ProviderAvailability> {
  if (!userId || !SERVER.s2sKey || providers.length === 0) return UNKNOWN_AVAILABILITY;
  try {
    const base = SERVER.authServiceUrl.replace(/\/$/, "");
    const res = await fetch(`${base}/claw/api/v1/internal/providers/available`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-s2s-key": SERVER.s2sKey },
      body: JSON.stringify({ userId, providers }),
      signal: AbortSignal.timeout(AVAILABILITY_TIMEOUT_MS),
    });
    if (!res.ok) return UNKNOWN_AVAILABILITY;
    const body = (await res.json()) as {
      connected?: unknown;
      existing?: unknown;
      unknown?: unknown;
      known?: unknown;
    };
    if (!Array.isArray(body.existing)) return UNKNOWN_AVAILABILITY;
    const asStrings = (value: unknown): string[] =>
      Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
    return {
      connected: asStrings(body.connected),
      existing: asStrings(body.existing),
      unknown: asStrings(body.unknown),
      known: body.known === true,
    };
  } catch (err) {
    log.warn(
      `[suggest-providers] availability lookup failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
    );
    return UNKNOWN_AVAILABILITY;
  }
}

export function buildSuggestProvidersTool(
  ref: SuggestProvidersRef,
  userId?: string,
): ToolDefinition {
  return {
    name: SUGGEST_PROVIDERS_TOOL_NAME,
    label: "Suggest AI Providers",
    description: [
      "Shows AI PROVIDER cards with Connect buttons — the user's own ChatGPT, Claude,",
      "Copilot, OpenRouter or LiteLLM account. Use it instead of describing providers in prose.",
      "",
      "Call it with `listAll: true` (and no providers) ONLY when the user asks what AI",
      'providers or accounts THEY can connect — e.g. "what AI providers do I have", "show me',
      'the providers I can connect", "how do I use my own ChatGPT account".',
      "",
      "Call it with `providers` ONLY when the user explicitly asks to connect, switch or sign",
      'in to a named provider — "connect me to Claude", "I want to use my own ChatGPT",',
      '"set up Copilot".',
      "",
      "Do NOT call it when:",
      "  • the user asks what MODEL YOU are running — that is your own configuration, not",
      "    their accounts. Answer from your run context instead; there is no card for it.",
      "  • a model or provider name merely appears in the task — \"use opus for this\",",
      '    "summarise this GPT output", "draft an agent that uses anthropic". Naming a model',
      "    is not a request to connect an account.",
      "  • the question is about an AGENT's provider or model configuration — that lives in",
      "    the agent's own settings, not in the user's provider accounts.",
      "  • you are only explaining what a provider is.",
      "",
      "The server owns the roster and fills in each provider's name, description and connected",
      "state — nothing you write reaches the card. It DROPS a provider the user is already",
      "connected to, unless they asked to see the whole list.",
      "",
      "The tool result tells you exactly what will render. Follow it literally:",
      "  • it names the providers whose cards will appear → you may point at them,",
      "  • it says a provider is NOT available → say so plainly; there is no card to press,",
      "  • it says one is already connected → do not tell the user to connect it again.",
      "Never refer to a card the result did not promise.",
      "",
      "This does not end your turn. Call it at most once per reply.",
    ].join("\n"),
    parameters: Type.Unsafe({
      type: "object",
      additionalProperties: false,
      properties: {
        providers: {
          type: "array",
          items: { type: "string" },
          description:
            "Provider names the user asked to connect, most relevant first. e.g. ['claude','codex']. Aliases like 'anthropic' or 'chatgpt' are resolved by the server.",
        },
        listAll: {
          type: "boolean",
          description:
            "True ONLY when the user asked to see every provider they can connect and you name none. Ignored when providers is non-empty.",
        },
        title: {
          type: "string",
          description: "Optional heading, e.g. 'Connect Claude to continue'.",
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
              text: "Provider cards are already queued for this reply. Do not call suggest-providers again; continue with the rest of your answer.",
            },
          ],
          details: { duplicate: true },
        };
      }

      const p = (params as Record<string, unknown> | undefined) ?? {};
      const raw = Array.isArray(p["providers"]) ? (p["providers"] as unknown[]) : [];
      const providers = [
        ...new Set(
          raw
            .filter((t): t is string => typeof t === "string")
            .map((t) => t.trim())
            .filter((t) => t.length > 0),
        ),
      ].slice(0, MAX_SUGGESTIONS);

      const listAll = p["listAll"] === true && providers.length === 0;

      if (providers.length === 0 && !listAll) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Rejected: name at least one provider in `providers`, or pass `listAll: true` to show what the user can connect.",
            },
          ],
          details: { rejected: true },
        };
      }

      const title = typeof p["title"] === "string" ? p["title"].trim().slice(0, 120) : "";
      const availability = listAll
        ? UNKNOWN_AVAILABILITY
        : await fetchAvailability(userId, providers);

      const renderable = listAll || !availability.known ? providers : availability.existing;
      const unknownNames = listAll || !availability.known ? [] : availability.unknown;

      if (!listAll && availability.known && renderable.length === 0) {
        log.info(`[suggest-providers] no roster entry for: ${providers.join(", ")}`);
        return {
          content: [
            {
              type: "text" as const,
              text: `${providers.join(", ")} ${providers.length === 1 ? "is" : "are"} not available on Xyne. NO card will be shown. Tell the user plainly — do NOT tell them to press Connect or refer to a card.`,
            },
          ],
          details: { providers, unavailable: providers },
        };
      }

      ref.value = {
        providers: renderable,
        ...(title ? { title } : {}),
        ...(listAll ? { listAll: true } : {}),
      };
      log.info(
        listAll
          ? "[suggest-providers] queued roster listing"
          : `[suggest-providers] queued ${renderable.length}: ${renderable.join(", ")}`,
      );

      if (listAll) {
        return {
          content: [
            {
              type: "text" as const,
              text: "A card listing every AI provider the user can connect will be shown, with each one's connected state. Do NOT enumerate the providers in your reply — point at the card.",
            },
          ],
          details: { listAll: true },
        };
      }

      const connected = availability.connected.filter((t) => renderable.includes(t));
      const toConnect = renderable.filter((t) => !connected.includes(t));

      const connectedNote = connected.length
        ? ` ${connected.join(", ")} ${connected.length === 1 ? "is" : "are"} ALREADY CONNECTED — no card is shown for ${connected.length === 1 ? "it" : "them"}. Do NOT tell the user to press Connect or link an account for ${connected.length === 1 ? "it" : "them"}.`
        : "";
      const unknownNote = unknownNames.length
        ? ` ${unknownNames.join(", ")} ${unknownNames.length === 1 ? "is" : "are"} not available on Xyne — say so plainly and do not refer to a card for ${unknownNames.length === 1 ? "it" : "them"}.`
        : "";
      const cardNote = toConnect.length
        ? `A Connect card will be shown for ${toConnect.join(", ")}.`
        : "NO card will be shown.";

      return {
        content: [{ type: "text" as const, text: `${cardNote}${connectedNote}${unknownNote}` }],
        details: { providers: renderable, connected, toConnect, unknown: unknownNames },
      };
    },
  };
}
