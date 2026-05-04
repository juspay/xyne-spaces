import { prisma } from "../db.js";

export const userProviderCredentialsRepository = {
  findByUserAndProvider: (userId: string, provider: string) =>
    prisma.userProviderCredentials.findUnique({ where: { userId_provider: { userId, provider } } }),

  listByUser: (userId: string) =>
    prisma.userProviderCredentials.findMany({ where: { userId } }),

  upsert: (userId: string, provider: string, data: Record<string, unknown>) =>
    prisma.userProviderCredentials.upsert({
      where: { userId_provider: { userId, provider } },
      create: { userId, provider, ...data } as never,
      update: data,
    }),

  delete: (userId: string, provider: string) =>
    prisma.userProviderCredentials.delete({ where: { userId_provider: { userId, provider } } }),
};
