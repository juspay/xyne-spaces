import { interact, type QueryAST, type SpacesAuthContext } from "../mcp/servers/xyne-spaces-client.js";
import { createLogger } from "../logger.js";
import { errMsg } from "./errors.js";

const log = createLogger("spaces-post-target");

export interface SpacesPostTarget {
  channelName: string | null;
  thread?: { author: string | null; html: string };
}

async function first<T>(query: QueryAST, auth: SpacesAuthContext): Promise<T | undefined> {
  const rows = (await interact(query, auth)) as T[] | undefined;
  return Array.isArray(rows) ? rows[0] : undefined;
}

export async function spacesConversationExists(conversationId: string, auth: SpacesAuthContext): Promise<boolean | null> {
  try {
    const conv = await first<{ conversationId?: string }>(
      { model: "conversation", operation: "findMany", where: { conversationId: { equals: conversationId } }, take: 1 },
      auth,
    );
    return conv !== undefined;
  } catch (err) {
    log.warn(`[post-target] conversation-exists conversationId=${conversationId} err=${errMsg(err)}`);
    return null;
  }
}

export async function getSpacesPostTarget(
  target: { channelId?: string; conversationId?: string },
  auth: SpacesAuthContext,
): Promise<SpacesPostTarget | null> {
  try {
    let channelId = target.channelId ?? "";
    let thread: SpacesPostTarget["thread"];
    if (target.conversationId) {
      const conv = await first<{ channelId?: string }>(
        { model: "conversation", operation: "findMany", where: { conversationId: { equals: target.conversationId } }, take: 1 },
        auth,
      );
      channelId = conv?.channelId ?? channelId;
      const opening = await first<{ content?: string; senderId?: string }>(
        {
          model: "message",
          operation: "findMany",
          where: { conversationId: { equals: target.conversationId }, isDeleted: { equals: false } },
          orderBy: [{ createdAt: "asc" }],
          take: 1,
        },
        auth,
      );
      if (opening) {
        const sender = opening.senderId
          ? await first<{ name?: string }>({ model: "user", operation: "findMany", where: { id: { equals: opening.senderId } }, take: 1 }, auth)
          : undefined;
        thread = { author: sender?.name ?? null, html: opening.content ?? "" };
      }
    }
    const channel = channelId
      ? await first<{ name?: string }>({ model: "channel", operation: "findMany", where: { id: { equals: channelId } }, take: 1 }, auth)
      : undefined;
    return { channelName: channel?.name ?? null, ...(thread ? { thread } : {}) };
  } catch (err) {
    log.warn(`[post-target] channelId=${target.channelId ?? ""} conversationId=${target.conversationId ?? ""} err=${errMsg(err)}`);
    return null;
  }
}
