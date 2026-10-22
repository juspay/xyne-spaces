import {
  NotificationType,
  acquireLock,
  db,
  logger,
  notificationService,
  releaseLock,
} from '../../../re-exports';
import { MirrorError } from '../errors';
import type { BaseProvider } from '../../../core/base/baseProvider';
import { GatewayError } from '../../../core/errors';
import {
  SyncRequestRepository,
  type SyncRequestFilters,
} from '../repositories/syncRequestRepository';
import type { ConfigService } from '../../../core/services/configService';
import {
  type ChannelSyncStatus,
  type MirrorApi,
  type SyncRequest,
  type SyncRequestView,
} from '../types';
import type { LinkInput, LinkService } from './linkService';

const DECIDE_LOCK_TTL_SECONDS = 60;
const decideLockKey = (requestId: string): string => `mirror:request-decide:${requestId}`;

// Failed checks that close a request on approval, so its channel admin can ask again. Anything else
// (rate limits, provider outages) leaves it pending for another try.
const RECHECK_FAILURES: ReadonlySet<string> = new Set([
  'VALIDATION_ERROR',
  'NOT_CONFIGURED',
  'NOT_CHANNEL_MEMBER',
  'CHANNEL_TAKEN',
  'PROVIDER_AUTH',
  'CHANNEL_GONE',
]);

export interface SyncRequestQuery extends SyncRequestFilters {
  search?: string;
  limit: number;
  offset: number;
}

/** Channel admins ask to sync a channel; an organisation admin approves, which creates the link. */
export class LinkRequestService {
  private readonly requests = new SyncRequestRepository();

  constructor(
    private readonly provider: BaseProvider<unknown, MirrorApi>,
    private readonly config: ConfigService<MirrorApi>,
    private readonly links: LinkService
  ) {}

  async getChannelStatus(
    workspaceId: string,
    userId: string,
    spacesChannelId: string,
    isOrgAdmin: boolean
  ): Promise<ChannelSyncStatus> {
    const [connection, view, request, participant] = await Promise.all([
      this.config.findConnectionByWorkspace(workspaceId),
      this.links.findChannelLink(spacesChannelId),
      this.requests.findLatestBySpacesId(workspaceId, spacesChannelId),
      db.channelParticipant.findUnique({
        where: { channelId_userId: { channelId: spacesChannelId, userId } },
        select: { role: true },
      }),
    ]);
    const isChannelAdmin = participant?.role === 'ADMIN';
    return {
      connected: !!connection,
      appName: connection?.appName ?? null,
      link: view?.link ?? null,
      externalChannel: view?.externalChannel ?? null,
      request,
      canRequest: isChannelAdmin,
      canManage: isChannelAdmin || isOrgAdmin,
    };
  }

  async submit(workspaceId: string, userId: string, input: LinkInput): Promise<SyncRequest> {
    const connection = await this.config.getConnectionByWorkspace(workspaceId);
    const channel = await this.links.assertCanLink(workspaceId, userId, connection, input);
    const request = await this.requests.create({
      workspaceId,
      connectionId: connection.sourceId,
      externalId: input.externalChannelId,
      externalName: channel.name,
      spacesId: input.spacesChannelId,
      requestedBy: userId,
    });
    if (!request) {
      throw new MirrorError('CHANNEL_TAKEN', 'One of these channels already has a request waiting');
    }
    return request;
  }

  async cancel(workspaceId: string, userId: string, requestId: string): Promise<SyncRequest> {
    return await this.withPending(workspaceId, requestId, (request) =>
      this.requests.close(request, 'CANCELLED', userId)
    );
  }

  async reject(
    workspaceId: string,
    adminId: string,
    requestId: string,
    reason: string
  ): Promise<SyncRequest> {
    return await this.withPending(workspaceId, requestId, async (request) => {
      const rejected = await this.requests.close(request, 'REJECTED', adminId, reason);
      void this.notifyRequester(rejected);
      return rejected;
    });
  }

  /** Links the channels; a failed check rejects the request with its reason, then throws it. */
  async approve(workspaceId: string, adminId: string, requestId: string): Promise<SyncRequest> {
    return await this.withPending(workspaceId, requestId, async (request) => {
      try {
        await this.links.linkChannel(workspaceId, request.requestedBy, {
          spacesChannelId: request.spacesId,
          externalChannelId: request.externalId,
        });
      } catch (error) {
        if (!(error instanceof GatewayError) || !RECHECK_FAILURES.has(error.code)) throw error;
        const rejected = await this.requests.close(
          request,
          'REJECTED',
          adminId,
          this.reasonOf(error)
        );
        void this.notifyRequester(rejected);
        throw new GatewayError(error.code, this.reasonOf(error), {}, error.statusCode);
      }
      const approved = await this.requests.close(request, 'APPROVED', adminId);
      void this.notifyRequester(approved);
      return approved;
    });
  }

