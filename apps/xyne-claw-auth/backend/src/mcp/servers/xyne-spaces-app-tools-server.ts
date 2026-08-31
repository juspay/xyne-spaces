/**
 * Xyne Spaces App Tools MCP server — standalone process for agent-level write tools.
 *
 * This server hosts tools that execute using the agent's app token (bot credentials),
 * NOT the user's OAuth token. It is intentionally separate from xyne-spaces-server
 * so the LLM sees a clear boundary: xyne-spaces = user-token tools, this server = app/bot tools.
 *
 * No user approval is required — the bot acts autonomously using its own app token.
 * The XYNE_SPACES_APP_TOKEN is injected via the adapter's buildCommand from the agent's
 * stored spacesAppToken credential.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { errMsg } from "../../lib/errors.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { expandSpacesMentions, resolveUnboundMentions } from "../../lib/mention-transform.js";
import { buildSpacesMentionLookupsDb } from "../../lib/mention-lookups.js";
import { spacesDbAvailable } from "../../lib/spaces-db.js";
import { tools as spacesTools } from "./xyne-spaces-tools.js";

const APP_TOKEN = process.env["XYNE_SPACES_APP_TOKEN"] ?? "";
const SPACES_URL = process.env["XYNE_SPACES_URL"] ?? "";
const WORKSPACE_ID = process.env["XYNE_SPACES_WORKSPACE_ID"]?.trim() ?? "";
const USER_ID = process.env["XYNE_USER_ID"] ?? "";

const COUNT_USER_MENTION_RE =
  /(^|[^A-Za-z0-9_>])@([A-Za-z0-9 ._\-']+?)\[([A-Za-z0-9_-]{8,64})\]/g;
const COUNT_GROUP_MENTION_RE =
  /(^|[^A-Za-z0-9_>])@([A-Za-z0-9 ._\-']+?)\[group:([A-Za-z0-9_-]{8,64}):([^\]]+)\]/g;

function countBracketedMentions(input: string): number {
  const parts = input.split(/(```[\s\S]*?```)/g);
  let count = 0;
  for (let i = 0; i < parts.length; i += 2) {
    count += [...parts[i]!.matchAll(COUNT_USER_MENTION_RE)].length;
    count += [...parts[i]!.matchAll(COUNT_GROUP_MENTION_RE)].length;
  }
  return count;
}

async function prepareMessageContent(rawContent: string): Promise<string> {
  let resolved = rawContent;
  let resolvedCount = 0;

  if (!WORKSPACE_ID) {
    console.warn("[apps-send-message] mention resolution skipped reason=no_workspace_id");
  } else if (!spacesDbAvailable()) {
    console.warn("[apps-send-message] mention resolution skipped reason=spaces_db_unavailable");
  } else {
    try {
      const beforeCount = countBracketedMentions(rawContent);
      resolved = await resolveUnboundMentions(
        rawContent,
        buildSpacesMentionLookupsDb(WORKSPACE_ID),
      );
      resolvedCount = Math.max(0, countBracketedMentions(resolved) - beforeCount);
    } catch (err) {
      resolved = rawContent;
      console.warn(
        `[apps-send-message] mention resolution skipped reason=error err=${errMsg(err)}`,
      );
    }
  }

  console.error(
    `[apps-send-message] mention resolution resolved-count=${resolvedCount} workspaceId=${WORKSPACE_ID || "(none)"}`,
  );
  return expandSpacesMentions(resolved);
}

async function spacesAppFetch(path: string, body: Record<string, unknown>): Promise<unknown> {
  const url = `${SPACES_URL}/api/apps${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${APP_TOKEN}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Spaces app API ${res.status}: ${text.slice(0, 500)}`);
  }

  return res.json();
}

const server = new Server(
  { name: "xyne-spaces-app-tools", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

const PING_TOOL = {
  name: "ping",
  description: "Health check — returns ok immediately, no external calls.",
  inputSchema: { type: "object" as const, properties: {} },
};

const SEND_MESSAGE_TOOL = {
  name: "apps-send-message",
  description:
    "Send a message to a DIFFERENT thread or channel — NOT the one the user is chatting with you in — using the BOT'S app credentials (NOT the user's token). " +
    "The message appears in Spaces with the bot's name + avatar, not the human's. " +
    "" +
    "DO NOT use this tool to reply in the SAME thread the user is already chatting with you in — " +
    "your normal text response IS automatically posted back to that thread by the framework. " +
    "Calling this tool with the same conversationId would post a duplicate. " +
    "" +
    "Correct uses: " +
    "(a) cross-channel announcement / broadcast (use targetChannelId), " +
    "(b) run-completion pings to a different thread / channel, " +
    "(c) scheduled-job alerts the bot fires autonomously, " +
    "(d) when the user explicitly says 'post this to #other-channel as the bot'. " +
    "" +
    "Wrong uses: ANY normal answer to the user's current question (just return the text — the framework posts it). " +
    "" +
    "If the human asks you to write something on THEIR behalf (so it shows up as them), " +
    "use `user-send-message` instead. " +
    "" +
    "Mention shorthand (server-expanded): `@Name[userId]` for a user, `@Alias[group:GROUP_ID:Group Name]` " +
    "for a group, or `@channel` / `@here` for specials. Resolve userId first via spaces-users / " +
    "spaces-search / spaces-whoami — never invent one. " +
    "" +
    "Simple usage: provide conversationId (reply in a DIFFERENT thread), channelId (post in a DIFFERENT channel), " +
    "or targetUserId (open/find a bot DM with that user and post there) with content. " +
    "Use targetUserId for personal DMs; do not pass a human-human DM conversationId/channelId because the bot is not a participant there. " +
    "Cross-channel posting: provide targetChannelId to post in a different channel — the bot auto-joins PUBLIC channels " +
    "and reports failure for PRIVATE channels. When targetChannelId is set, confirms the action in the source thread.",
  inputSchema: {
    type: "object" as const,
    properties: {
      content: { type: "string", description: "Message content to post (supports HTML for @mentions)" },
      conversationId: { type: "string", description: "Reply in this conversation thread (used when no targetChannelId)" },
      channelId: { type: "string", description: "Post in this channel (used when no targetChannelId and no conversationId)" },
      targetChannelId: { type: "string", description: "Cross-channel posting: Channel ID to post in. Posts there and confirms in source thread." },
      targetUserId: { type: "string", description: "Personal DM posting: user ID to DM as the bot. Opens/finds a bot↔user DM before posting." },
      sourceConversationId: { type: "string", description: "Source conversation/thread ID for the confirmation reply when using targetChannelId (auto-detected from session if omitted)" },
    },
    required: ["content"],
  },
};

// The app-tools server is the SOLE Spaces MCP for automation/app-user runs
// (routes/mcp.ts injects it INSTEAD of the user `xyne-spaces` server for those
// runs). So it must surface the full Spaces toolset — reuse the SAME shared
// registry the user server uses, running every tool in app mode. Local `ping`
// + `apps-send-message` are app-tools-only and are appended. For every other
// run, routes/mcp.ts reduces this server's listing to the app-only tools —
// so nothing changes for interactive users.
//
// `userOnly` tools are excluded here: this server ALWAYS runs in app mode, and
// those tools either act as the human or hit user-session-only routes — they
// could only 401. Never list a tool that cannot succeed.
const REGISTRY_TOOL_DEFS = spacesTools
  .filter((t) => !t.userOnly)
  .map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [...REGISTRY_TOOL_DEFS, PING_TOOL, SEND_MESSAGE_TOOL],
}));

server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
  const { name, arguments: args } = request.params;

  if (name === "ping") {
    return { content: [{ type: "text", text: "ok" }] };
  }

  // Accept legacy `spaces-send-message` name as an alias so any agent or
  // chain config that still references the old name continues to work.
  if (name === "apps-send-message" || name === "spaces-send-message") {
    if (!APP_TOKEN || !SPACES_URL) {
      return {
        content: [{ type: "text", text: "XYNE_SPACES_APP_TOKEN or XYNE_SPACES_URL not set — server misconfigured." }],
        isError: true,
      };
    }
    try {
      const rawContent = String((args as Record<string, unknown>)["content"] ?? "");
      const conversationId = (args as Record<string, unknown>)["conversationId"] as string | undefined;
      const channelId = (args as Record<string, unknown>)["channelId"] as string | undefined;
      const targetChannelId = (args as Record<string, unknown>)["targetChannelId"] as string | undefined;
      const targetUserId = (args as Record<string, unknown>)["targetUserId"] as string | undefined;
      const sourceConversationId = ((args as Record<string, unknown>)["sourceConversationId"] as string | undefined) ?? conversationId;
      // Resolve bare `@Name` / `@email` / dotted handles first, then
      // deterministically expand bracketed shorthand into Spaces' HTML spans.
      const content = await prepareMessageContent(rawContent);

      if (targetUserId) {
        // Personal DM: a human-human DM does not include the bot, so first
        // open/find the bot↔user DM with app credentials, then post there.
        const dmRequest = WORKSPACE_ID ? { targetUserId, workspaceId: WORKSPACE_ID } : { targetUserId };
        const dm = (await spacesAppFetch("/channel/openDm", dmRequest)) as { channelId?: string };
        if (!dm.channelId) {
          throw new Error("Spaces app API returned no channelId for bot DM");
        }
        await spacesAppFetch("/chat/postMessage", { channelId: dm.channelId, text: content });
        return { content: [{ type: "text", text: `Message sent to DM with ${targetUserId}` }] };
      }

      if (!targetChannelId) {
        // Simple send: conversationId → reply in thread, channelId → post in channel
        const body = conversationId
          ? { conversationId, text: content }
          : { channelId, text: content };
        await spacesAppFetch("/chat/postMessage", body);
        return { content: [{ type: "text", text: `Message sent to ${conversationId ?? channelId}` }] };
      }

      // Cross-channel: join (idempotent) then post
      let channelName = targetChannelId;
      try {
        const joinRes = (await spacesAppFetch(`/channel/${targetChannelId}/join`, {})) as { channelName?: string };
        channelName = joinRes.channelName ?? targetChannelId;
      } catch (e) {
        const errText = errMsg(e);
        if (errText.includes("private")) {
          const failMsg = `❌ I need to be added to #${targetChannelId} (private channel) to post there. Please add me and try again.`;
          if (sourceConversationId) {
            await spacesAppFetch("/chat/postMessage", { conversationId: sourceConversationId, text: failMsg }).catch(() => {});
          }
          return { content: [{ type: "text", text: failMsg }], isError: true };
        }
        // Non-fatal join error — still attempt the post
        console.error("[apps-send-message] join failed (will still attempt post):", e);
      }

      await spacesAppFetch("/chat/postMessage", { channelId: targetChannelId, text: content });

      const confirmMsg = `✅ Posted in #${channelName}`;
      if (sourceConversationId) {
        await spacesAppFetch("/chat/postMessage", { conversationId: sourceConversationId, text: confirmMsg }).catch(() => {});
      }

      return { content: [{ type: "text", text: confirmMsg }] };
    } catch (e) {
      const msg = errMsg(e);
      return { content: [{ type: "text", text: `apps-send-message error: ${msg}` }], isError: true };
    }
  }

  // Any other tool name → the shared Spaces registry, run in APP MODE: prefer a
  // tool's dedicated app-token implementation (`appHandler`, the /api/apps/*
  // route) and otherwise fall through to its regular `handler`, which hits the
  // app-token-capable /api/*/claw endpoints. This is the same dispatch the user
  // `xyne-spaces` server uses in app mode — kept identical so behaviour matches.
  const registryTool = spacesTools.find((t) => t.name === name);
  if (registryTool) {
    if (registryTool.userOnly) {
      return {
        content: [{
          type: "text",
          text: `${name} requires the human user's session and is not available in app mode (automation runs act as the bot).`,
        }],
        isError: true,
      };
    }
    const ctx = { userId: USER_ID, authMode: "app" as const };
    const result = registryTool.appHandler
      ? await registryTool.appHandler(args ?? {}, ctx)
      : await registryTool.handler(args ?? {}, ctx);
    return result as CallToolResult;
  }

  return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
});

const transport = new StdioServerTransport();
await server.connect(transport);

process.on("SIGINT", async () => {
  await server.close();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await server.close();
  process.exit(0);
});
