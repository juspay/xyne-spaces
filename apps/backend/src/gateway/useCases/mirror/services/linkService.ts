import { Prisma } from '@prisma/client';
import {
  ChannelScopeType,
  db,
  isDeskChannelType,
  logger,
  withWorkspaceScope,
} from '../../../re-exports';
import type { BaseProvider } from '../../../core/base/baseProvider';
import { GatewayError } from '../../../core/errors';
import { PairRepository } from '../../../core/repositories/pairRepository';
import { SyncRequestRepository } from '../repositories/syncRequestRepository';
import { SourceRepository } from '../../../core/repositories/sourceRepository';
import type { ProviderConfig, ProviderChannel } from '../../../core/types';
import type { ConfigService } from '../../../core/services/configService';
import type { IdentityService } from '../../../core/services/identityService';
import { MIRROR_SOURCE_SUFFIX, type MirrorLink } from '../types';
import type { MemberSyncService } from './memberSyncService';

// Unique, so there is one link per provider channel; (spacesId, sourceType) keeps one per Spaces channel.
const linkName = (connectionId: string, externalChannelId: string): string =>
  `mirror-link-${connectionId}-${externalChannelId}`;

export interface LinkInput {
  spacesChannelId: string;
  externalChannelId: string;
}

export interface LinkView {
  link: MirrorLink;
  externalChannel: ProviderChannel | null;
}

/** One Spaces channel ⇄ one provider channel, enforced by two unique keys on the link's PAIR row. */
export class LinkService {
  private readonly pairs = new PairRepository(MIRROR_SOURCE_SUFFIX);
  private readonly requests = new SyncRequestRepository();
  private readonly sources = new SourceRepository();

  constructor(
    private readonly provider: BaseProvider,
    private readonly config: ConfigService,
    private readonly identity: IdentityService,
    private readonly members: MemberSyncService
  ) {}

  async findChannelLink(spacesChannelId: string): Promise<LinkView | null> {
    const link = await this.pairs.findBySpacesId(spacesChannelId);
    if (!link) return null;
    return { link, externalChannel: await this.findExternalChannel(link) };
  }

  async findActiveLink(
    connectionId: string,
    externalChannelId: string
  ): Promise<MirrorLink | null> {
    const link = await this.pairs.findByName(linkName(connectionId, externalChannelId));
    return link?.status === 'ACTIVE' ? link : null;
  }

  /** The synced Spaces channels the user is in, so every message box checks one cached list. */
  async listSyncedChannelIds(workspaceId: string, userId: string): Promise<string[]> {
    const channelIds = await this.pairs.listActiveSpacesIds(workspaceId);
    if (channelIds.length === 0) return [];
    const memberships = await db.channelParticipant.findMany({
      where: { userId, channelId: { in: channelIds } },
      select: { channelId: true },
    });
    return memberships.map((membership) => membership.channelId);
  }

  /** Provider channels the user and the bot share, minus linked, requested and desk channels. */
  async listLinkableChannels(workspaceId: string, userId: string): Promise<ProviderChannel[]> {
    const config = await this.config.getConfigByWorkspace(workspaceId);
    const api = this.provider.createApi(config.credentials);
    const externalUserId = await this.identity.findExternalUserId(api, userId);
    if (!externalUserId) return [];

    const [channels, links] = await Promise.all([
      api.listSharedChannels(externalUserId),
      this.pairs.listByConnection(config.sourceId),
    ]);
    const requested = await this.requests.findPendingExternalIds(
      workspaceId,
      channels.map((channel) => channel.id)
    );
    const linked = new Set(links.map((link) => link.externalId));
    const free = channels.filter(
      (channel) => !linked.has(channel.id) && !requested.has(channel.id)
    );
    const deskNames = free
      .map((channel) => this.provider.deskSourceName(channel.id))
      .filter((name): name is string => !!name);
    const desks = await this.sources.findActiveNames(deskNames);
    return free.filter((channel) => !desks.has(this.provider.deskSourceName(channel.id) ?? ''));
  }

  /**
   * Checks a link could be made now: both channels free and not a desk, and the person and the app both
   * in the provider channel. Returns that channel. `subject` names the person in the error.
   */
  async assertCanLink(
    workspaceId: string,
    userId: string,
    config: ProviderConfig,
    input: LinkInput,
    subject = 'You'
  ): Promise<ProviderChannel> {
    await this.assertLinkable(workspaceId, config, input);
    return await this.findSharedChannel(userId, config, input.externalChannelId, subject);
  }

  /** Links an approved request. The checks run again as the requester, whom incoming events act as. */
  async linkChannel(workspaceId: string, userId: string, input: LinkInput): Promise<MirrorLink> {
    const config = await this.config.getConfigByWorkspace(workspaceId);
    await this.assertCanLink(workspaceId, userId, config, input, 'The requester');

    const link = await this.createLink({
      name: linkName(config.sourceId, input.externalChannelId),
      sourceType: `${this.provider.id}${MIRROR_SOURCE_SUFFIX}`,
      displayName: 'Mirror link',
      workspaceId,
      connectionId: config.sourceId,
      externalId: input.externalChannelId,
      spacesId: input.spacesChannelId,
      createdBy: userId,
    });
    await this.sources.ensureMessageSource(this.buildMessageSource(link, config), link, true);

    // Seeding acts for the whole channel, not just the caller, and runs after the response.
    void withWorkspaceScope(() => this.members.seedMembers(link, config)).catch((error) =>
      logger.error('[Mirror] Member seed failed', { linkId: link.id, error })
    );
    return link;
  }

