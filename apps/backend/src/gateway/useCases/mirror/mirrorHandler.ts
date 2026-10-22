import { acquireLock, logger, releaseLock, runWithContext } from '../../re-exports';
import { gatewayConfig } from '../../config';
import { GatewayError, isPausingError } from '../../core/errors';
import { inlineJobContext } from '../../core/queue/gatewayQueue';
import { PairRepository } from '../../core/repositories/pairRepository';
import type {
  GatewayHandler,
  GatewayJob,
  JobContext,
  ProviderEvent,
  ProviderServices,
  SpacesMemberChange,
  SpacesMessageChange,
} from '../../core/types';
import { messageLockKey, type MessageEvent } from './services/inboundService';
import { sendAsLockKey } from './services/outboundService';
import {
  MIRROR_SOURCE_SUFFIX,
  inboundJobId,
  outboundJobId,
  type InboundJobPayload,
  type MirrorApi,
  type MirrorConnection,
  type MirrorJobType,
  type MirrorLink,
  type MirrorServices,
  type OutboundJobPayload,
} from './types';

const SEND_AS_PROBE_TTL_SECONDS = 5;

type LinkWork = (link: MirrorLink, connection: MirrorConnection) => Promise<void>;

/** Mirror for one provider: its events go into linked Spaces channels, and Spaces changes go back out. */
export class MirrorHandler implements GatewayHandler {
  readonly name: string;
  private readonly links: PairRepository;

  constructor(
    private readonly core: ProviderServices<MirrorApi>,
    private readonly mirror: MirrorServices
  ) {
    this.name = `${core.provider.id}${MIRROR_SOURCE_SUFFIX}`;
    this.links = new PairRepository(this.name);
  }

  async onProviderEvent(connection: MirrorConnection, event: ProviderEvent): Promise<void> {
    if (this.isOwnMessage(event, connection)) return;
    const link = await this.mirror.links.findActiveLink(connection.sourceId, this.channelOf(event));
    if (!link) return;
    if (isMessageEvent(event) && (await this.shouldQueue(link, event))) {
      await this.queueInbound(link, event);
      return;
    }
    await this.applyAsLinker(link, connection, event, inlineJobContext());
  }

  async onSpacesMessageChanged(change: SpacesMessageChange): Promise<void> {
    const link = await this.links.findBySpacesId(change.channelId);
    if (link?.status !== 'ACTIVE') return;
    const payload: OutboundJobPayload = { linkId: link.id, change };
    const job = this.buildJob(link, 'outbound', { messageId: change.messageId }, payload);
    try {
      await this.core.jobs.add(
        job,
        change.operation === 'insert' ? outboundJobId(change.messageId) : undefined
      );
    } catch (error) {
      logger.warn('[Mirror] Queue unavailable, sending now', {
        messageId: change.messageId,
        error,
      });
      await this.runJob(job, inlineJobContext());
    }
  }

  async onSpacesMemberChanged(change: SpacesMemberChange): Promise<void> {
    await this.forActiveLink(change.channelId, (link, connection) =>
      this.mirror.members.applySpacesMemberChange(link, connection, change)
    );
  }

  async runJob(job: GatewayJob, context: JobContext): Promise<void> {
    const { linkId } = job.payload as { linkId: string };
    const link = await this.links.findById(linkId);
    if (link?.status !== 'ACTIVE') return;
    const connection = await this.core.config.getConnectionBySource(link.connectionId);

    if ((job.type as MirrorJobType) === 'outbound') {
      const { change } = job.payload as OutboundJobPayload;
      if (
        change.operation !== 'insert' &&
        (await this.core.jobs.isPending(this.name, outboundJobId(change.messageId)))
      ) {
        throw new GatewayError('LOCK_HELD', 'The message is still being sent');
      }
      const principal = { userId: link.createdBy, workspaceId: link.workspaceId };
      await runWithContext(principal, () =>
        this.pausingOnError(link, () =>
          this.mirror.outbound.sendMessageChange(link, connection, change, context)
        )
      );
      return;
    }

    const event = reviveEvent((job.payload as InboundJobPayload).event);
    if (await this.isWaitingOnEarlierJob(link, event)) {
      throw new GatewayError('LOCK_HELD', 'An earlier message is still being copied');
    }
    await this.applyAsLinker(link, connection, event, context);
  }

