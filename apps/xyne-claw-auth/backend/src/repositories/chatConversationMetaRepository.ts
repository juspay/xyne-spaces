import { Prisma, type ChatConversationMeta } from "@prisma/client";
import { prisma } from "../db.js";
import { isDirectChatConversation } from "../lib/conversation-kind.js";
import { userIdFilter } from "./userIdFilter.js";

interface MetaKey {
  conversationId: string;
  userId: string;
  agentSlug: string;
}

const byKey = (key: MetaKey) => ({
  conversationId_userId_agentSlug: {
    conversationId: key.conversationId,
    userId: key.userId,
    agentSlug: key.agentSlug,
  },
});

export const chatConversationMetaRepository = {
  find: (key: MetaKey): Promise<ChatConversationMeta | null> =>
    prisma.chatConversationMeta.findUnique({ where: byKey(key) }),

  /**
   * The agentSlug a conversation's meta row (title, pin) is keyed by. A direct
   * chat can switch agents mid-conversation, so its meta lives on its home
   * agent's row — the agent of its first message: renaming from agent B's list
   * and title generation after B's first reply both land on the row A's list
   * reads. Every other conversation, and every chat that never switched,
   * resolves to the request's own slug — exactly the row it used before.
   */
  metaAgentSlug: async (conversationId: string, requestSlug: string): Promise<string> => {
    if (!isDirectChatConversation(conversationId)) return requestSlug;
    const first = await prisma.chatMessage
      .findFirst({ where: { conversationId }, orderBy: { createdAt: "asc" }, select: { agentSlug: true } })
      .catch(() => null);
    return first?.agentSlug ?? requestSlug;
  },

  /** One user's meta rows for these conversations under ANY agent. A direct
   *  chat that switched agents keeps its title on its home agent's row, so the
   *  sidebar resolves the row per conversation instead of per list slug. Rows
   *  may be keyed by either of the caller's verified ids (see userIdFilter). */
  forConversationsAnyAgent: (
    conversationIds: string[],
    userIds: string | string[],
  ): Promise<Array<{ conversationId: string; agentSlug: string; title: string | null; pinned: boolean }>> => {
    if (conversationIds.length === 0) return Promise.resolve([]);
    return prisma.chatConversationMeta.findMany({
      where: { conversationId: { in: conversationIds }, ...userIdFilter(userIds) },
      select: { conversationId: true, agentSlug: true, title: true, pinned: true },
    });
  },

  /** `conversationId:agentSlug` of every meta row this user has pinned — the
   *  first page of the chat list carries all of them, however old. */
  pinnedKeys: async (userIds: string | string[]): Promise<Set<string>> => {
    const rows = await prisma.chatConversationMeta.findMany({
      where: { ...userIdFilter(userIds), pinned: true },
      select: { conversationId: true, agentSlug: true },
    });
    return new Set(rows.map((row) => `${row.conversationId}:${row.agentSlug}`));
  },

  /**
   * Fills an EMPTY title only, and reports whether it wrote. Generation runs a
   * completion that can take 45s, so the "is it still unnamed?" check made
   * before the call is stale by the time the answer lands — an unconditional
   * write would silently clobber a rename made in between. The guard is in the
   * WHERE clause rather than a re-read, so a rename committing between the
   * read and the write still wins.
   */
  fillTitleIfEmpty: async (
    args: MetaKey & { orgId: string; title: string },
  ): Promise<boolean> => {
    const updated = await prisma.chatConversationMeta.updateMany({
      where: {
        conversationId: args.conversationId,
        userId: args.userId,
        agentSlug: args.agentSlug,
        title: null,
      },
      data: { title: args.title, titleGeneratedAt: new Date() },
    });
    if (updated.count > 0) return true;

    // No row matched: either none exists yet, or one exists and is already
    // named. Creating covers the first; a unique violation means a rename beat
    // us to it, which is the outcome we want.
    try {
      await prisma.chatConversationMeta.create({
        data: {
          conversationId: args.conversationId,
          userId: args.userId,
          agentSlug: args.agentSlug,
          orgId: args.orgId,
          title: args.title,
          titleGeneratedAt: new Date(),
        },
      });
      return true;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        return false;
      }
      throw err;
    }
  },

  setTitle: (args: MetaKey & { orgId: string; title: string }): Promise<ChatConversationMeta> =>
    prisma.chatConversationMeta.upsert({
      where: byKey(args),
      create: {
        conversationId: args.conversationId,
        userId: args.userId,
        agentSlug: args.agentSlug,
        orgId: args.orgId,
        title: args.title,
      },
      update: { title: args.title },
    }),

  setPinned: (args: MetaKey & { orgId: string; pinned: boolean }): Promise<ChatConversationMeta> =>
    prisma.chatConversationMeta.upsert({
      where: byKey(args),
      create: {
        conversationId: args.conversationId,
        userId: args.userId,
        agentSlug: args.agentSlug,
        orgId: args.orgId,
        pinned: args.pinned,
      },
      update: { pinned: args.pinned },
    }),
};
