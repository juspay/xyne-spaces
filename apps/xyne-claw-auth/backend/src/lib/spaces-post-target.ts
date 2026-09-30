import { interact, type QueryAST, type SpacesAuthContext } from "../mcp/servers/xyne-spaces-client.js";
import { createLogger } from "../logger.js";
import { errMsg } from "./errors.js";

const log = createLogger("spaces-post-target");

export interface SpacesPostTarget {
  channelName: string | null;
  directMessage?: { with: string[] };
  thread?: { author: string | null; html: string };
}

const MEMBER_ID_LIST = /^[A-Za-z0-9_-]{8,64}(,[A-Za-z0-9_-]{8,64})+$/;

export function looksLikeMemberIdList(name: string | null | undefined): boolean {
  return !!name && MEMBER_ID_LIST.test(name.trim());
}

export function directMessageMemberIds(channel: { name?: string | null; scopeType?: string | null } | undefined): string[] | null {
  if (!channel) return null;
  const isDm = channel.scopeType === "DM" || channel.scopeType === "GROUP_DM" || looksLikeMemberIdList(channel.name);
  if (!isDm) return null;
  return looksLikeMemberIdList(channel.name) || /^[A-Za-z0-9_-]{8,64}$/.test(channel.name?.trim() ?? "")
    ? (channel.name ?? "").split(",").map((id) => id.trim()).filter(Boolean)
    : [];
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
  target: { channelId?: string; conversationId?: string; recipientUserId?: string },
  auth: SpacesAuthContext,
  actingUserId?: string,
): Promise<SpacesPostTarget | null> {
  try {
    if (target.recipientUserId && !target.channelId && !target.conversationId) {
      const recipient = await first<{ name?: string }>(
        { model: "user", operation: "findMany", where: { id: { equals: target.recipientUserId } }, take: 1 },
        auth,
      );
      const name = recipient?.name?.trim();
      return { channelName: null, directMessage: { with: name ? [name] : [] } };
    }
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
      ? await first<{ name?: string; scopeType?: string }>({ model: "channel", operation: "findMany", where: { id: { equals: channelId } }, take: 1 }, auth)
      : undefined;
    const memberIds = directMessageMemberIds(channel);
    if (memberIds) {
      const others = memberIds.filter((id) => id !== actingUserId);
      const users = others.length
        ? ((await interact({ model: "user", operation: "findMany", where: { id: { in: others } }, take: others.length }, auth)) as Array<{ name?: string }> | undefined)
        : [];
      const names = (Array.isArray(users) ? users : []).map((u) => u.name?.trim() ?? "").filter(Boolean);
      return { channelName: null, directMessage: { with: names }, ...(thread ? { thread } : {}) };
    }
    return { channelName: channel?.name ?? null, ...(thread ? { thread } : {}) };
  } catch (err) {
    log.warn(`[post-target] channelId=${target.channelId ?? ""} conversationId=${target.conversationId ?? ""} recipientUserId=${target.recipientUserId ?? ""} err=${errMsg(err)}`);
    return null;
  }
}
