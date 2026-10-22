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
  /** Set for Slack-surface runs: hide private channels the requester is not in. */
  requester?: SlackRequester,
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

  let visible = all;
  if (requester) {
    const requesterPrivate = await requesterPrivateChannelIds(botToken, requester.slackUserId);
    visible = all.filter((c) => !c.is_private || requesterPrivate.has(c.id));
  }

  if (!nameQuery) {
    return JSON.stringify({ scanned: visible.length, channels: visible }, null, 2);
  }

  const exact = visible.filter((c) => c.name.toLowerCase() === nameQuery);
  const matches = exact.length > 0 ? exact : visible.filter((c) => c.name.toLowerCase().includes(nameQuery));
  return JSON.stringify(
    {
      query: nameQuery,
      scanned: visible.length,
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

// ── Requester scoping for Slack-surface runs ──
//
// A run started from Slack reads with the workspace bot's token, and the bot
// can read every channel it was added to. Without these checks a user could
// ask the bot to read a private channel or DM they are not part of. Every
// channel read on a Slack-surface run is checked against the Slack user who
// started the run. Any failed lookup denies the read.

/** connectionId prefix for credentials resolved from the Slack surface bot. */
export const SLACK_SURFACE_CONNECTION_PREFIX = "slack-surface:";

/** Upstream server-slack tools that read a channel's messages. */
const SLACK_CHANNEL_READ_TOOLS = new Set(["slack_get_channel_history", "slack_get_thread_replies"]);

/** Bounds conversations.members / users.conversations paging (1000 per page). */
const MAX_MEMBER_PAGES = 20;

export interface SlackRequester {
  /** Slack user who started the run; undefined when the run context lost it. */
  slackUserId: string | undefined;
}

interface SlackApiResponse {
  ok: boolean;
  error?: string;
  response_metadata?: { next_cursor?: string };
  [key: string]: unknown;
}

async function slackApiGet(
  botToken: string,
  method: string,
  params: Record<string, string>,
): Promise<SlackApiResponse> {
  const url = new URL(`https://slack.com/api/${method}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  let attempts = 0;
  while (true) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${botToken}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 429 && attempts < 3) {
      const retryAfter = Math.min(Number(res.headers.get("retry-after") ?? "2") || 2, 10);
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      attempts++;
      continue;
    }
    if (!res.ok) return { ok: false, error: `http_${res.status}` };
    return (await res.json()) as SlackApiResponse;
  }
}

/** Private channels the requester belongs to (that the bot can also see). Empty on any error. */
async function requesterPrivateChannelIds(botToken: string, slackUserId: string | undefined): Promise<Set<string>> {
  const ids = new Set<string>();
  if (!slackUserId) return ids;
  let cursor = "";
  for (let page = 0; page < MAX_MEMBER_PAGES; page++) {
    const data = await slackApiGet(botToken, "users.conversations", {
      user: slackUserId,
      types: "private_channel",
      exclude_archived: "true",
      limit: "1000",
      ...(cursor ? { cursor } : {}),
    }).catch(() => null);
    if (!data?.ok) return new Set();
    for (const c of (data["channels"] as Array<{ id?: string }> | undefined) ?? []) {
      if (c.id) ids.add(c.id);
    }
    cursor = data.response_metadata?.next_cursor ?? "";
    if (!cursor) break;
  }
  return ids;
}

async function isChannelMember(botToken: string, channelId: string, slackUserId: string): Promise<boolean> {
  let cursor = "";
  for (let page = 0; page < MAX_MEMBER_PAGES; page++) {
    const data = await slackApiGet(botToken, "conversations.members", {
      channel: channelId,
      limit: "1000",
      ...(cursor ? { cursor } : {}),
    });
    if (!data.ok) return false;
    if (((data["members"] as string[] | undefined) ?? []).includes(slackUserId)) return true;
    cursor = data.response_metadata?.next_cursor ?? "";
    if (!cursor) return false;
  }
  return false;
}

/**
 * Whether the requester may read this channel, judged as Slack would judge it
 * for that user: a DM only by its other party, a private channel or group DM
 * only by its members, and a public channel by any full member of the
 * workspace (guests only when they are in it).
 */
export async function canSlackRequesterReadChannel(
  botToken: string,
  slackUserId: string,
  channelId: string,
): Promise<boolean> {
  const info = await slackApiGet(botToken, "conversations.info", { channel: channelId });
  const channel = info["channel"] as
    | { is_im?: boolean; is_mpim?: boolean; is_private?: boolean; is_group?: boolean; user?: string }
    | undefined;
  if (!info.ok || !channel) return false;

  if (channel.is_im) return channel.user === slackUserId;
  if (channel.is_private || channel.is_mpim || channel.is_group) {
    return isChannelMember(botToken, channelId, slackUserId);
  }

  const userInfo = await slackApiGet(botToken, "users.info", { user: slackUserId });
  const user = userInfo["user"] as { is_restricted?: boolean; is_ultra_restricted?: boolean } | undefined;
  if (!userInfo.ok || !user) return false;
  if (user.is_restricted || user.is_ultra_restricted) {
    return isChannelMember(botToken, channelId, slackUserId);
  }
  return true;
}

/**
 * For a Slack-surface run, the reason a channel read must be refused, or null
 * when the call may go ahead. Non-read tools pass through unchanged.
 */
export async function slackSurfaceReadBlockReason(
  credentials: Record<string, unknown>,
  requester: SlackRequester,
  tool: string,
  params: Record<string, unknown>,
): Promise<string | null> {
  if (!SLACK_CHANNEL_READ_TOOLS.has(tool)) return null;
  const botToken = credentials["botToken"] as string | undefined;
  const channelId = typeof params["channel_id"] === "string" ? params["channel_id"].trim() : "";
  if (!botToken || !channelId || !requester.slackUserId) {
    return `Blocked: ${tool} could not confirm that the Slack user who asked can read this channel.`;
  }
  const allowed = await canSlackRequesterReadChannel(botToken, requester.slackUserId, channelId).catch(() => false);
  if (allowed) return null;
  return `Blocked: the Slack user who asked is not a member of channel ${channelId}, so ${tool} cannot read it. Only channels that user can see in Slack can be read.`;
}