  async pauseLink(workspaceId: string, linkId: string): Promise<MirrorLink> {
    const link = await this.getLinkById(workspaceId, linkId);
    return await this.pairs.setStatus(link.id, 'PAUSED');
  }

  /** Resumes only when the config is active and the bot can still see the channel. */
  async resumeLink(workspaceId: string, linkId: string): Promise<MirrorLink> {
    const link = await this.getLinkById(workspaceId, linkId);
    const config = await this.config.getConfigBySource(link.connectionId);
    await this.provider.createApi(config.credentials).getChannel(link.externalId);
    await this.sources.ensureMessageSource(this.buildMessageSource(link, config), link, true);
    return await this.pairs.setStatus(link.id, 'ACTIVE');
  }

  /** The message map stays in ExternalMessage, so relinking the same pair picks up without duplicates. */
  async unlinkChannel(workspaceId: string, linkId: string): Promise<void> {
    const link = await this.getLinkById(workspaceId, linkId);
    await this.pairs.delete(link.id);
  }

  /** PROVIDER_AUTH pauses every link on the config; CHANNEL_GONE pauses this one. */
  async pauseOnError(link: MirrorLink, error: GatewayError): Promise<void> {
    logger.warn('[Mirror] Pausing on provider error', {
      linkId: link.id,
      code: error.code,
      error: error.message,
    });
    if (error.code === 'PROVIDER_AUTH') {
      await this.pairs.pauseByConnection(link.connectionId, error.code);
    } else {
      await this.pairs.setStatus(link.id, 'PAUSED', error.code);
    }
  }

  private async assertLinkable(
    workspaceId: string,
    config: ProviderConfig,
    input: LinkInput
  ): Promise<void> {
    const channel = await db.channel.findUnique({
      where: { id: input.spacesChannelId },
      select: { workspaceId: true, type: true, scopeType: true },
    });
    if (
      !channel ||
      channel.workspaceId !== workspaceId ||
      channel.scopeType !== ChannelScopeType.DEFAULT
    ) {
      throw new GatewayError('VALIDATION_ERROR', 'Only a channel in this workspace can be linked');
    }
    if (isDeskChannelType(channel.type)) {
      throw new GatewayError('CHANNEL_TAKEN', 'A desk channel cannot be linked');
    }

    const [spacesLink, externalLink] = await Promise.all([
      this.pairs.findBySpacesId(input.spacesChannelId),
      this.pairs.findByName(linkName(config.sourceId, input.externalChannelId)),
    ]);
    if (spacesLink) throw new GatewayError('CHANNEL_TAKEN', 'This channel is already linked');
    if (externalLink)
      throw new GatewayError(
        'CHANNEL_TAKEN',
        `That ${this.provider.displayName} channel is already linked`
      );

    const deskName = this.provider.deskSourceName(input.externalChannelId);
    if (deskName && (await this.sources.findActiveNames([deskName])).size > 0) {
      throw new GatewayError(
        'CHANNEL_TAKEN',
        `That ${this.provider.displayName} channel is used by a desk`
      );
    }
  }

  /** Linking shares the channel both ways, so the person must be in it alongside the app. */
  private async findSharedChannel(
    userId: string,
    config: ProviderConfig,
    externalChannelId: string,
    subject: string
  ): Promise<ProviderChannel> {
    const api = this.provider.createApi(config.credentials);
    const externalUserId = await this.identity.findExternalUserId(api, userId);
    const channels = externalUserId ? await api.listSharedChannels(externalUserId) : [];
    const channel = channels.find((candidate) => candidate.id === externalChannelId);
    if (!channel) {
      throw new GatewayError(
        'NOT_CHANNEL_MEMBER',
        `${subject} and ${config.appName ?? 'the Mirror app'} must both be in that ${this.provider.displayName} channel`
      );
    }
    return channel;
  }

  private async createLink(data: Parameters<PairRepository['create']>[0]): Promise<MirrorLink> {
    try {
      return await this.pairs.create(data);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new GatewayError('CHANNEL_TAKEN', 'One of these channels was just linked');
      }
      throw error;
    }
  }

  private async getLinkById(workspaceId: string, linkId: string): Promise<MirrorLink> {
    const link = await this.pairs.findById(linkId);
    if (!link || link.workspaceId !== workspaceId)
      throw new GatewayError('LINK_NOT_FOUND', 'Link not found');
    return link;
  }

  private async findExternalChannel(link: MirrorLink): Promise<ProviderChannel | null> {
    try {
      const config = await this.config.getConfigBySource(link.connectionId);
      return await this.provider.createApi(config.credentials).getChannel(link.externalId);
    } catch {
      return null;
    }
  }

  /** The message-map row shared with self-serve migration; Mirror's credentials go on it for file downloads. */
  private buildMessageSource(link: MirrorLink, config: ProviderConfig) {
    return this.provider.buildMessageSource(link.externalId, link.spacesId, config.credentials);
  }
}
