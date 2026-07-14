import { prisma } from "../db.js";
import type { UserProviderCredentials, SharedProviderCredential } from "@prisma/client";

/** Binding rows (sharedCredentialId set) carry no key material — substitute
 *  the shared credential's secret + defaults, keeping this row's model/
 *  baseUrl/reasoningEffort as personal overrides. Mirrors the agent-side
 *  materializer in agentProviderCredentialsRepository. */
function materialize(
  row: UserProviderCredentials & { sharedCredential: SharedProviderCredential | null },
): UserProviderCredentials {
  const { sharedCredential: shared, ...rest } = row;
  if (!row.sharedCredentialId || !shared) return rest;
  return {
    ...rest,
    encryptedKey: shared.encryptedKey,
    iv: shared.iv,
    authTag: shared.authTag,
    authType: shared.authType,
    model: rest.model ?? shared.model,
    baseUrl: rest.baseUrl ?? shared.baseUrl,
    reasoningEffort: rest.reasoningEffort ?? shared.reasoningEffort,
  };
}

export const userProviderCredentialsRepository = {
  findByUserAndProvider: async (userId: string, provider: string): Promise<UserProviderCredentials | null> => {
    const row = await prisma.userProviderCredentials.findUnique({
      where: { userId_provider: { userId, provider } },
      include: { sharedCredential: true },
    });
    return row ? materialize(row) : null;
  },

  listByUser: async (userId: string): Promise<UserProviderCredentials[]> => {
    const rows = await prisma.userProviderCredentials.findMany({
      where: { userId },
      include: { sharedCredential: true },
    });
    return rows.map(materialize);
  },

  upsert: (userId: string, provider: string, data: Record<string, unknown>) =>
    prisma.userProviderCredentials.upsert({
      where: { userId_provider: { userId, provider } },
      create: { userId, provider, ...data } as never,
      // Writing own key material converts a binding back into a dedicated
      // credential (same rule as the agent-side repository).
      update: "encryptedKey" in data ? { ...data, sharedCredentialId: null } : data,
    }),

  /** Bind the user's provider slot to a shared credential. */
  bindShared: (userId: string, provider: string, sharedCredentialId: string, overrides?: { model?: string | null; reasoningEffort?: string | null }) =>
    prisma.userProviderCredentials.upsert({
      where: { userId_provider: { userId, provider } },
      create: {
        userId,
        provider,
        sharedCredentialId,
        encryptedKey: null,
        iv: null,
        authTag: null,
        model: overrides?.model ?? null,
        reasoningEffort: overrides?.reasoningEffort ?? null,
      },
      update: {
        sharedCredentialId,
        encryptedKey: null,
        iv: null,
        authTag: null,
        ...(overrides ? { model: overrides.model ?? null, reasoningEffort: overrides.reasoningEffort ?? null } : {}),
      },
    }),

  delete: (userId: string, provider: string) =>
    prisma.userProviderCredentials.delete({ where: { userId_provider: { userId, provider } } }),
};
