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
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { expandSpacesMentions } from "../../lib/mention-transform.js";

const APP_TOKEN = process.env["XYNE_SPACES_APP_TOKEN"] ?? "";
const SPACES_URL = process.env["XYNE_SPACES_URL"] ?? "";

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
    "Simple usage: provide conversationId (reply in a DIFFERENT thread) or channelId (post in a DIFFERENT channel) with content. " +
    "Cross-channel posting: provide targetChannelId to post in a different channel — the bot auto-joins PUBLIC channels " +
    "and reports failure for PRIVATE channels. When targetChannelId is set, confirms the action in the source thread.",
  inputSchema: {
    type: "object" as const,
    properties: {
      content: { type: "string", description: "Message content to post (supports HTML for @mentions)" },
      conversationId: { type: "string", description: "Reply in this conversation thread (used when no targetChannelId)" },
      channelId: { type: "string", description: "Post in this channel (used when no targetChannelId and no conversationId)" },
      targetChannelId: { type: "string", description: "Cross-channel posting: Channel ID to post in. Posts there and confirms in source thread." },
      sourceConversationId: { type: "string", description: "Source conversation/thread ID for the confirmation reply when using targetChannelId (auto-detected from session if omitted)" },
    },
    required: ["content"],
  },
};

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [PING_TOOL, SEND_MESSAGE_TOOL],
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
      // Deterministically expand `@Name[userId]` shorthand into the HTML span
      // Spaces needs. Idempotent on already-expanded content.
      const content = expandSpacesMentions(rawContent);
      const conversationId = (args as Record<string, unknown>)["conversationId"] as string | undefined;
      const channelId = (args as Record<string, unknown>)["channelId"] as string | undefined;
      const targetChannelId = (args as Record<string, unknown>)["targetChannelId"] as string | undefined;
      const sourceConversationId = ((args as Record<string, unknown>)["sourceConversationId"] as string | undefined) ?? conversationId;

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
        const errMsg = e instanceof Error ? e.message : String(e);
        if (errMsg.includes("private")) {
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
      const msg = e instanceof Error ? e.message : String(e);
      return { content: [{ type: "text", text: `apps-send-message error: ${msg}` }], isError: true };
    }
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
