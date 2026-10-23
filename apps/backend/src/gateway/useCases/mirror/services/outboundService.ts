import {
  ExternalAttachmentService,
  MessageDirection,
  MessageType,
  acquireLock,
  db,
  extractUserMentions,
  releaseLock,
  renewLock,
  repositories,
} from '../../../re-exports';
import type { LockHandle } from '../../../re-exports';
import { gatewayConfig } from '../../../config';
import type { BaseProvider } from '../../../core/base/baseProvider';
import { GatewayError } from '../../../core/errors';
import type {
  JobContext,
  OutboundFile,
  OutboundMessage,
  SpacesMessageChange,
} from '../../../core/types';
import type { IdentityService } from '../../../core/services/identityService';
import type { UserApi, UserAuthService } from '../../../core/services/userAuthService';
import { buildMessageSource, legacyMessageSourceNames } from '../messageSources';
import { MessageMapRepository } from '../repositories/messageMapRepository';
import { MessageSourceRepository } from '../repositories/messageSourceRepository';
import {
  MIRROR_ORIGIN_TYPE,
  type MirrorApi,
  type MirrorConnection,
  type MirrorLink,
} from '../types';

interface OutboundContext {
  link: MirrorLink;
  api: MirrorApi;
  sourceId: string;
  sourceIds: string[];
  job: JobContext;
}

interface FileRef {
  id: string;
  name: string;
}

interface Draft {
  messageId: string;
  message: OutboundMessage;
  files: FileRef[];
  notes: string[];
  sendLock: LockHandle;
}

interface Delivery {
  poster?: string;
  uploaded?: Record<string, string>;
  startedAt?: number;
  sharedFileId?: string;
}

const sendLockKey = (messageId: string): string => `mirror:send:${messageId}`;

/** Held while a message is posted as a person, until its map row exists; the events controller checks it. */
export const sendAsLockKey = (linkId: string, externalUserId: string): string =>
  `mirror:send-as:${linkId}:${externalUserId}`;

const SEND_AS_WAIT_MS = 10_000;
const SEND_WAIT_MS = 10_000;
const BOT_POSTER = 'bot';

// A person's token that can't reach the channel, lacks a scope, or didn't post that message falls back to the bot.
const SENDER_FALLBACK: ReadonlySet<string> = new Set([
  'CHANNEL_GONE',
  'NOT_MESSAGE_AUTHOR',
  'NOT_PERMITTED',
]);

const couldNotCopy = (fileName: string): string => `📎 ${fileName} (couldn't copy)`;
const withNotes = (text: string, notes: string[]): string =>
  [text, ...notes].filter(Boolean).join('\n');

/** Sends Spaces message changes to the provider. Only Mirror's own posts are edited or deleted there. */
export class OutboundService {
  private readonly sources = new MessageSourceRepository();
  private readonly messageMap = new MessageMapRepository();
  private readonly attachments = new ExternalAttachmentService();

  constructor(
    private readonly provider: BaseProvider<unknown, MirrorApi>,
    private readonly identity: IdentityService,
    private readonly userAuth: UserAuthService<MirrorApi>
  ) {}

  async sendMessageChange(
    link: MirrorLink,
    connection: MirrorConnection,
    change: SpacesMessageChange,
    job: JobContext
  ): Promise<void> {
    const source = buildMessageSource(this.provider.id, link);
    const legacyNames = legacyMessageSourceNames(this.provider.id, link);
    const { sourceId, sourceIds } = await this.sources.findMessageScopes(source, legacyNames, link);
    const ctx: OutboundContext = {
      link,
      api: connection.api,
      sourceId,
      sourceIds,
      job,
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
      const files = await repositories.messageAttachments.findByMessageId(change.messageId);
      await this.asPoster(ctx, message.senderId, async (api, asBot) => {
        const sender = asBot ? await this.findSenderIdentity(ctx, message.senderId) : null;
        await api.updateMessage(link.externalId, row.externalId, {
          text,
          hasFiles: files.length > 0,
          ...(sender && { senderName: sender.name }),
        });
      });
    }
  }

  /** Edits and deletes go out as whoever posted: the sender's own token first, else the bot. */
  private async asPoster(
    ctx: OutboundContext,
    senderId: string | undefined,
    fn: (api: MirrorApi, asBot: boolean) => Promise<void>
  ): Promise<void> {
    const sender = senderId ? await this.userAuth.findUserApi(senderId) : null;
    if (sender && (await this.callAsSender(sender, (api) => fn(api, false)))) return;
    await fn(ctx.api, true);
  }

