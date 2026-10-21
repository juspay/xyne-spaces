import { logger, repositories } from '../../../re-exports';
import type { BaseApi } from '../../../core/base/baseApi';
import type { BaseProvider } from '../../../core/base/baseProvider';
import { GatewayError } from '../../../core/errors';
import type { ProviderConfig, SpacesMemberChange } from '../../../core/types';
import type { IdentityService } from '../../../core/services/identityService';
import type { MirrorLink } from '../types';

/** Additions sync both ways in every channel; removals only in private channels. */
export class MemberSyncService {
  constructor(
    private readonly provider: BaseProvider,
    private readonly identity: IdentityService
  ) {}

  /** On link: adds each side's members to the other. Never removes anyone. */
  async seedMembers(link: MirrorLink, config: ProviderConfig): Promise<void> {
    const api = this.provider.createApi(config.credentials);
    const externalMembers = await api.listMembers(link.externalId);
    for (const externalUserId of externalMembers) {
      if (externalUserId !== config.workspace.botUserId)
        await this.addMemberToSpaces(api, link, externalUserId);
    }

    const inChannel = new Set(externalMembers);
    const participants = await repositories.channelParticipants.getChannelParticipants(
      link.spacesId
    );
    const toInvite: string[] = [];
    for (const { userId } of participants) {
      const externalUserId = await this.identity.findExternalUserId(api, userId);
      if (externalUserId && !inChannel.has(externalUserId)) toInvite.push(externalUserId);
    }
    if (toInvite.length > 0) await api.inviteMembers(link.externalId, toInvite);
  }

  async applySpacesMemberChange(
    link: MirrorLink,
    config: ProviderConfig,
    change: SpacesMemberChange
  ): Promise<void> {
    const api = this.provider.createApi(config.credentials);
    const externalUserId = await this.identity.findExternalUserId(api, change.userId);
    if (!externalUserId || externalUserId === config.workspace.botUserId) return;

    if (change.type === 'added') {
      await api.inviteMembers(link.externalId, [externalUserId]);
    } else if ((await api.getChannel(link.externalId)).isPrivate) {
      await api.removeMember(link.externalId, externalUserId);
    }
  }

  async applyProviderMemberChange(
    link: MirrorLink,
    config: ProviderConfig,
    event: { type: 'member_joined' | 'member_left'; userId: string }
  ): Promise<void> {
    if (event.userId === config.workspace.botUserId) {
      if (event.type === 'member_left')
        throw new GatewayError('CHANNEL_GONE', 'The bot was removed from the channel');
      return;
    }

    const api = this.provider.createApi(config.credentials);
    if (event.type === 'member_joined') {
      await this.addMemberToSpaces(api, link, event.userId);
      return;
    }
    if (!(await api.getChannel(link.externalId)).isPrivate) return;

    const userId = await this.identity.findSpacesUserId(link.workspaceId, event.userId);
    if (userId) await repositories.channelParticipants.removeParticipant(link.spacesId, userId);
  }

  private async addMemberToSpaces(
    api: BaseApi,
    link: MirrorLink,
    externalUserId: string
  ): Promise<void> {
    const userId = await this.identity.findOrCreateSpacesUser(
      api,
      link.workspaceId,
      externalUserId
    );
    if (!userId) {
      logger.info('[Mirror] Member skipped: no Spaces user', { linkId: link.id, externalUserId });
      return;
    }
    await repositories.channelParticipants.addParticipant(link.spacesId, userId);
  }
}
