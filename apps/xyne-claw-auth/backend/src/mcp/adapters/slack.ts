import type { StdioMcpAdapter, McpToolInfo } from "../types.js";

export const slackAdapter: StdioMcpAdapter = {
  transport: "stdio",
  type: "slack",
  healthCheck: { name: "slack_list_channels", params: {} },
  writeTools: ["slack_post_message", "slack_reply_to_thread", "slack_add_reaction"],
  credentialFields: [
    { name: "botToken", label: "Slack Bot Token", type: "password", placeholder: "xoxb-xxxxxxxxxxxx-xxxxxxxxxxxx" },
    { name: "teamId", label: "Slack Team ID", type: "text", placeholder: "T01234567" },
  ],
  buildCommand(credentials) {
    const botToken = credentials["botToken"] as string;
    const teamId = credentials["teamId"] as string;

    return {
      cmd: "npx",
      args: ["-y", "@modelcontextprotocol/server-slack@2025.4.25"],
      env: {
        SLACK_BOT_TOKEN: botToken,
        SLACK_TEAM_ID: teamId,
      },
    };
  },
};

// ── Custom Slack tools (handled locally, not forwarded to the MCP server) ──
//
// The official @modelcontextprotocol/server-slack `slack_list_channels` calls
// conversations.list with a hardcoded `types: "public_channel"` and returns a
// single page (default 100, max 200, no auto-paging). So it can NEVER return
// private channels, and misses public channels past the first page. That makes
// resolving a channel NAME → ID unreliable (the "name fails / ID works" bug).
//
// slack_find_channel fixes resolution: it walks conversations.list with
// types=public_channel,private_channel AND full cursor pagination, so it sees
// private channels the bot is a member of (requires the `groups:read` scope)
// and the entire public list. Returns the matching channel id(s).

export const SLACK_CUSTOM_TOOLS: McpToolInfo[] = [
  {
    name: "slack_find_channel",
    description:
      "Resolve a Slack channel by NAME to its channel ID — including PRIVATE channels, which the built-in slack_list_channels cannot return (it is public-only and single-page). " +
      "Walks conversations.list with types=public_channel,private_channel and full cursor pagination. " +
      "Pass `name` to resolve a specific channel (exact match preferred, falls back to substring); omit `name` to list every channel the bot can see. " +
      "Requires the Slack app to have `channels:read` + `groups:read` scopes and the bot to be a member of any private channel. " +
      "Use this (not slack_list_channels) whenever you only have a channel name and need its ID.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Channel name to resolve (with or without a leading '#'). Omit to list all visible channels.",
        },
        maxScan: {
          type: "number",
          description: "Safety cap on how many channels to scan across pages (default 3000). Increase only for very large workspaces.",
        },
      },
      required: [],
    },
  },
];

interface SlackChannel {
  id: string;
  name: string;
  is_private: boolean;
  is_member: boolean;
  num_members: number;
}

interface SlackConversationsListResponse {
  ok: boolean;
  error?: string;
  channels?: Array<{
    id: string;
    name: string;
    is_private?: boolean;
    is_member?: boolean;
    num_members?: number;
  }>;
  response_metadata?: { next_cursor?: string };
}

/**
 * Resolve a Slack channel name → ID by walking conversations.list (public +
 * private, fully paginated). Handles the bot-token auth, Slack rate limits
 * (429 + Retry-After), and the common `missing_scope` error with an actionable
 * message. Returns JSON the agent can read directly.
 */
export async function handleSlackFindChannel(
  credentials: Record<string, unknown>,
  params: Record<string, unknown>,
): Promise<string> {
  const botToken = credentials["botToken"] as string | undefined;
  if (!botToken) {
    throw new Error("slack_find_channel: Slack bot token not configured for this connection.");
  }

  const nameQuery = (params["name"] as string | undefined)?.trim().replace(/^#/, "").toLowerCase() || "";
  const maxScan = typeof params["maxScan"] === "number" && params["maxScan"] > 0 ? (params["maxScan"] as number) : 3000;
  const PAGE = 200;
  const maxPages = Math.ceil(maxScan / PAGE) + 1;

  const all: SlackChannel[] = [];
  let cursor = "";
  let pages = 0;

  while (pages < maxPages) {
    const url = new URL("https://slack.com/api/conversations.list");
    url.searchParams.set("types", "public_channel,private_channel");
    url.searchParams.set("exclude_archived", "true");
    url.searchParams.set("limit", String(PAGE));
    if (cursor) url.searchParams.set("cursor", cursor);

    let res: Response;
    let attempts = 0;
    // Slack conversations.list is Tier-2 (~20 req/min). On a 429, honor
    // Retry-After (capped) and retry a few times before giving up.
    while (true) {
      res = await fetch(url, {
        headers: { Authorization: `Bearer ${botToken}` },
        signal: AbortSignal.timeout(20_000),
      });
      if (res.status !== 429 || attempts >= 3) break;
      const retryAfter = Math.min(Number(res.headers.get("retry-after") ?? "2") || 2, 10);
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      attempts++;
    }

    if (res.status === 429) {
      // Exhausted retries — return what we have rather than failing outright.
      break;
    }

    const data = (await res.json()) as SlackConversationsListResponse;
    if (!data.ok) {
      if (data.error === "missing_scope") {
        throw new Error(
          "slack_find_channel: the Slack app is missing a required scope. Add `channels:read` and `groups:read` " +
            "(groups:read is needed for private channels), then reinstall the app to the workspace.",
        );
      }
      throw new Error(`slack_find_channel: Slack API error: ${data.error ?? "unknown"}`);
    }

    for (const c of data.channels ?? []) {
      all.push({
        id: c.id,
        name: c.name,
        is_private: c.is_private ?? false,
        is_member: c.is_member ?? false,
        num_members: c.num_members ?? 0,
      });
    }

    pages++;
    cursor = data.response_metadata?.next_cursor ?? "";
    if (!cursor || all.length >= maxScan) break;
  }

  if (!nameQuery) {
    return JSON.stringify({ scanned: all.length, channels: all }, null, 2);
  }

  const exact = all.filter((c) => c.name.toLowerCase() === nameQuery);
  const matches = exact.length > 0 ? exact : all.filter((c) => c.name.toLowerCase().includes(nameQuery));
  return JSON.stringify(
    {
      query: nameQuery,
      scanned: all.length,
      matchType: exact.length > 0 ? "exact" : matches.length > 0 ? "contains" : "none",
      matches,
      ...(matches.length === 0
        ? { hint: "No channel matched. If it is private, ensure the bot is a member and the app has groups:read. Otherwise verify the name spelling." }
        : {}),
    },
    null,
    2,
  );
}