  /** Newest first, with names for the admin's table. */
  async list(
    workspaceId: string,
    query: SyncRequestQuery
  ): Promise<{ requests: SyncRequestView[]; total: number }> {
    const requests = await this.requests.list(workspaceId, query);
    const channelIds = [...new Set(requests.map((request) => request.spacesId))];
    const userIds = [
      ...new Set(requests.flatMap((request) => [request.requestedBy, request.decidedBy ?? ''])),
    ].filter(Boolean);
    const [channels, users] = await Promise.all([
      db.channel.findMany({ where: { id: { in: channelIds } }, select: { id: true, name: true } }),
      db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }),
    ]);
    const channelNames = new Map(channels.map((channel) => [channel.id, channel.name]));
    const userNames = new Map(users.map((user) => [user.id, user.name]));

    const search = query.search?.trim().toLowerCase();
    const views = requests
      .map(
        (request): SyncRequestView => ({
          ...request,
          spacesChannelName: channelNames.get(request.spacesId) ?? null,
          requesterName: userNames.get(request.requestedBy) ?? null,
          deciderName: request.decidedBy ? (userNames.get(request.decidedBy) ?? null) : null,
        })
      )
      .filter(
        (view) =>
          !search ||
          [view.spacesChannelName, view.externalName, view.requesterName].some((text) =>
            text?.toLowerCase().includes(search)
          )
      );
    return {
      requests: views.slice(query.offset, query.offset + query.limit),
      total: views.length,
    };
  }

  /** One decision at a time per request, and only while it is pending. */
  private async withPending<T>(
    workspaceId: string,
    requestId: string,
    decide: (request: SyncRequest) => Promise<T>
  ): Promise<T> {
    const lock = await acquireLock(decideLockKey(requestId), {
      ttlSeconds: DECIDE_LOCK_TTL_SECONDS,
    });
    if (!lock) throw new GatewayError('LOCK_HELD', 'Someone is deciding this request right now');
    try {
      const request = await this.requests.findById(requestId);
      if (!request || request.workspaceId !== workspaceId) {
        throw new MirrorError('REQUEST_NOT_FOUND', 'Request not found');
      }
      if (request.status !== 'PENDING') {
        throw new MirrorError(
          'REQUEST_CLOSED',
          `This request is already ${request.status.toLowerCase()}`
        );
      }
      return await decide(request);
    } finally {
      await releaseLock(lock);
    }
  }

  private reasonOf(error: GatewayError): string {
    const name = this.provider.displayName;
    if (error.code === 'PROVIDER_AUTH')
      return `${name} rejected the app's token; reconnect ${name}`;
    if (error.code === 'CHANNEL_GONE') {
      return `That ${name} channel was archived, or the app was removed from it`;
    }
    return error.message;
  }

  /** Tells the channel admin who asked. A failed notification never fails the decision. */
  private async notifyRequester(request: SyncRequest): Promise<void> {
    try {
      const channel = await db.channel.findUnique({
        where: { id: request.spacesId },
        select: { name: true },
      });
      const pair = `#${channel?.name ?? 'your channel'} with #${request.externalName} in ${this.provider.displayName}`;
      const approved = request.status === 'APPROVED';
      await notificationService.createNotification(request.requestedBy, {
        title: approved
          ? `${this.provider.displayName} sync approved`
          : `${this.provider.displayName} sync request rejected`,
        message: approved
          ? `${pair} now sync both ways.`
          : `Your request to sync ${pair} was rejected: ${request.reason}`,
        type: NotificationType.MIRROR_SYNC_REQUEST,
        relatedEntityType: 'channel',
        relatedEntityId: request.spacesId,
        actionUrl: `/${request.workspaceId}/chat/dir/${request.spacesId}`,
        workspaceId: request.workspaceId,
        metadata: { requestId: request.id, status: request.status },
      });
    } catch (error) {
      logger.error('[Mirror] Sync request notification failed', { requestId: request.id, error });
    }
  }
}
