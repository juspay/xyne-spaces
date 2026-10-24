import { roomAllows, type BotUser, type SpacesScopeRef } from "./spaces-scope.js";

/**
 * What a proactivity run may touch, enforced at the MCP call boundary in routes/mcp.ts
 * rather than in the prompt.
 *
 * Read-only, hard. A write tool is normally downgraded to "ask", which queues an
 * approval card; nobody asked for this run, so for it every write is a refusal.
 *
 * Reads stay in the room. The answer lands where everyone in the channel reads it, so
 * Spaces reads are limited to an allowlist of tools that name what they read, and what
 * they name must be this channel or a public one. Anything else in Spaces is refused,
 * including broad searches that would cover private channels the bot is in.
 *
 * Connectors are the agent's own: knowledge bases and servers pinned to the agent.
 * Never the asker's, never an org-wide fallback.
 */

export const PROACTIVITY_TRIGGER = "proactivity";

export const SPACES_SERVERS = new Set(["xyne-spaces", "xyne-spaces-app-tools"]);

/** Posting as the bot is not marked a write in the app-tools adapter, but it is the one write that matters. */
const ALWAYS_DENIED = new Set(["apps-send-message", "user-send-message"]);

/** Spaces tools that read only workspace metadata, never message content. */
const METADATA_TOOLS = new Set([
  "spaces-users",
  "spaces-whoami",
  "spaces-channels",
  "spaces-boards",
  "spaces-board-fields",
  "spaces-projects",
]);

export function isProactivityRun(triggerSource: string | undefined | null): boolean {
  return triggerSource === PROACTIVITY_TRIGGER;
}

export type ProactivityVerdict =
  | { allow: true; params: Record<string, unknown> }
  | { allow: false; message: string };

const denied = (tool: string): ProactivityVerdict => ({
  allow: false,
  message: `Blocked: this run answers a question nobody tagged you in, so it is read-only. ${tool} is not available here; answer from what you can read, or return an empty reply.`,
});

const outOfRoom: ProactivityVerdict = {
  allow: false,
  message:
    "Blocked: this answer will be read by everyone in the channel, so you can only read this channel and public channels. Name the channel, thread or message you want to read.",
};

/**
 * Every channel a reference lives in must be this room, or public in the room's
 * workspace. With a guest in the room only the room itself: guests don't see public
 * channels, and the answer is posted where they read it.
 */
async function inRoom(bot: BotUser | null, refs: SpacesScopeRef[], roomChannelId: string): Promise<boolean> {
  if (refs.length === 0) return false;
  if (refs.every((ref) => ref.kind === "channel" && ref.id === roomChannelId)) return true;
  return bot ? roomAllows(bot, roomChannelId, refs) : false;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The search operators that name channels to look in, rather than ones to leave out. */
const POSITIVE_OPS = new Set(["contains", "in", "containsAny"]);

const str = (value: unknown): string | undefined => (typeof value === "string" && value.trim() ? value.trim() : undefined);

/**
 * Whether a proactivity run may make this call, and with which arguments. The room is
 * filled in where a Spaces read would otherwise go workspace-wide.
 */
export async function checkProactivityCall(input: {
  serverType: string;
  tool: string;
  params: Record<string, unknown>;
  isWriteTool: boolean;
  isAgentConnector: boolean;
  roomChannelId: string;
  /** The agent's bot, as which Spaces says where a read lands. */
  bot: BotUser | null;
}): Promise<ProactivityVerdict> {
  const { serverType, tool, isWriteTool, roomChannelId } = input;
  const params = { ...input.params };
  if (isWriteTool || ALWAYS_DENIED.has(tool)) return denied(tool);

  if (!SPACES_SERVERS.has(serverType)) {
    return input.isAgentConnector ? { allow: true, params } : denied(tool);
  }
  if (!roomChannelId) return outOfRoom;
  if (METADATA_TOOLS.has(tool)) return { allow: true, params };

  switch (tool) {
    case "spaces-vespa-search": {
      // Scoped by filters.channelId; the room when the model named none. Only the
      // positive operators: `nin` would mean "everywhere but", which is not a scope.
      const filters = isPlainObject(params["filters"]) ? { ...params["filters"] } : {};
      const bag = filters["channelId"];
      let named: string[] = [roomChannelId];
      if (bag !== undefined) {
        if (!isPlainObject(bag) || !Object.keys(bag).every((op) => POSITIVE_OPS.has(op))) return outOfRoom;
        named = Object.values(bag).flatMap((value) => (Array.isArray(value) ? value : [value])).filter(
          (value): value is string => typeof value === "string" && value.trim() !== "",
        );
      }
      if (!(await inRoom(input.bot, named.map((id) => ({ kind: "channel", id })), roomChannelId))) return outOfRoom;
      filters["channelId"] = named.length === 1 ? { contains: named[0] } : { in: named };
      return { allow: true, params: { ...params, filters } };
    }
    case "spaces-messages":
    case "spaces-thread-attachments": {
      const conversationId = str(params["conversationId"]);
      if (!conversationId || !(await inRoom(input.bot, [{ kind: "conversation", id: conversationId }], roomChannelId))) return outOfRoom;
      return { allow: true, params };
    }
    case "spaces-message-detail": {
      const messageId = str(params["messageId"]);
      if (!messageId || !(await inRoom(input.bot, [{ kind: "message", id: messageId }], roomChannelId))) return outOfRoom;
      return { allow: true, params };
    }
    case "spaces-tickets": {
      const ticketId = str(params["ticketId"]) ?? str(params["xyneId"]);
      if (ticketId) {
        return (await inRoom(input.bot, [{ kind: "ticket", id: ticketId }], roomChannelId)) ? { allow: true, params } : outOfRoom;
      }
      // A filtered list is limited to one channel, the room unless another public one is named.
      const channelId = str(params["channelId"]) ?? roomChannelId;
      if (!(await inRoom(input.bot, [{ kind: "channel", id: channelId }], roomChannelId))) return outOfRoom;
      return { allow: true, params: { ...params, channelId } };
    }
    default:
      return outOfRoom;
  }
}
