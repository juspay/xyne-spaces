import { Prisma, type ChatConversationMeta } from "@prisma/client";
import { prisma } from "../db.js";
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

  byConversationIds: async (
    conversationIds: string[],
    userIds: string | string[],
    agentSlug: string,
  ): Promise<Map<string, { title: string | null; pinned: boolean }>> => {
    if (conversationIds.length === 0) return new Map();
    const rows = await prisma.chatConversationMeta.findMany({
      where: { conversationId: { in: conversationIds }, ...userIdFilter(userIds), agentSlug },
      select: { conversationId: true, title: true, pinned: true },
    });
    return new Map(
      rows.map((row) => [row.conversationId, { title: row.title, pinned: row.pinned }] as const),
    );
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
