import type { UserExternalToken } from '@prisma/client';
import { db } from '../../re-exports';

export interface SaveUserTokenInput {
  userId: string;
  workspaceId: string;
  provider: string;
  providerUserId: string;
  encryptedToken: string;
}

/**
 * People's own provider tokens, in the repo's UserExternalToken table. A Spaces user row belongs to one
 * workspace, so one row per (user, provider) is one token per person per workspace.
 */
export class UserTokenRepository {
  async findByUser(userId: string, provider: string): Promise<UserExternalToken | null> {
    return await db.userExternalToken.findUnique({
      where: { userId_provider: { userId, provider } },
    });
  }

  async save(data: SaveUserTokenInput): Promise<void> {
    const connectedAt = new Date();
    await db.userExternalToken.upsert({
      where: { userId_provider: { userId: data.userId, provider: data.provider } },
      create: { ...data, connectedAt },
      update: {
        providerUserId: data.providerUserId,
        encryptedToken: data.encryptedToken,
        connectedAt,
      },
    });
  }

  async deleteByUser(userId: string, provider: string): Promise<void> {
    await db.userExternalToken.deleteMany({ where: { userId, provider } });
  }

  async deleteByWorkspace(workspaceId: string, provider: string): Promise<void> {
    await db.userExternalToken.deleteMany({ where: { workspaceId, provider } });
  }
}
