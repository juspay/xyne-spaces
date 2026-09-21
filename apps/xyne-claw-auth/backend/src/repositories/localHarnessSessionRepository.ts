import type { LocalHarnessSession } from "@prisma/client";
import { prisma } from "../db.js";

export const localHarnessSessionRepository = {
  find: (conversationId: string, provider: string): Promise<LocalHarnessSession | null> =>
    prisma.localHarnessSession.findUnique({
      where: { conversationId_provider: { conversationId, provider } },
    }),

  upsertSessionId: (args: {
    userId: string;
    conversationId: string;
    provider: string;
    cliSessionId: string;
  }): Promise<LocalHarnessSession> =>
    prisma.localHarnessSession.upsert({
      where: { conversationId_provider: { conversationId: args.conversationId, provider: args.provider } },
      create: {
        userId: args.userId,
        conversationId: args.conversationId,
        provider: args.provider,
        cliSessionId: args.cliSessionId,
      },
      update: { cliSessionId: args.cliSessionId },
    }),

  upsertArchive: (args: {
    userId: string;
    conversationId: string;
    provider: string;
    cliSessionId: string;
    storagePath: string;
    sizeBytes: number;
  }): Promise<LocalHarnessSession> =>
    prisma.localHarnessSession.upsert({
      where: { conversationId_provider: { conversationId: args.conversationId, provider: args.provider } },
      create: {
        userId: args.userId,
        conversationId: args.conversationId,
        provider: args.provider,
        cliSessionId: args.cliSessionId,
        storagePath: args.storagePath,
        sizeBytes: args.sizeBytes,
      },
      update: {
        cliSessionId: args.cliSessionId,
        storagePath: args.storagePath,
        sizeBytes: args.sizeBytes,
      },
    }),

  clearForConversation: async (conversationId: string): Promise<number> => {
    const result = await prisma.localHarnessSession.deleteMany({ where: { conversationId } });
    return result.count;
  },

  listForConversation: (conversationId: string): Promise<LocalHarnessSession[]> =>
    prisma.localHarnessSession.findMany({
      where: { conversationId },
      orderBy: { updatedAt: "desc" },
    }),
};