  /** Posts a message once and returns its provider id; a reply's parent from before the link is posted first. */
  private async postToProvider(ctx: OutboundContext, messageId: string): Promise<string | null> {
    const lock = await acquireLock(sendLockKey(messageId), {
      ttlSeconds: gatewayConfig.lockTtlSeconds,
      waitTimeoutMs: SEND_WAIT_MS,
    });
    if (!lock) throw new GatewayError('LOCK_HELD', 'This message is still being sent');
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

      const [{ files, skipped }, text] = await Promise.all([
        this.listMessageFiles(messageId),
        this.toProviderText(ctx, message.content),
      ]);
      if (!text && files.length === 0 && skipped.length === 0) return null;

      const draft: Draft = {
        messageId,
        message: {
          channelId: ctx.link.externalId,
          threadId: threadId ?? undefined,
          text,
          origin: { type: MIRROR_ORIGIN_TYPE, id: messageId },
        },
        files,
        notes: skipped.map(couldNotCopy),
        sendLock: lock,
      };
      const sender = await this.userAuth.findUserApi(message.senderId);
      const earlier = await this.findEarlierPost(ctx, draft, sender);
      if (earlier) {
        await this.record(ctx, draft, earlier);
        return earlier;
      }
      return (
        (sender ? await this.postAsSender(ctx, sender, draft) : null) ??
        (await this.postAsBot(ctx, draft, message.senderId))
      );
    } finally {
      await releaseLock(lock);
    }
  }

  private async findEarlierPost(
    ctx: OutboundContext,
    draft: Draft,
    sender: UserApi<MirrorApi> | null
  ): Promise<string | null> {
    const delivery = ctx.job.getProgress<Delivery>(draft.messageId);
    if (!delivery?.startedAt) return null;
    if (delivery.sharedFileId) {
      return await ctx.api.findFileMessage(draft.message.channelId, delivery.sharedFileId);
    }
    return await ctx.api.findPostedMessage(
      draft.message.channelId,
      draft.message.threadId,
      new Date(delivery.startedAt),
      {
        origin: { type: MIRROR_ORIGIN_TYPE, id: draft.messageId },
        text: withNotes(draft.message.text, draft.notes),
        ...(sender && { authorId: sender.externalUserId }),
      }
    );
  }

  /**
   * Posts with the sender's own token when they signed in. The map row is written before the echo lock
   * is released, so the provider's echo of their post is seen as already copied. Null: the bot posts.
   */
  private async postAsSender(
    ctx: OutboundContext,
    sender: UserApi<MirrorApi>,
    draft: Draft
  ): Promise<string | null> {
    const posted = await this.callAsSender(sender, async (api) => {
      const { fileIds, notes } = await this.uploadFiles(ctx, api, sender.externalUserId, draft);
      const lock = await acquireLock(sendAsLockKey(ctx.link.id, sender.externalUserId), {
        ttlSeconds: gatewayConfig.lockTtlSeconds,
        waitTimeoutMs: SEND_AS_WAIT_MS,
      });
      if (!lock)
        throw new GatewayError('LOCK_HELD', 'Another message from this person is being sent');
      try {
        const message = { ...draft.message, text: withNotes(draft.message.text, notes) };
        return await this.publish(ctx, api, draft, message, fileIds);
      } finally {
        await releaseLock(lock);
      }
    });
    return posted?.value ?? null;
  }

  /**
   * The bot posts under the sender's provider name and photo when they have an account there, else their
   * Spaces ones; the provider decides how to show them.
   */
  private async postAsBot(ctx: OutboundContext, draft: Draft, senderId: string): Promise<string> {
    const { name, avatarUrl } = await this.findSenderIdentity(ctx, senderId);
    const { fileIds, notes } = await this.uploadFiles(ctx, ctx.api, BOT_POSTER, draft);
    const message: OutboundMessage = {
      ...draft.message,
      text: withNotes(draft.message.text, notes),
      senderName: name,
      senderAvatarUrl: avatarUrl,
    };
    return await this.publish(ctx, ctx.api, draft, message, fileIds);
  }

  private async callAsSender<T>(
    sender: UserApi<MirrorApi>,
    fn: (api: MirrorApi) => Promise<T>
  ): Promise<{ value: T } | null> {
    try {
      return await this.userAuth.callAsUser(sender, fn);
    } catch (error) {
      if (error instanceof GatewayError && SENDER_FALLBACK.has(error.code)) return null;
      throw error;
    }
  }

  private async findSenderIdentity(
    ctx: OutboundContext,
    senderId: string
  ): Promise<{ name: string; avatarUrl: string | undefined }> {
    const [sender, externalSender] = await Promise.all([
      repositories.users.findById(senderId),
      // A failed lookup only costs the provider's name and photo; the Spaces ones are used instead.
      this.identity.findExternalUser(ctx.api, senderId).catch(() => null),
    ]);
    return {
      name: externalSender?.name ?? sender?.name ?? 'Spaces',
      avatarUrl: externalSender?.avatarUrl ?? sender?.picture ?? undefined,
    };
  }

  private async uploadFiles(
    ctx: OutboundContext,
    api: MirrorApi,
    poster: string,
    draft: Draft
  ): Promise<{ fileIds: string[]; notes: string[] }> {
    const notes = [...draft.notes];
    if (draft.files.length === 0) return { fileIds: [], notes };
    const saved = ctx.job.getProgress<Delivery>(draft.messageId);
    const uploaded = saved?.poster === poster ? { ...saved.uploaded } : {};
    for (const ref of draft.files) {
      if (uploaded[ref.id]) continue;
      const ttlSeconds = gatewayConfig.lockTtlSeconds + gatewayConfig.fileTimeoutMs / 1_000;
      if (!(await renewLock(draft.sendLock, ttlSeconds))) {
        throw new GatewayError('LOCK_HELD', 'This message is being sent elsewhere');
      }
      try {
        const file = await this.loadFile(ref);
        if (!file) {
          notes.push(couldNotCopy(ref.name));
          continue;
        }
        uploaded[ref.id] = await api.uploadFile(file);
        await ctx.job.setProgress(draft.messageId, { poster, uploaded });
      } catch (error) {
        const failedUpload = error instanceof GatewayError && error.code === 'PROVIDER_ERROR';
        if (!ctx.job.lastAttempt || !failedUpload) throw error;
        notes.push(couldNotCopy(ref.name));
      }
    }
    return { fileIds: draft.files.flatMap((ref) => uploaded[ref.id] ?? []), notes };
  }

  private async publish(
    ctx: OutboundContext,
    api: MirrorApi,
    draft: Draft,
    message: OutboundMessage,
    fileIds: string[]
  ): Promise<string> {
    const [sharedFileId] = fileIds;
    const saved = ctx.job.getProgress<Delivery>(draft.messageId);
    await ctx.job.setProgress(draft.messageId, {
      ...saved,
      startedAt: Date.now(),
      ...(sharedFileId && { sharedFileId }),
    });
    const externalId = sharedFileId
      ? await api.shareFiles(message, fileIds)
      : await api.postMessage(message);
    await this.record(ctx, draft, externalId);
    return externalId;
  }

  private async record(ctx: OutboundContext, draft: Draft, externalId: string): Promise<void> {
    await this.messageMap.create({
      sourceId: ctx.sourceId,
      externalId,
      threadId: draft.message.threadId ?? externalId,
      messageId: draft.messageId,
      direction: MessageDirection.OUTGOING,
    });
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

  private async listMessageFiles(
    messageId: string
  ): Promise<{ files: FileRef[]; skipped: string[] }> {
    const rows = await repositories.messageAttachments.findByMessageId(messageId);
    const fits = (row: { size: number }): boolean => row.size <= gatewayConfig.maxFileBytes;
    return {
      files: rows.filter(fits).map((row) => ({ id: row.id, name: row.originalFilename })),
      skipped: rows.filter((row) => !fits(row)).map((row) => row.originalFilename),
    };
  }

  private async loadFile(ref: FileRef): Promise<OutboundFile | null> {
    const { attachments } = await this.attachments.prepareOutboundAttachments({
      attachmentIds: [ref.id],
    });
    const [attachment] = attachments;
    if (!attachment) return null;
    return {
      id: ref.id,
      name: attachment.name,
      mimeType: attachment.contentType,
      content: Buffer.isBuffer(attachment.content)
        ? attachment.content
        : Buffer.from(attachment.content),
    };
  }
}
