import type { ChatConversationMeta } from "@prisma/client";
import { prisma } from "../db.js";

export const chatConversationMetaRepository = {
  find: (conversationId: string): Promise<ChatConversationMeta | null> =>
    prisma.chatConversationMeta.findUnique({ where: { conversationId } }),

  byConversationIds: async (
    conversationIds: string[],
  ): Promise<Map<string, { title: string | null; pinned: boolean }>> => {
    if (conversationIds.length === 0) return new Map();
    const rows = await prisma.chatConversationMeta.findMany({
      where: { conversationId: { in: conversationIds } },
      select: { conversationId: true, title: true, pinned: true },
    });
    return new Map(
      rows.map((row) => [row.conversationId, { title: row.title, pinned: row.pinned }] as const),
    );
  },

  upsertTitle: (args: {
    conversationId: string;
    userId: string;
    agentSlug: string;
    orgId: string;
    title: string;
  }): Promise<ChatConversationMeta> =>
    prisma.chatConversationMeta.upsert({
      where: { conversationId: args.conversationId },
      create: {
        conversationId: args.conversationId,
        userId: args.userId,
        agentSlug: args.agentSlug,
        orgId: args.orgId,
        title: args.title,
        titleGeneratedAt: new Date(),
      },
      update: { title: args.title, titleGeneratedAt: new Date() },
    }),

  setTitle: (args: {
    conversationId: string;
    userId: string;
    agentSlug: string;
    orgId: string;
    title: string;
  }): Promise<ChatConversationMeta> =>
    prisma.chatConversationMeta.upsert({
      where: { conversationId: args.conversationId },
      create: {
        conversationId: args.conversationId,
        userId: args.userId,
        agentSlug: args.agentSlug,
        orgId: args.orgId,
        title: args.title,
      },
      update: { title: args.title },
    }),

  setPinned: (args: {
    conversationId: string;
    userId: string;
    agentSlug: string;
    orgId: string;
    pinned: boolean;
  }): Promise<ChatConversationMeta> =>
    prisma.chatConversationMeta.upsert({
      where: { conversationId: args.conversationId },
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
