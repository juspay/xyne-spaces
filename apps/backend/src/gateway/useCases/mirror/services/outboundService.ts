import {
  ExternalAttachmentService,
  MessageDirection,
  MessageType,
  acquireLock,
  db,
  extractUserMentions,
  releaseLock,
  repositories,
} from '../../../re-exports';
import { gatewayConfig } from '../../../config';
import type { BaseApi } from '../../../core/base/baseApi';
import type { BaseProvider } from '../../../core/base/baseProvider';
import { MessageMapRepository } from '../../../core/repositories/messageMapRepository';
import { SourceRepository } from '../../../core/repositories/sourceRepository';
import type {
  OutboundFile,
  OutboundMessage,
  ProviderConfig,
  SpacesMessageChange,
} from '../../../core/types';
import type { IdentityService } from '../../../core/services/identityService';
import type { UserAuthService } from '../../../core/services/userAuthService';
import type { MirrorLink } from '../types';

interface OutboundContext {
  link: MirrorLink;
  api: BaseApi;
  /** Where new map rows go. */
  sourceId: string;
  /** Where existing map rows are looked up: sourceId plus older migrations'. */
  sourceIds: string[];
}

const sendLockKey = (messageId: string): string => `mirror:send:${messageId}`;

/** Held while a message is posted as a person, until its map row exists; the events controller checks it. */
export const sendAsLockKey = (linkId: string, externalUserId: string): string =>
  `mirror:send-as:${linkId}:${externalUserId}`;

const SEND_AS_WAIT_MS = 10_000;

/** Sends Spaces message changes to the provider. Only Mirror's own posts are edited or deleted there. */
export class OutboundService {
  private readonly sources = new SourceRepository();
  private readonly messageMap = new MessageMapRepository();
  private readonly attachments = new ExternalAttachmentService();

  constructor(
    private readonly provider: BaseProvider,
    private readonly identity: IdentityService,
    private readonly userAuth: UserAuthService
  ) {}

  async sendMessageChange(
    link: MirrorLink,
    config: ProviderConfig,
    change: SpacesMessageChange
  ): Promise<void> {
    const source = this.provider.buildMessageSource(
      link.externalId,
      link.spacesId,
      config.credentials
    );
    const legacyNames = this.provider.legacyMessageSourceNames(link.externalId, link.spacesId);
    const { sourceId, sourceIds } = await this.sources.findMessageScopes(source, legacyNames, link);
    const ctx: OutboundContext = {
      link,
      api: this.provider.createApi(config.credentials),
      sourceId,
      sourceIds,
    };

    if (change.operation === 'insert') {
      await this.postToProvider(ctx, change.messageId);
      return;
    }

    // A bot can't edit or delete someone else's message, so messages from the provider stay as they are there.
    const row = await this.messageMap.findByMessageId(ctx.sourceIds, change.messageId);
    if (!row || row.direction !== MessageDirection.OUTGOING) return;

    const message = await db.message.findUnique({
      where: { messageId: change.messageId },
      select: { content: true, isDeleted: true, senderId: true },
    });
    if (change.operation === 'delete' || !message || message.isDeleted) {
      await this.asPoster(ctx, message?.senderId, (api) =>
        api.deleteMessage(link.externalId, row.externalId)
      );
    } else if (message.content !== change.previousContent) {
      const text = await this.toProviderText(ctx, message.content);
      await this.asPoster(ctx, message.senderId, (api) =>
        api.updateMessage(link.externalId, row.externalId, text)
      );
    }
  }

  /** Edits and deletes go out as whoever posted: the sender's own token first, else the bot. */
  private async asPoster(
    ctx: OutboundContext,
    senderId: string | undefined,
    fn: (api: BaseApi) => Promise<void>
  ): Promise<void> {
    const sender = senderId ? await this.userAuth.findUserApi(senderId) : null;
    if (sender && (await this.userAuth.callAsUser(sender, fn))) return;
    await fn(ctx.api);
  }

