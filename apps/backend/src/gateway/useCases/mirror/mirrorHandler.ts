import { acquireLock, releaseLock, runWithContext } from '../../re-exports';
import { gatewayConfig } from '../../config';
import { GatewayError, isPausingError } from '../../core/errors';
import { PairRepository } from '../../core/repositories/pairRepository';
import type {
  GatewayHandler,
  ProviderConfig,
  ProviderEvent,
  ProviderServices,
  SpacesMemberChange,
  SpacesMessageChange,
} from '../../core/types';
import { messageLockKey, type MessageEvent } from './services/inboundService';
import { sendAsLockKey } from './services/outboundService';
import { MIRROR_SOURCE_SUFFIX, type MirrorLink, type MirrorServices } from './types';

const SEND_AS_PROBE_TTL_SECONDS = 5;

type LinkWork = (link: MirrorLink, config: ProviderConfig) => Promise<void>;

/** Mirror for one provider: its events go into linked Spaces channels, and Spaces changes go back out. */
export class MirrorHandler implements GatewayHandler {
  private readonly links: PairRepository;

  constructor(
    private readonly core: ProviderServices,
    private readonly mirror: MirrorServices
  ) {
    this.links = new PairRepository(`${core.provider.id}${MIRROR_SOURCE_SUFFIX}`);
  }

  async onProviderEvent(config: ProviderConfig, event: ProviderEvent): Promise<void> {
    if (this.isOwnMessage(event, config)) return;
    const link = await this.mirror.links.findActiveLink(config.sourceId, this.channelOf(event));
    if (!link) return;
    // Acts for the person who linked the channel, scoped to the link's workspace.
    const principal = { userId: link.createdBy, workspaceId: link.workspaceId };
    await runWithContext(principal, () => this.apply(link, config, event));
  }

  async onSpacesMessageChanged(change: SpacesMessageChange): Promise<void> {
    await this.forActiveLink(change.channelId, (link, config) =>
      this.mirror.outbound.sendMessageChange(link, config, change)
    );
  }

  async onSpacesMemberChanged(change: SpacesMemberChange): Promise<void> {
    await this.forActiveLink(change.channelId, (link, config) =>
      this.mirror.members.applySpacesMemberChange(link, config, change)
    );
  }

  private async forActiveLink(channelId: string, work: LinkWork): Promise<void> {
    const link = await this.links.findBySpacesId(channelId);
    if (link?.status !== 'ACTIVE') return;
    await this.pausingOnError(link, async () =>
      work(link, await this.core.config.getConfigBySource(link.connectionId))
    );
  }

  private async apply(
    link: MirrorLink,
    config: ProviderConfig,
    event: ProviderEvent
  ): Promise<void> {
    await this.pausingOnError(link, () =>
      event.type === 'member_joined' || event.type === 'member_left'
        ? this.mirror.members.applyProviderMemberChange(link, config, event)
        : this.applyMessage(link, config, event)
    );
  }

  /** A revoked token or a lost channel won't heal on retry: the link pauses and the event answers 200. */
  private async pausingOnError(link: MirrorLink, work: () => Promise<void>): Promise<void> {
    try {
      await work();
    } catch (error) {
      if (!isPausingError(error)) throw error;
      await this.mirror.links.pauseOnError(link, error);
    }
  }

  /** A retry that arrives while the first attempt is still working gets 503, and the provider tries later. */
  private async applyMessage(
    link: MirrorLink,
    config: ProviderConfig,
    event: MessageEvent
  ): Promise<void> {
    if (event.type === 'message_created' && event.message.authorId) {
      await this.assertNotSendingAs(link, event.message.authorId);
    }
    const externalId = event.type === 'message_deleted' ? event.messageId : event.message.id;
    const lock = await acquireLock(messageLockKey(link.id, externalId), {
      ttlSeconds: gatewayConfig.lockTtlSeconds,
    });
    if (!lock) throw new GatewayError('LOCK_HELD', 'This message is still being processed');
    try {
      await this.mirror.inbound.applyMessageEvent(link, config, event);
    } finally {
      await releaseLock(lock);
    }
  }

  /**
   * A post sent from Spaces with a person's own token comes back looking like theirs. Its map row is
   * written before the sender's lock is freed, so a retry after the 503 sees it as already copied.
   */
  private async assertNotSendingAs(link: MirrorLink, externalUserId: string): Promise<void> {
    const lock = await acquireLock(sendAsLockKey(link.id, externalUserId), {
      ttlSeconds: SEND_AS_PROBE_TTL_SECONDS,
    });
    if (!lock)
      throw new GatewayError('LOCK_HELD', 'A message from this person is still being sent');
    await releaseLock(lock);
  }

  private isOwnMessage(event: ProviderEvent, config: ProviderConfig): boolean {
    return (
      (event.type === 'message_created' || event.type === 'message_edited') &&
      this.core.provider.isOwnMessage(event.message, config.workspace)
    );
  }

  private channelOf(event: ProviderEvent): string {
    return 'message' in event ? event.message.channelId : event.channelId;
  }
}
