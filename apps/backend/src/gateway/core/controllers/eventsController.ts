import type { RequestHandler } from 'express';
import { acquireLock, releaseLock, runWithContext } from '../../re-exports';
import type { RawBodyRequest } from '../../re-exports';
import { gatewayConfig } from '../../config';
import { GatewayError, isPausingError } from '../errors';
import { asyncRoute } from '../middleware/errorHandler';
import { messageLockKey } from '../../useCases/mirror/services/inboundService';
import type { MessageEvent } from '../../useCases/mirror/services/inboundService';
import { sendAsLockKey } from '../../useCases/mirror/services/outboundService';
import type { ProviderConfig, ProviderEvent, Pair, ProviderServices } from '../types';

const SEND_AS_PROBE_TTL_SECONDS = 5;

/**
 * Provider webhooks: verify → parse → find link → lock → apply → respond, inside the request like desk.
 * 200 when done or nothing to do; 5xx makes the provider retry.
 */
export class EventsController {
  constructor(private readonly services: ProviderServices) {}

  handleEvent: RequestHandler = asyncRoute(async (req, res) => {
    const { provider, config: configService, links } = this.services;
    const request = provider.parseEvent(req.body);
    if (request.kind === 'challenge') {
      res.json(request.response);
      return;
    }

    // No tenant is known until the config row is found, so these two lookups run unscoped, like desk's.
    const config = await configService.findConfigByExternalWorkspace(request.externalWorkspaceId);
    if (!config)
      throw new GatewayError('NOT_CONFIGURED', `${provider.displayName} workspace is not set up`);
    provider.verifyRequest(
      { rawBody: (req as RawBodyRequest).rawBody ?? '', headers: req.headers },
      config.credentials
    );

    const event = request.event;
    if (event && !this.isOwnMessage(event, config)) {
      const link = await links.findActiveLink(config.sourceId, this.channelOf(event));
      if (link) {
        // Acts for the person who linked the channel, scoped to the link's workspace.
        const principal = { userId: link.createdBy, workspaceId: link.workspaceId };
        await runWithContext(principal, () => this.apply(link, config, event));
      }
    }
    res.status(200).json({ ok: true });
  });

  private async apply(link: Pair, config: ProviderConfig, event: ProviderEvent): Promise<void> {
    try {
      if (event.type === 'member_joined' || event.type === 'member_left') {
        await this.services.members.applyProviderMemberChange(link, config, event);
      } else {
        await this.applyMessage(link, config, event);
      }
    } catch (error) {
      // A revoked token or a lost channel won't heal on retry: pause and answer 200.
      if (!isPausingError(error)) throw error;
      await this.services.links.pauseOnError(link, error);
    }
  }

  /** A retry that arrives while the first attempt is still working gets 503, and the provider tries later. */
  private async applyMessage(
    link: Pair,
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
      await this.services.inbound.applyMessageEvent(link, config, event);
    } finally {
      await releaseLock(lock);
    }
  }

  /**
   * A post sent from Spaces with a person's own token comes back looking like theirs. Its map row is
   * written before the sender's lock is freed, so a retry after the 503 sees it as already copied.
   */
  private async assertNotSendingAs(link: Pair, externalUserId: string): Promise<void> {
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
      this.services.provider.isOwnMessage(event.message, config.workspace)
    );
  }

  private channelOf(event: ProviderEvent): string {
    return 'message' in event ? event.message.channelId : event.channelId;
  }
}
