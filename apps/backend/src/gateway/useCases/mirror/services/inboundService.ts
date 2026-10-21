import {
  ExternalAttachmentService,
  MessageDirection,
  MessagesSideEffectHandler,
  acquireLock,
  buildUserQueryContext,
  conversationService,
  deleteConversationMessage,
  logger,
  releaseLock,
  repositories,
} from '../../../re-exports';
import { gatewayConfig } from '../../../config';
import type { BaseApi } from '../../../core/base/baseApi';
import type { BaseProvider } from '../../../core/base/baseProvider';
import { GatewayError } from '../../../core/errors';
import { MessageMapRepository } from '../../../core/repositories/messageMapRepository';
import { SourceRepository } from '../../../core/repositories/sourceRepository';
import type { ProviderConfig, ProviderEvent, ProviderMessage } from '../../../core/types';
import type { IdentityService } from '../../../core/services/identityService';
import type { MirrorLink } from '../types';

export type MessageEvent = Extract<
  ProviderEvent,
  { type: 'message_created' | 'message_edited' | 'message_deleted' }
>;

/** One lock per provider message, held while it is written to Spaces. */
export const messageLockKey = (linkId: string, externalMessageId: string): string =>
  `mirror:${linkId}:${externalMessageId}`;

const PARENT_LOCK_WAIT_MS = 10_000;

interface InboundContext {
  link: MirrorLink;
  config: ProviderConfig;
  api: BaseApi;
  sourceName: string;
  /** Where new map rows go. */
  sourceId: string;
  /** Where existing map rows are looked up: sourceId plus older migrations'. */
  sourceIds: string[];
}

/** Applies provider message events to Spaces. Every write is idempotent through the message map. */
export class InboundService {
  private readonly sources = new SourceRepository();
  private readonly messageMap = new MessageMapRepository();
  private readonly attachments = new ExternalAttachmentService();

  constructor(
    private readonly provider: BaseProvider,
    private readonly identity: IdentityService
  ) {}

  async applyMessageEvent(
    link: MirrorLink,
    config: ProviderConfig,
    event: MessageEvent
  ): Promise<void> {
    const source = this.provider.buildMessageSource(
      link.externalId,
      link.spacesId,
      config.credentials
    );
    const legacyNames = this.provider.legacyMessageSourceNames(link.externalId, link.spacesId);
    const { sourceId, sourceIds } = await this.sources.findMessageScopes(source, legacyNames, link);
    const ctx: InboundContext = {
      link,
      config,
      api: this.provider.createApi(config.credentials),
      sourceName: source.name,
      sourceId,
      sourceIds,
    };

    if (event.type === 'message_created') await this.createSpacesMessage(ctx, event.message);
    else if (event.type === 'message_edited') await this.editSpacesMessage(ctx, event.message);
    else await this.deleteSpacesMessage(ctx, event.messageId);
  }

  /** Returns the Spaces message id, or null when the message has no author or content to copy. */
  private async createSpacesMessage(
    ctx: InboundContext,
    message: ProviderMessage
  ): Promise<string | null> {
    const existing = await this.messageMap.findByExternalId(ctx.sourceIds, message.id);
    if (existing) return existing.messageId;

    const userId = await this.findOrCreateAuthor(ctx, message);
    if (!userId) {
      logger.warn('[Mirror] Message skipped: no Spaces author', {
        linkId: ctx.link.id,
        externalId: message.id,
      });
      return null;
    }

    const [html, uploadedFiles] = await Promise.all([
      this.provider.transformer.toSpaces(message, ctx.config),
      this.downloadFiles(ctx, message),
    ]);
    // Same placeholder as self-serve migration when no file made it and there is no text.
    const content =
      html.trim() || uploadedFiles.length > 0
        ? html
        : message.files.map((file) => `📎 ${file.name}`).join(' ');
    if (!content.trim() && uploadedFiles.length === 0) return null;

    const conversationId = message.threadId
      ? await this.findOrCopyThreadConversation(ctx, message.threadId)
      : null;
    const { message: created } = conversationId
      ? await conversationService.addMessageToConversation({
          conversationId,
          userId,
          content,
          uploadedFiles,
          replyBroadcast: message.replyBroadcast,
          createdAt: message.createdAt,
          lastActivityAt: message.createdAt,
          emitsMessageReceivedViaSideEffects: true,
        })
      : await conversationService.createConversationWithMessage({
          channelId: ctx.link.spacesId,
          userId,
          content,
          uploadedFiles,
          createdAt: message.createdAt,
          emitsMessageReceivedViaSideEffects: true,
        });

    // Mapped before side effects run, so the outbound hook sees it as INCOMING and skips it.
    await this.messageMap.create({
      sourceId: ctx.sourceId,
      externalId: message.id,
      threadId: message.threadId ?? message.id,
      messageId: created.messageId,
      direction: MessageDirection.INCOMING,
    });
    void this.runSideEffects(userId, created.messageId);
    return created.messageId;
  }

