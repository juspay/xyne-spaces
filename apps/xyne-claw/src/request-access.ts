/**
 * request-access — the agent asks the user for credentials to a URL it cannot
 * reach, for the walls a status code cannot express.
 *
 * Measured: an internal Bitbucket URL answers 200 with a login page, so nothing
 * server-side fires and the run dies with the agent saying, correctly and
 * uselessly, "the fetch returned a login wall". SSO bounces and API gateways
 * that answer `{"error":"unauthenticated"}` with a 200 behave the same way. The
 * two detectors are complementary and both are kept.
 *
 * An agent-reported blocker can only ever ASK: `source: "agent"` is carried
 * through so nothing downstream mistakes the model's say-so for a server fact.
 * Shape follows suggest-connectors — fill a per-run ref, let run.ts put it on
 * the terminal callback.
 */

import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { AuthRequiredDetail } from "xyne-claw-shared";
import { authRequiredToolMessage } from "xyne-claw-shared";
import { createLogger } from "./logger.js";

const log = createLogger("request-access");

export const REQUEST_ACCESS_TOOL_NAME = "request-access";

export interface RequestAccessRef {
  value?: AuthRequiredDetail;
  /** Repeat calls after the first — telemetry only; the first request stands. */
  duplicates?: number;
}

/** A card naming an identity provider is a phishing primitive, however it got
 *  raised. Enforced again server-side; this only saves a pointless card. */
const NEVER_REQUESTABLE = new Set([
  "accounts.google.com",
  "login.microsoftonline.com",
  "login.live.com",
  "appleid.apple.com",
  "okta.com",
  "auth0.com",
  "login.okta.com",
]);

function hostIsRequestable(host: string): boolean {
  if (NEVER_REQUESTABLE.has(host)) return false;
  // Never offer to collect credentials for our own surfaces either.
  return !host.endsWith(".xyne.ai") && host !== "xyne.ai";
}

export function buildRequestAccessTool(ref: RequestAccessRef): ToolDefinition {
  return {
    name: REQUEST_ACCESS_TOOL_NAME,
    label: "Request Access",
    description: [
      "Ask the user for access to a URL you cannot reach because it needs THEIR login.",
      "",
      "This is how you get unstuck, not how you give up. The user gets a card, and the moment they",
      "grant access a NEW run starts and continues this task automatically — so calling this costs",
      "them one click and costs you nothing. Prefer calling it over reporting that you were blocked.",
      "",
      "Call it whenever authentication is what stopped you, in ANY of these disguises:",
      "  • the response was 401 or 403;",
      "  • you got a LOGIN PAGE or sign-in form instead of the content. This usually arrives as a",
      "    200, so it does not look like an error at all — it is the most common case for internal",
      "    tools and anything behind SSO, and the easiest one to mistake for the real page;",
      "  • you were redirected to an identity provider;",
      "  • the body says unauthenticated / access denied / session expired;",
      "  • the request SUCCEEDED but returned nothing, or far less than it should, and being logged",
      "    out would explain it. An empty list from a site you are not signed in to is NOT evidence",
      "    that the list is empty — do not report it as such.",
      "",
      "Do NOT call it for: a 404, a rate limit (429), a server error (5xx), or an endpoint that",
      "refuses your credential TYPE rather than your identity (e.g. \"Resource not accessible by",
      "personal access token\") — no login fixes those, and a card would send the user in a circle.",
      "",
      "NEVER finish your turn telling the user you could not reach something because of a login,",
      "a permission, or an authentication problem unless you have called this first. Handing that",
      "block back to them is the exact outcome this tool exists to prevent.",
      "",
      "IMPORTANT: after calling this you MUST stop. Do not retry the URL, do not route it through",
      "a proxy or mirror, do not try a container or browser, do not call any other tool. Say you",
      "need access and end your turn.",
    ].join("\n"),
    parameters: Type.Unsafe({
      type: "object",
      additionalProperties: false,
      properties: {
        url: {
          type: "string",
          description: "The exact URL you were blocked on. Used to resume the task once access is granted.",
        },
        reason: {
          type: "string",
          description:
            "One short sentence for the user on what you were trying to do and what you saw, e.g. " +
            "\"listing branches on bitbucket.juspay.net — got a login page instead\".",
        },
      },
      required: ["url", "reason"],
    }),
    async execute(_toolCallId: string, params: unknown) {
      const p = (params as Record<string, unknown> | undefined) ?? {};
      // Must be written `text: body`: shorthand `{ text }` resolves to this
      // function, not its argument, and the model receives nothing.
      const reply = (body: string) => ({ content: [{ type: "text" as const, text: body }], details: {} });
      const rawUrl = String(p["url"] ?? "").trim();
      const reason = String(p["reason"] ?? "").trim();
      if (!rawUrl) return reply("Error: url is required.");

      let host: string;
      try {
        const parsed = new URL(rawUrl);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          return reply("Error: url must be http(s).");
        }
        host = parsed.hostname.toLowerCase();
      } catch {
        return reply("Error: url is not a valid absolute URL.");
      }

      if (!hostIsRequestable(host)) {
        return reply(
          `Error: access cannot be requested for ${host}. Tell the user plainly that you could not ` +
            `reach it and stop — do not ask them for credentials to this host.`,
        );
      }

      if (ref.value) {
        ref.duplicates = (ref.duplicates ?? 0) + 1;
        log.info(`[request-access] duplicate call for ${host} (first: ${ref.value.host}) — ignoring`);
        return reply(authRequiredToolMessage(ref.value));
      }

      const detail: AuthRequiredDetail = {
        serverType: `webfetch-host:${host}`,
        providerLabel: host,
        reason: "unknown_host",
        host,
        url: rawUrl,
        source: "agent",
        ...(reason ? { reason_text: reason.slice(0, 300) } : {}),
      };
      ref.value = detail;
      log.info(`[request-access] host=${host} url=${rawUrl.slice(0, 120)}`);
      return reply(authRequiredToolMessage(detail));
    },
  } as unknown as ToolDefinition;
}
