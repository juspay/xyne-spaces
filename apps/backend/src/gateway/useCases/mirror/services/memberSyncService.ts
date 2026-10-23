import { db, logger, repositories } from '../../../re-exports';
import { GatewayError } from '../../../core/errors';
import type { SpacesMemberChange } from '../../../core/types';
import type { IdentityService } from '../../../core/services/identityService';
import type { MirrorApi, MirrorConnection, MirrorLink } from '../types';

/** Additions sync both ways in every channel, apps included; removals only when both channels are private. */
export class MemberSyncService {
  constructor(private readonly identity: IdentityService) {}

  /** On link: adds each side's members to the other. Never removes anyone. */
  async seedMembers(link: MirrorLink, connection: MirrorConnection): Promise<void> {
    const api = connection.api;
    const externalMembers = await api.listMembers(link.externalId);
    for (const externalUserId of externalMembers) {
      if (externalUserId !== connection.workspace.botUserId)
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
    connection: MirrorConnection,
    change: SpacesMemberChange
  ): Promise<void> {
    const api = connection.api;
    const externalUserId = await this.identity.findExternalUserId(api, change.userId);
    if (!externalUserId || externalUserId === connection.workspace.botUserId) return;

    if (change.type === 'added') {
      await api.inviteMembers(link.externalId, [externalUserId]);
    } else if (await this.isPrivateOnBothSides(api, link)) {
      await api.removeMember(link.externalId, externalUserId);
    }
  }

  async applyProviderMemberChange(
    link: MirrorLink,
    connection: MirrorConnection,
    event: { type: 'member_joined' | 'member_left'; userId: string }
  ): Promise<void> {
    if (event.userId === connection.workspace.botUserId) {
      if (event.type === 'member_left')
        throw new GatewayError('CHANNEL_GONE', 'The bot was removed from the channel');
      return;
    }

    const api = connection.api;
    if (event.type === 'member_joined') {
      await this.addMemberToSpaces(api, link, event.userId);
      return;
    }
    if (!(await this.isPrivateOnBothSides(api, link))) return;

    const userId = await this.identity.findSpacesUserId(link.workspaceId, event.userId);
    if (userId) await repositories.channelParticipants.removeParticipant(link.spacesId, userId);
  }

  private async isPrivateOnBothSides(api: MirrorApi, link: MirrorLink): Promise<boolean> {
    const [external, spaces] = await Promise.all([
      api.getChannel(link.externalId),
      db.channel.findUnique({ where: { id: link.spacesId }, select: { visibility: true } }),
    ]);
    return external.isPrivate && spaces?.visibility === 'PRIVATE';
  }

  private async addMemberToSpaces(
    api: MirrorApi,
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
