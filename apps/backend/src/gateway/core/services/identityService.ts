import { findOrCreateApp, findOrCreateUser, repositories } from '../../re-exports';
import type { BaseApi } from '../base/baseApi';
import type { BaseProvider } from '../base/baseProvider';
import type { ProviderMessage, ProviderUser } from '../types';

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

  /** Finds or creates the Spaces user for a provider person; null for bots and unknown users. */
  async findOrCreateSpacesUser(
    api: BaseApi,
    workspaceId: string,
    externalUserId: string
  ): Promise<string | null> {
    const known = await this.findSpacesUserId(workspaceId, externalUserId);
    if (known) return known;

    const info = await api.findUser(externalUserId);
    if (!info || info.isBot) return null;

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
    return await findOrCreateApp(
      message.authorName ?? message.botId,
      message.botId,
      new Map(),
      message.authorId,
      workspaceId
    );
  }

  async findExternalUserId(api: BaseApi, spacesUserId: string): Promise<string | null> {
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
  async findExternalUser(api: BaseApi, spacesUserId: string): Promise<ProviderUser | null> {
    const externalUserId = await this.findExternalUserId(api, spacesUserId);
    return externalUserId ? await api.findUser(externalUserId) : null;
  }
}