  private async forActiveLink(channelId: string, work: LinkWork): Promise<void> {
    const link = await this.links.findBySpacesId(channelId);
    if (link?.status !== 'ACTIVE') return;
    await this.pausingOnError(link, async () =>
      work(link, await this.core.config.getConnectionBySource(link.connectionId))
    );
  }

  private async shouldQueue(link: MirrorLink, event: MessageEvent): Promise<boolean> {
    if (event.type === 'message_created' && event.message.files.length > 0) return true;
    return await this.isWaitingOnEarlierJob(link, event);
  }

  private async isWaitingOnEarlierJob(link: MirrorLink, event: MessageEvent): Promise<boolean> {
    const earlierId = dependencyOf(event);
    return (
      !!earlierId && (await this.core.jobs.isPending(this.name, inboundJobId(link.id, earlierId)))
    );
  }

  private async queueInbound(link: MirrorLink, event: MessageEvent): Promise<void> {
    const externalId = event.type === 'message_deleted' ? event.messageId : event.message.id;
    const payload: InboundJobPayload = { linkId: link.id, event };
    await this.core.jobs.add(
      this.buildJob(link, 'inbound', { externalMessageId: externalId }, payload),
      event.type === 'message_created' ? inboundJobId(link.id, externalId) : undefined
    );
  }

  private buildJob(
    link: MirrorLink,
    type: MirrorJobType,
    refs: Record<string, string>,
    payload: OutboundJobPayload | InboundJobPayload
  ): GatewayJob {
    return {
      handler: this.name,
      type,
      provider: this.core.provider.id,
      workspaceId: link.workspaceId,
      refs: {
        linkId: link.id,
        spacesChannelId: link.spacesId,
        externalChannelId: link.externalId,
        ...refs,
      },
      payload,
    };
  }

  private async applyAsLinker(
    link: MirrorLink,
    connection: MirrorConnection,
    event: ProviderEvent,
    context: JobContext
  ): Promise<void> {
    // Acts for the person who linked the channel, scoped to the link's workspace.
    const principal = { userId: link.createdBy, workspaceId: link.workspaceId };
    await runWithContext(principal, () =>
      this.pausingOnError(link, () =>
        event.type === 'member_joined' || event.type === 'member_left'
          ? this.mirror.members.applyProviderMemberChange(link, connection, event)
          : this.applyMessage(link, connection, event, context)
      )
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
    connection: MirrorConnection,
    event: MessageEvent,
    context: JobContext
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
      await this.mirror.inbound.applyMessageEvent(link, connection, event, context);
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

  private isOwnMessage(event: ProviderEvent, connection: MirrorConnection): boolean {
    return (
      (event.type === 'message_created' || event.type === 'message_edited') &&
      this.core.provider.isOwnMessage(event.message, connection.workspace)
    );
  }

  private channelOf(event: ProviderEvent): string {
    return 'message' in event ? event.message.channelId : event.channelId;
  }
}

function isMessageEvent(event: ProviderEvent): event is MessageEvent {
  return (
    event.type === 'message_created' ||
    event.type === 'message_edited' ||
    event.type === 'message_deleted'
  );
}

function dependencyOf(event: MessageEvent): string | undefined {
  if (event.type === 'message_deleted') return event.messageId;
  if (event.type === 'message_edited') return event.message.id;
  const { threadId, id } = event.message;
  return threadId && threadId !== id ? threadId : undefined;
}

function reviveEvent(event: MessageEvent): MessageEvent {
  if (event.type === 'message_deleted') return event;
  return { ...event, message: { ...event.message, createdAt: new Date(event.message.createdAt) } };
}
