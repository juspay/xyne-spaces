import {
  acquireLock,
  findOrCreateApp,
  findOrCreateUser,
  releaseLock,
  repositories,
} from '../../re-exports';
import { gatewayConfig } from '../../config';
import type { DirectoryApi } from '../base/baseApi';
import type { BaseProvider } from '../base/baseProvider';
import { GatewayError } from '../errors';
import type { ProviderMessage, ProviderUser } from '../types';

const APP_LOCK_WAIT_MS = 10_000;

/** Maps people between Spaces and the provider, the same way self-serve migration does. */
export class IdentityService {
  constructor(private readonly provider: BaseProvider) {}

  async findSpacesUserId(workspaceId: string, externalUserId: string): Promise<string | null> {
    const user = await repositories.users.findByMetadataField(
      this.provider.userMetadataKey,
      externalUserId,
      workspaceId
    );
    return user?.id ?? null;
  }

  /** Finds or creates the Spaces user for a provider person or app; null when neither can be made. */
  async findOrCreateSpacesUser(
    api: DirectoryApi,
    workspaceId: string,
    externalUserId: string
  ): Promise<string | null> {
    const known = await this.findSpacesUserId(workspaceId, externalUserId);
    if (known) return known;

    const info = await api.findUser(externalUserId);
    if (!info) return null;
    if (info.isBot) {
      return info.botId
        ? await this.findOrCreateSpacesApp(workspaceId, info.name, info.botId, externalUserId)
        : null;
    }

    const existing = await repositories.users.findByEmailCaseInsensitive(info.email, workspaceId);
    const userId =
      existing?.id ??
      (await findOrCreateUser(
        info.email,
        info.name,
        info.deleted,
        repositories.users,
        undefined,
        workspaceId
      ));
    await repositories.users.upsertMetaDataField(
      userId,
      this.provider.userMetadataKey,
      externalUserId
    );
    return userId;
  }

  async findOrCreateSpacesBot(
    workspaceId: string,
    message: ProviderMessage
  ): Promise<string | null> {
    if (!message.botId) return null;
    return await this.findOrCreateSpacesApp(
      workspaceId,
      message.authorName ?? message.botId,
      message.botId,
      message.authorId
    );
  }

  private async findOrCreateSpacesApp(
    workspaceId: string,
    name: string,
    botId: string,
    botUserId: string | undefined
  ): Promise<string> {
    const lock = await acquireLock(`gateway:app:${workspaceId}:${botId}`, {
      ttlSeconds: gatewayConfig.lockTtlSeconds,
      waitTimeoutMs: APP_LOCK_WAIT_MS,
    });
    if (!lock) throw new GatewayError('LOCK_HELD', 'This app is still being created');
    try {
      return await findOrCreateApp(name, botId, new Map(), botUserId, workspaceId);
    } finally {
      await releaseLock(lock);
    }
  }

  async findExternalUserId(api: DirectoryApi, spacesUserId: string): Promise<string | null> {
    const user = await repositories.users.findById(spacesUserId);
    if (!user) return null;

    const known = (user.metadata as Record<string, unknown> | null)?.[
      this.provider.userMetadataKey
    ];
    if (typeof known === 'string') return known;

    const externalUserId = await api.findUserIdByEmail(user.email);
    if (externalUserId)
      await repositories.users.upsertMetaDataField(
        user.id,
        this.provider.userMetadataKey,
        externalUserId
      );
    return externalUserId;
  }

  /** The Spaces user's own provider profile, when they have one there. */
  async findExternalUser(api: DirectoryApi, spacesUserId: string): Promise<ProviderUser | null> {
    const externalUserId = await this.findExternalUserId(api, spacesUserId);
    return externalUserId ? await api.findUser(externalUserId) : null;
  }
}