  /** Posts a message once and returns its provider id; a reply's parent from before the link is posted first. */
  private async postToProvider(ctx: OutboundContext, messageId: string): Promise<string | null> {
    const lock = await acquireLock(sendLockKey(messageId), {
      ttlSeconds: gatewayConfig.lockTtlSeconds,
    });
    if (!lock) return null;
    try {
      const existing = await this.messageMap.findByMessageId(ctx.sourceIds, messageId);
      if (existing)
        return existing.direction === MessageDirection.OUTGOING ? existing.externalId : null;

      const message = await db.message.findUnique({
        where: { messageId },
        select: {
          conversationId: true,
          senderId: true,
          content: true,
          msgType: true,
          isDeleted: true,
        },
      });
      if (!message || message.isDeleted || message.msgType === MessageType.SYSTEM) return null;

      const conversation = await db.conversation.findUnique({
        where: { conversationId: message.conversationId },
        select: { initialMessageId: true },
      });
      const parentId = conversation?.initialMessageId;
      const threadId =
        parentId && parentId !== messageId
          ? await this.findOrPostThreadParent(ctx, parentId)
          : undefined;

      const [files, html] = await Promise.all([
        this.loadMessageFiles(messageId),
        this.toProviderText(ctx, message.content),
      ]);
      const text = html || files.map((file) => `📎 ${file.name}`).join(' ');
      if (!text) return null;

      const outbound = {
        channelId: ctx.link.externalId,
        threadId: threadId ?? undefined,
        text,
      };
      const record = async (externalId: string): Promise<void> => {
        await this.messageMap.create({
          sourceId: ctx.sourceId,
          externalId,
          threadId: threadId ?? externalId,
          messageId,
          direction: MessageDirection.OUTGOING,
        });
      };
      const externalId =
        (await this.postAsSender(ctx, message.senderId, outbound, record)) ??
        (await this.postAsBot(ctx, message.senderId, outbound, record));
      if (files.length > 0)
        await ctx.api.uploadFiles(ctx.link.externalId, threadId ?? externalId, files);
      return externalId;
    } finally {
      await releaseLock(lock);
    }
  }

  /**
   * Posts with the sender's own token when they signed in. The map row is written before the echo lock
   * is released, so the provider's echo of their post is seen as already copied. Null: the bot posts.
   */
  private async postAsSender(
    ctx: OutboundContext,
    senderId: string,
    message: OutboundMessage,
    record: (externalId: string) => Promise<void>
  ): Promise<string | null> {
    const sender = await this.userAuth.findUserApi(senderId);
    if (!sender) return null;
    const lock = await acquireLock(sendAsLockKey(ctx.link.id, sender.externalUserId), {
      ttlSeconds: gatewayConfig.lockTtlSeconds,
      waitTimeoutMs: SEND_AS_WAIT_MS,
    });
    if (!lock) return null;
    try {
      const posted = await this.userAuth.callAsUser(sender, (api) => api.postMessage(message));
      if (posted) await record(posted.value);
      return posted?.value ?? null;
    } finally {
      await releaseLock(lock);
    }
  }

  /** The bot posts under the sender's provider name and photo when they have an account there, else their Spaces ones. */
  private async postAsBot(
    ctx: OutboundContext,
    senderId: string,
    message: OutboundMessage,
    record: (externalId: string) => Promise<void>
  ): Promise<string> {
    const [sender, externalSender] = await Promise.all([
      repositories.users.findById(senderId),
      // A failed lookup only costs the provider's name and photo; the Spaces ones are used instead.
      this.identity.findExternalUser(ctx.api, senderId).catch(() => null),
    ]);
    const externalId = await ctx.api.postMessage({
      ...message,
      senderName: externalSender?.name ?? sender?.name ?? 'Spaces',
      senderAvatarUrl: externalSender?.avatarUrl ?? sender?.picture ?? undefined,
    });
    await record(externalId);
    return externalId;
  }

  private async findOrPostThreadParent(
    ctx: OutboundContext,
    parentMessageId: string
  ): Promise<string | null> {
    const row = await this.messageMap.findByMessageId(ctx.sourceIds, parentMessageId);
    return row ? row.externalId : await this.postToProvider(ctx, parentMessageId);
  }

  private async toProviderText(ctx: OutboundContext, html: string): Promise<string> {
    const mentions = new Map<string, string>();
    for (const userId of extractUserMentions(html)) {
      const externalUserId = await this.identity.findExternalUserId(ctx.api, userId);
      if (externalUserId) mentions.set(userId, externalUserId);
    }
    return this.provider.transformer.toProvider(html, mentions);
  }

  private async loadMessageFiles(messageId: string): Promise<OutboundFile[]> {
    const rows = await repositories.messageAttachments.findByMessageId(messageId);
    const attachmentIds = rows
      .filter((row) => row.size <= gatewayConfig.maxFileBytes)
      .map((row) => row.id);
    if (attachmentIds.length === 0) return [];
    const { attachments } = await this.attachments.prepareOutboundAttachments({ attachmentIds });
    return attachments.map((attachment) => ({
      name: attachment.name,
      mimeType: attachment.contentType,
      content: Buffer.isBuffer(attachment.content)
        ? attachment.content
        : Buffer.from(attachment.content),
    }));
  }
}