  private async editSpacesMessage(ctx: InboundContext, message: ProviderMessage): Promise<void> {
    const messageId = await this.findIncomingMessageId(ctx, message.id);
    if (!messageId) return;
    const content = await this.provider.transformer.toSpaces(message, ctx.config);
    await conversationService.updateMessageContent({ messageId, content });
  }

  private async deleteSpacesMessage(ctx: InboundContext, externalMessageId: string): Promise<void> {
    const messageId = await this.findIncomingMessageId(ctx, externalMessageId);
    if (!messageId) return;
    const message = await repositories.messages.findById(messageId);
    if (message) await deleteConversationMessage(messageId, message.senderId);
  }

  /** Edits and deletes follow only messages that came from the provider and still exist in Spaces. */
  private async findIncomingMessageId(
    ctx: InboundContext,
    externalMessageId: string
  ): Promise<string | null> {
    const row = await this.messageMap.findByExternalId(ctx.sourceIds, externalMessageId);
    if (!row || row.direction !== MessageDirection.INCOMING) return null;
    const message = await repositories.messages.findById(row.messageId);
    return message && !message.isDeleted ? message.messageId : null;
  }

  private async findOrCreateAuthor(
    ctx: InboundContext,
    message: ProviderMessage
  ): Promise<string | null> {
    const workspaceId = ctx.link.workspaceId;
    const userId = message.authorId
      ? await this.identity.findOrCreateSpacesUser(ctx.api, workspaceId, message.authorId)
      : null;
    return userId ?? (await this.identity.findOrCreateSpacesBot(workspaceId, message));
  }

  /** A reply's Spaces conversation. A parent from before the link is copied first, once. */
  private async findOrCopyThreadConversation(
    ctx: InboundContext,
    threadId: string
  ): Promise<string | null> {
    const mapped = await this.findMappedConversation(ctx, threadId);
    if (mapped) return mapped;

    const lock = await acquireLock(messageLockKey(ctx.link.id, threadId), {
      ttlSeconds: gatewayConfig.lockTtlSeconds,
      waitTimeoutMs: PARENT_LOCK_WAIT_MS,
    });
    if (!lock) throw new GatewayError('LOCK_HELD', 'Thread parent is still being copied');
    try {
      const again = await this.findMappedConversation(ctx, threadId);
      if (again) return again;
      const parent = await ctx.api.findThreadParent(ctx.link.externalId, threadId);
      const parentMessageId = parent ? await this.createSpacesMessage(ctx, parent) : null;
      return parentMessageId ? await this.findConversationId(parentMessageId) : null;
    } finally {
      await releaseLock(lock);
    }
  }

  private async findMappedConversation(
    ctx: InboundContext,
    threadId: string
  ): Promise<string | null> {
    const row =
      (await this.messageMap.findByExternalId(ctx.sourceIds, threadId)) ??
      (await this.messageMap.findByThreadId(ctx.sourceIds, threadId));
    return row ? await this.findConversationId(row.messageId) : null;
  }

  private async findConversationId(messageId: string): Promise<string | null> {
    return (await repositories.messages.findById(messageId))?.conversationId ?? null;
  }

  private async downloadFiles(ctx: InboundContext, message: ProviderMessage) {
    if (message.files.length === 0) return [];
    return await this.attachments.downloadAttachmentsForSource(
      ctx.sourceName,
      message.files.map((file) => ({
        fileName: file.name,
        fileUrl: file.url,
        mimeType: file.mimeType,
        size: file.size,
      })),
      {
        maxFileSize: gatewayConfig.maxFileBytes,
        timeout: gatewayConfig.fileTimeoutMs,
        scopeType: 'EXTERNAL_MESSAGE',
        scopeId: ctx.sourceName,
      }
    );
  }

  /** Notifications, mentions and automations, as for any service-written message. */
  private async runSideEffects(userId: string, messageId: string): Promise<void> {
    try {
      const handler = new MessagesSideEffectHandler(await buildUserQueryContext(userId));
      await handler.onInsert({ entityId: messageId, entityType: 'messages', operation: 'insert' });
    } catch (error) {
      logger.error('[Mirror] Side effects failed', { messageId, error });
    }
  }
}
