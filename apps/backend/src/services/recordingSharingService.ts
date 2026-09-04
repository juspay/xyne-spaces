import { randomUUID } from 'node:crypto';
import { Prisma, type EntityAccess } from '@prisma/client';
import {
  addReplyToData,
  EntityUserAccess,
  parseRepliesMd,
  serializeInitialMessageMd,
  serializeRepliesMd,
  ShareableEntityType,
  type GrantableEntityUserAccess,
  CallType,
  CallVisibility,
  CanvasRole,
  CanvasVisibility,
  ConversationParticipation,
  MessageType,
} from '@xyne/shared';
import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import { isRecording } from '@/utils/callTypeUtils';
import { sanitizeMessageContent } from '@/utils/contentUtils';
import { logger } from '@/utils/logger';
import {
  recordingSharingNotificationService,
  type RecordingAccessActivity,
} from '@/services/recordingSharingNotificationService';

export type RecordingShareTarget =
  | { type: 'user'; id: string }
  | { type: 'user_group'; id: string }
  | { type: 'channel'; id: string };

export type RecordingSharingCommand =
  | {
      action: 'grant';
      targets: RecordingShareTarget[];
      access?: GrantableEntityUserAccess;
      /** Optional share message. */
      messageContent?: string;
    }
  | { action: 'revoke'; targets: RecordingShareTarget[] }
  | { action: 'link_ticket'; ticketId: string }
  | { action: 'unlink_ticket' }
  | { action: 'set_visibility'; visibility: CallVisibility };

export interface RecordingSharingActor {
  userId: string;
  workspaceId: string;
}

export interface RecordingSharingResult {
  action: RecordingSharingCommand['action'];
  linkedTicketId?: string | null;
  linkedTicketMessageId?: string | null;
  shares?: Array<{ id: string; target: RecordingShareTarget; access: string }>;
  visibility?: CallVisibility;
}

interface LoadedRecording {
  id: string;
  externalId: string;
  title: string | null;
  metadata: Prisma.JsonValue;
  callType: string;
  channelId: string | null;
  createdByUserId: string;
  startedAt: Date;
  endedAt: Date | null;
}

interface AccessChange {
  share: EntityAccess;
  activated: boolean;
}

type RecordingShareIntent = 'direct_share' | 'ticket_link';

const RECORDING_SHARE_INTENT = {
  DIRECT_SHARE: 'direct_share',
  TICKET_LINK: 'ticket_link',
} as const satisfies Record<string, RecordingShareIntent>;

/**
 * Recordings and regular calls share under separate entity types, so a recording
 * share can never widen a call's audience or the reverse (see calls-acl.ts).
 */
const shareEntityTypeFor = (callType: string): string =>
  callType === CallType.HEADLESS ? ShareableEntityType.NOTE_TAKER : ShareableEntityType.CALL;

export class RecordingSharingError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'RecordingSharingError';
  }
}

const asMetadata = (value: Prisma.JsonValue): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

// Posted conversation details stored on the access row.
interface SharePost {
  channelId: string;
  conversationId: string;
  messageId: string;
}

const getShareIntent = (value: Prisma.JsonValue): RecordingShareIntent | null => {
  const intent = asMetadata(value)['intent'];
  return intent === RECORDING_SHARE_INTENT.DIRECT_SHARE ||
    intent === RECORDING_SHARE_INTENT.TICKET_LINK
    ? intent
    : null;
};

const asSharePost = (value: Prisma.JsonValue): SharePost | null => {
  const record = asMetadata(value);
  return typeof record['channelId'] === 'string' &&
    typeof record['conversationId'] === 'string' &&
    typeof record['messageId'] === 'string'
    ? {
        channelId: record['channelId'],
        conversationId: record['conversationId'],
        messageId: record['messageId'],
      }
    : null;
};

const targetWhere = (target: RecordingShareTarget): Prisma.EntityAccessWhereInput =>
  target.type === 'user'
    ? { userId: target.id }
    : target.type === 'user_group'
      ? { userGroupId: target.id }
      : { channelId: target.id };

const targetData = (
  target: RecordingShareTarget,
): { userId: string } | { userGroupId: string } | { channelId: string } =>
  target.type === 'user'
    ? { userId: target.id }
    : target.type === 'user_group'
      ? { userGroupId: target.id }
      : { channelId: target.id };

export class RecordingSharingService {
  async execute(
    callId: string,
    actor: RecordingSharingActor,
    command: RecordingSharingCommand,
  ): Promise<RecordingSharingResult> {
    switch (command.action) {
      case 'grant':
        return this.grant(
          callId,
          actor,
          command.targets,
          command.access ?? EntityUserAccess.VIEW,
          command.messageContent,
        );
      case 'revoke':
        return this.revoke(callId, actor, command.targets);
      case 'link_ticket':
        return this.linkTicket(callId, actor, command.ticketId);
      case 'unlink_ticket':
        return this.unlinkTicket(callId, actor);
      case 'set_visibility':
        return this.setVisibility(callId, actor, command.visibility);
    }
  }

  private async setVisibility(
    callId: string,
    actor: RecordingSharingActor,
    visibility: CallVisibility,
  ): Promise<RecordingSharingResult> {
    await this.runTransaction(async tx => {
      const recording = await this.loadManageableRecording(tx, callId, actor);
      this.assertRecordingOnly(recording, 'Link access');
      if (recording.createdByUserId !== actor.userId) {
        throw new RecordingSharingError(
          'Only the recording creator can change link access',
          403,
        );
      }
      await tx.call.update({
        where: { id: recording.id },
        data: { visibility },
      });
      const canvasVisibility =
        visibility === CallVisibility.PUBLIC
          ? CanvasVisibility.PUBLIC
          : CanvasVisibility.PRIVATE;
      await tx.canvas.updateMany({
        where: { id: { in: await this.getShareCanvasIds(tx, recording) } },
        data: { visibility: canvasVisibility },
      });
    });
    return { action: 'set_visibility', visibility };
  }

  private async grant(
    callId: string,
    actor: RecordingSharingActor,
    targets: RecordingShareTarget[],
    access: GrantableEntityUserAccess,
    messageContent?: string,
  ): Promise<RecordingSharingResult> {
    await this.runTransaction(async tx => {
      const recording = await this.loadManageableRecording(tx, callId, actor);
      await this.validateTargets(tx, recording, actor.workspaceId, targets);
    });

    // Resolve a separate 1:1 DM for each user.
    const dmChannelIds = new Map<string, string>();
    const userIds = [
      ...new Set(targets.flatMap(target => (target.type === 'user' ? [target.id] : []))),
    ];
    for (const userId of userIds) {
      const channelId = await repositories.channels.findOrCreateDMChannel(
        actor.userId,
        [userId],
        repositories.channelParticipants,
        actor.workspaceId,
      );
      dmChannelIds.set(userId, channelId);
    }

    const { shares, activities } = await this.runTransaction(async tx => {
      const recording = await this.loadManageableRecording(tx, callId, actor);
      await this.validateTargets(tx, recording, actor.workspaceId, targets);
      if (!isRecording(recording)) {
        await this.stampCallSummaryCanvasPointer(tx, recording);
      }

      const shares: Array<{ id: string; target: RecordingShareTarget; access: string }> = [];
      const activities: RecordingAccessActivity[] = [];
      for (const target of targets) {
        const change = await this.setAccess(
          tx,
          recording,
          actor.workspaceId,
          target,
          access,
          RECORDING_SHARE_INTENT.DIRECT_SHARE,
        );
        shares.push({ id: change.share.id, target, access: change.share.entityUserAccess });
        if (change.activated && target.type !== 'channel') {
          activities.push({ shareId: change.share.id, action: 'recording_shared' });
        }

        // Post once for channel and user shares.
        if (
          (target.type === 'channel' || target.type === 'user') &&
          !asSharePost(change.share.metadata)
        ) {
          const channelId = target.type === 'channel' ? target.id : dmChannelIds.get(target.id);
          if (!channelId) {
            throw new RecordingSharingError('Unable to resolve DM channel for user', 500);
          }
          const post = await this.createRecordingPostMessage(
            tx,
            recording,
            actor,
            channelId,
            messageContent,
          );
          await tx.entityAccess.update({
            where: { id: change.share.id },
            data: {
              metadata: {
                intent: RECORDING_SHARE_INTENT.DIRECT_SHARE,
                ...post,
              } as Prisma.InputJsonValue,
            },
          });
        }
      }
      return { shares, activities };
    });

    await recordingSharingNotificationService.publish(actor.userId, activities);
    return { action: 'grant', shares };
  }

  /** Creates the recording share conversation. */
  private async createRecordingPostMessage(
    tx: Prisma.TransactionClient,
    recording: LoadedRecording,
    actor: RecordingSharingActor,
    channelId: string,
    messageContent?: string,
  ): Promise<SharePost> {
    const conversationId = randomUUID();
    const messageId = randomUUID();
    const title =
      recording.title?.trim() || (isRecording(recording) ? 'Untitled Recording' : 'Untitled Call');
    // Store the recording title as the anchor content.
    const durationMs = recording.endedAt
      ? recording.endedAt.getTime() - recording.startedAt.getTime()
      : null;
    const trimmedMessageContent = messageContent?.trim();
    const sanitizedMessageContent = trimmedMessageContent
      ? sanitizeMessageContent(trimmedMessageContent)
      : undefined;
    const now = new Date();
    const metadata = {
      callId: recording.externalId,
      durationMs,
      ...(isRecording(recording)
        ? { messageSubtype: 'recording_share_post', isRecordingMessage: true, operation: 'recording_ended' }
        : // `callRowId` because the call detail route keys on `calls.id`, while every
          // call message carries `callId` as the externalId. isCallMessage is left
          // unset so this never renders as the live call header (see CallBubble).
          { messageSubtype: 'call_share_post', isCallShareMessage: true, callRowId: recording.id }),
      ...(sanitizedMessageContent ? { messageContent: sanitizedMessageContent } : {}),
    };

    // Store the initial message snapshot for conversation lists.
    const initialMessageMd = serializeInitialMessageMd({
      messageId,
      conversationId,
      workspaceId: actor.workspaceId,
      senderId: actor.userId,
      content: title,
      msgType: MessageType.USER,
      hasAttachment: false,
      edited: false,
      isDeleted: false,
      showInChannel: false,
      visibleTo: null,
      createdAt: now.getTime(),
      metadata: JSON.stringify(metadata),
      nudgeCount: null,
      isSent: true,
      reactions_md: null,
      link_preview_md: null,
      childConversationId: null,
    });

    await tx.conversation.create({
      data: {
        conversationId,
        channelId,
        workspaceId: actor.workspaceId,
        createdBy: actor.userId,
        initialMessageId: messageId,
        createdAt: now,
        lastActivityAt: now,
        initial_message_md: initialMessageMd,
      },
    });
    await tx.message.create({
      data: {
        messageId,
        conversationId,
        workspaceId: actor.workspaceId,
        senderId: actor.userId,
        content: title,
        msgType: MessageType.USER,
        createdAt: now,
        metadata,
      },
    });
    await tx.conversationParticipant.create({
      data: {
        id: randomUUID(),
        workspaceId: actor.workspaceId,
        conversationId,
        channelId,
        userId: actor.userId,
        participationType: ConversationParticipation.AUTHOR,
        isSubscribed: true,
        joinedAt: now,
        lastReadAt: now,
      },
    });

    return { channelId, conversationId, messageId };
  }

  /** Deletes a recording share conversation or tombstones its message. */
  private async deleteRecordingPostMessage(
    tx: Prisma.TransactionClient,
    post: SharePost,
  ): Promise<void> {
    const conversation = await tx.conversation.findFirst({
      where: {
        conversationId: post.conversationId,
        channelId: post.channelId,
        initialMessageId: post.messageId,
      },
      select: { conversationId: true },
    });
    if (!conversation) return;

    const replyCount = await tx.message.count({
      where: {
        conversationId: post.conversationId,
        messageId: { not: post.messageId },
      },
    });

    await Promise.all([
      tx.messageAttachment.deleteMany({ where: { entityId: post.messageId } }),
      tx.reaction.deleteMany({ where: { messageId: post.messageId } }),
      tx.reactionCount.deleteMany({ where: { messageId: post.messageId } }),
    ]);

    if (replyCount === 0) {
      await tx.conversationParticipant.deleteMany({
        where: { conversationId: post.conversationId },
      });
      await tx.message.deleteMany({ where: { messageId: post.messageId } });
      await tx.conversation.delete({ where: { conversationId: post.conversationId } });
      return;
    }

    const message = await tx.message.findUnique({
      where: { messageId: post.messageId },
      select: { senderId: true, createdAt: true, workspaceId: true },
    });
    if (!message) return;

    await tx.message.update({
      where: { messageId: post.messageId },
      data: {
        isDeleted: true,
        content: '',
        hasAttachment: false,
        edited: false,
        link_preview_md: '',
      },
    });
    // Update the conversation preview tombstone.
    const tombstoneMd = serializeInitialMessageMd({
      messageId: post.messageId,
      conversationId: post.conversationId,
      workspaceId: message.workspaceId,
      senderId: message.senderId,
      content: '',
      msgType: MessageType.USER,
      hasAttachment: false,
      edited: false,
      isDeleted: true,
      showInChannel: false,
      visibleTo: null,
      createdAt: message.createdAt.getTime(),
      metadata: null,
      nudgeCount: null,
      isSent: true,
      reactions_md: null,
      link_preview_md: '',
      childConversationId: null,
    });
    await tx.conversation.update({
      where: { conversationId: post.conversationId },
      data: { initial_message_md: tombstoneMd },
    });
  }

  private async revoke(
    callId: string,
    actor: RecordingSharingActor,
    targets: RecordingShareTarget[],
  ): Promise<RecordingSharingResult> {
    logger.info('[RecordingSharingService] Revoke access request received', {
      callId,
      actorUserId: actor.userId,
      workspaceId: actor.workspaceId,
      targets,
    });

    const { shares, activities } = await this.runTransaction(async tx => {
      const recording = await this.loadManageableRecording(tx, callId, actor);
      const shares: Array<{ id: string; target: RecordingShareTarget; access: string }> = [];
      const activities: RecordingAccessActivity[] = [];
      const uniqueTargets = [
        ...new Map(targets.map(target => [`${target.type}:${target.id}`, target])).values(),
      ];

      for (const target of uniqueTargets) {
        const existing = await this.findShare(
          tx,
          recording,
          actor.workspaceId,
          target,
          RECORDING_SHARE_INTENT.DIRECT_SHARE,
        );
        if (!existing) {
          logger.info('[RecordingSharingService] Revoke target had no direct-share row', {
            callId,
            target,
          });
          continue;
        }

        const sharePost = asSharePost(existing.metadata);
        logger.info('[RecordingSharingService] Evaluating revoke target', {
          callId,
          target,
          sharePostExists: !!sharePost,
          currentAccess: existing.entityUserAccess,
        });

        if (sharePost) {
          await this.deleteRecordingPostMessage(tx, sharePost);
        }

        const wasActive = existing.entityUserAccess !== EntityUserAccess.REVOKED;
        const share = await tx.entityAccess.update({
          where: { id: existing.id },
          data: {
            entityUserAccess: EntityUserAccess.REVOKED,
            metadata: { intent: RECORDING_SHARE_INTENT.DIRECT_SHARE },
            updatedAt: new Date(),
          },
        });
        await this.syncCanvasAccess(tx, recording, actor.workspaceId, target, 'revoke');
        shares.push({ id: share.id, target, access: share.entityUserAccess });
        if (wasActive && target.type !== 'channel') {
          activities.push({ shareId: share.id, action: 'recording_access_revoked' });
        }
      }
      return { shares, activities };
    });

    await recordingSharingNotificationService.publish(actor.userId, activities);
    return { action: 'revoke', shares };
  }

  private async linkTicket(
    callId: string,
    actor: RecordingSharingActor,
    ticketId: string,
  ): Promise<RecordingSharingResult> {
    const transactionResult = await this.runTransaction(async tx => {
      const recording = await this.loadManageableRecording(tx, callId, actor);
      this.assertRecordingOnly(recording, 'Ticket linking');
      const metadata = asMetadata(recording.metadata);
      const existingTicketId = metadata['linkedTicketId'];
      const existingMessageId = metadata['linkedTicketMessageId'];
      if (typeof existingTicketId === 'string' || typeof existingMessageId === 'string') {
        throw new RecordingSharingError('Unlink the current ticket before linking another one', 409);
      }
      const ticket = await tx.ticket.findFirst({
        where: { id: ticketId, workspaceId: actor.workspaceId },
        select: { id: true, channelId: true, conversationId: true },
      });
      if (!ticket) throw new RecordingSharingError('Ticket not found', 404);

      const conversation = await tx.conversation.findFirst({
        where: {
          conversationId: ticket.conversationId,
          channelId: ticket.channelId,
          workspaceId: actor.workspaceId,
        },
      });
      if (!conversation) {
        throw new RecordingSharingError('Ticket conversation not found', 409);
      }
      const channel = await tx.channel.findFirst({
        where: { id: ticket.channelId, workspaceId: actor.workspaceId },
        select: { id: true },
      });
      if (!channel) throw new RecordingSharingError('Ticket channel not found', 409);

      const target: RecordingShareTarget = { type: 'channel', id: ticket.channelId };
      const ticketAccess = await this.setAccess(
        tx,
        recording,
        actor.workspaceId,
        target,
        EntityUserAccess.VIEW,
        RECORDING_SHARE_INTENT.TICKET_LINK,
      );

      const messageId = randomUUID();
      const now = new Date();
      const title = recording.title?.trim() || 'Untitled Recording';
      // Use the recording title as the anchor content.
      const durationMs = recording.endedAt
        ? recording.endedAt.getTime() - recording.startedAt.getTime()
        : null;
      await tx.message.create({
        data: {
          messageId,
          conversationId: ticket.conversationId,
          workspaceId: actor.workspaceId,
          senderId: actor.userId,
          content: title,
          msgType: MessageType.USER,
          metadata: {
            messageSubtype: 'recording_ticket_link',
            callId: recording.externalId,
            ticketId,
            isRecordingMessage: true,
            operation: 'recording_ended',
            durationMs,
          },
        },
      });

      const repliesMd = serializeRepliesMd(
        addReplyToData(parseRepliesMd(conversation.replies_md), actor.userId),
      );
      await tx.conversation.update({
        where: { conversationId: ticket.conversationId },
        data: {
          lastActivityAt: now,
          replyCount: { increment: 1 },
          replies_md: repliesMd,
        },
      });
      await tx.conversationParticipant.updateMany({
        where: { conversationId: ticket.conversationId },
        data: { lastReplyAt: now },
      });
      await tx.conversationParticipant.upsert({
        where: {
          conversationId_userId: {
            conversationId: ticket.conversationId,
            userId: actor.userId,
          },
        },
        create: {
          id: randomUUID(),
          workspaceId: actor.workspaceId,
          conversationId: ticket.conversationId,
          channelId: ticket.channelId,
          userId: actor.userId,
          participationType: ConversationParticipation.AUTHOR,
          isSubscribed: true,
          joinedAt: now,
          lastReadAt: now,
          lastReplyAt: now,
        },
        update: {
          participationType: ConversationParticipation.AUTHOR,
          isSubscribed: true,
          channelId: ticket.channelId,
          lastReadAt: now,
          lastReplyAt: now,
        },
      });

      await tx.entityAccess.update({
        where: { id: ticketAccess.share.id },
        data: {
          metadata: {
            intent: RECORDING_SHARE_INTENT.TICKET_LINK,
            ticketId,
            messageId,
          },
        },
      });

      await tx.call.update({
        where: { id: recording.id },
        data: {
          metadata: {
            ...metadata,
            linkedTicketId: ticketId,
            linkedTicketMessageId: messageId,
          } as Prisma.InputJsonValue,
        },
      });

      return {
        linkedTicketId: ticketId,
        linkedTicketMessageId: messageId,
      };
    });

    return {
      action: 'link_ticket',
      linkedTicketId: transactionResult.linkedTicketId,
      linkedTicketMessageId: transactionResult.linkedTicketMessageId,
    };
  }

  private async unlinkTicket(
    callId: string,
    actor: RecordingSharingActor,
  ): Promise<RecordingSharingResult> {
    logger.info('[RecordingSharingService] Unlink ticket request received', {
      callId,
      actorUserId: actor.userId,
      workspaceId: actor.workspaceId,
    });

    await this.runTransaction(async tx => {
      const recording = await this.loadManageableRecording(tx, callId, actor);
      this.assertRecordingOnly(recording, 'Ticket linking');
      await this.removeLinkedTicket(tx, recording, actor);
    });

    return {
      action: 'unlink_ticket',
      linkedTicketId: null,
      linkedTicketMessageId: null,
    };
  }

  private async removeLinkedTicket(
    tx: Prisma.TransactionClient,
    recording: LoadedRecording,
    actor: RecordingSharingActor,
    expectedChannelId?: string,
  ): Promise<{ share: EntityAccess; channelId: string }> {
    const metadata = asMetadata(recording.metadata);
    const linkedTicketId = metadata['linkedTicketId'];
    const linkedMessageId = metadata['linkedTicketMessageId'];
    if (typeof linkedTicketId !== 'string' || typeof linkedMessageId !== 'string') {
      throw new RecordingSharingError('Recording is not linked to a ticket', 409);
    }

    const ticket = await tx.ticket.findFirst({
      where: { id: linkedTicketId, workspaceId: actor.workspaceId },
      select: { channelId: true, conversationId: true },
    });
    if (!ticket) throw new RecordingSharingError('Linked ticket not found', 409);
    if (expectedChannelId && ticket.channelId !== expectedChannelId) {
      throw new RecordingSharingError('Linked ticket channel does not match the removed access', 409);
    }

    const message = await tx.message.findFirst({
      where: {
        messageId: linkedMessageId,
        workspaceId: actor.workspaceId,
        conversationId: ticket.conversationId,
      },
    });
    if (!message) throw new RecordingSharingError('Linked ticket message not found', 409);

    const messageMetadata = asMetadata(message.metadata);
    if (
      messageMetadata['messageSubtype'] !== 'recording_ticket_link' ||
      messageMetadata['callId'] !== recording.externalId ||
      messageMetadata['ticketId'] !== linkedTicketId
    ) {
      logger.warn('[RecordingSharingService] Linked ticket message validation failed', {
        callId: recording.externalId,
        recordingId: recording.id,
        linkedTicketId,
        linkedMessageId,
        messageMetadata,
      });
      throw new RecordingSharingError('Linked ticket message does not match this recording', 409);
    }

    const conversation = await tx.conversation.findFirst({
      where: {
        conversationId: ticket.conversationId,
        channelId: ticket.channelId,
        workspaceId: actor.workspaceId,
      },
    });
    if (!conversation) throw new RecordingSharingError('Linked ticket conversation not found', 409);

    const target: RecordingShareTarget = { type: 'channel', id: ticket.channelId };
    const existingShare = await this.findShare(
      tx,
      recording,
      actor.workspaceId,
      target,
      RECORDING_SHARE_INTENT.TICKET_LINK,
    );
    if (!existingShare) {
      throw new RecordingSharingError('Linked ticket access not found', 409);
    }

    logger.info('[RecordingSharingService] Removing linked ticket', {
      callId: recording.externalId,
      recordingId: recording.id,
      targetChannelId: ticket.channelId,
      linkedTicketId,
      linkedMessageId,
    });

    const revokedShare = await tx.entityAccess.update({
      where: { id: existingShare.id },
      data: {
        entityUserAccess: EntityUserAccess.REVOKED,
        updatedAt: new Date(),
      },
    });
    await this.syncCanvasAccess(tx, recording, actor.workspaceId, target, 'revoke');

    await Promise.all([
      tx.messageAttachment.deleteMany({ where: { entityId: message.messageId } }),
      tx.reaction.deleteMany({ where: { messageId: message.messageId } }),
      tx.reactionCount.deleteMany({ where: { messageId: message.messageId } }),
    ]);
    await tx.message.delete({ where: { messageId: message.messageId } });

    const remainingReplies = await tx.message.findMany({
      where: {
        conversationId: conversation.conversationId,
        messageId: { not: conversation.initialMessageId },
        isDeleted: false,
      },
      orderBy: { createdAt: 'asc' },
      select: { senderId: true, createdAt: true },
    });
    const initialMessage = await tx.message.findUnique({
      where: { messageId: conversation.initialMessageId },
      select: { createdAt: true },
    });
    if (!initialMessage) throw new RecordingSharingError('Ticket initial message not found', 409);

    const repliers = remainingReplies.reduce<string[]>((ids, reply) => {
      const withoutSender = ids.filter(id => id !== reply.senderId);
      return [...withoutSender, reply.senderId];
    }, []);
    const latestReply = remainingReplies.at(-1);
    await tx.conversation.update({
      where: { conversationId: conversation.conversationId },
      data: {
        replyCount: remainingReplies.length,
        replies_md: serializeRepliesMd({ repliers }),
        lastActivityAt: latestReply?.createdAt ?? initialMessage.createdAt,
      },
    });

    const otherSenderMessage = await tx.message.findFirst({
      where: {
        conversationId: conversation.conversationId,
        senderId: message.senderId,
        isDeleted: false,
      },
      select: { messageId: true },
    });
    if (!otherSenderMessage) {
      await tx.conversationParticipant.deleteMany({
        where: {
          conversationId: conversation.conversationId,
          userId: message.senderId,
          participationType: ConversationParticipation.AUTHOR,
        },
      });
    }

    const nextMetadata = { ...metadata };
    delete nextMetadata['linkedTicketId'];
    delete nextMetadata['linkedTicketMessageId'];
    await tx.call.update({
      where: { id: recording.id },
      data: { metadata: nextMetadata as Prisma.InputJsonValue },
    });

    return { share: revokedShare, channelId: ticket.channelId };
  }

  private async loadManageableRecording(
    tx: Prisma.TransactionClient,
    callId: string,
    actor: RecordingSharingActor,
  ): Promise<LoadedRecording> {
    const call = await tx.call.findUnique({
      where: { externalId: callId },
      select: {
        id: true,
        externalId: true,
        title: true,
        metadata: true,
        callType: true,
        channelId: true,
        workspaceId: true,
        createdByUserId: true,
        startedAt: true,
        endedAt: true,
      },
    });
    if (!call || (call.workspaceId !== null && call.workspaceId !== actor.workspaceId)) {
      throw new RecordingSharingError('Recording not found', 404);
    }
    if (call.createdByUserId === actor.userId) return call;

    // One rule, stated per type: whoever can already see it may pass it on.
    // For a recording that is the creator and existing recipients; a call adds its
    // participants and channel, which is the audience it already had.
    const canManage =
      (await this.hasActiveShare(tx, call, actor)) ||
      (!isRecording(call) && (await this.isCallAudience(tx, call, actor.userId)));
    if (!canManage) {
      throw new RecordingSharingError(
        isRecording(call)
          ? 'Only the recording creator or people it is shared with can manage sharing'
          : 'Only people in this call, or people it is shared with, can share it',
        403,
      );
    }
    return call;
  }

  /**
   * Link visibility and ticket linking read and write recording-shaped state
   * (Call.visibility, Call.metadata canvas pointers) that a regular call does not
   * have, so they stay recordings-only rather than silently no-op'ing.
   */
  private assertRecordingOnly(recording: LoadedRecording, feature: string): void {
    if (!isRecording(recording)) {
      throw new RecordingSharingError(`${feature} is only available for recordings`, 400);
    }
  }

  /** Anyone who took part in the call, or belongs to the channel it happened in. */
  private async isCallAudience(
    tx: Prisma.TransactionClient,
    call: LoadedRecording,
    userId: string,
  ): Promise<boolean> {
    const participant = await tx.callParticipant.findFirst({
      where: { callId: call.id, userId },
      select: { id: true },
    });
    if (participant) return true;
    if (!call.channelId) return false;
    const member = await tx.channelParticipant.findFirst({
      where: { channelId: call.channelId, userId },
      select: { id: true },
    });
    return member !== null;
  }

  /**
   * Mirrors `entityAccessService.hasActiveShare`, but reads through the caller's
   * transaction so the permission check sees the same snapshot as the write it
   * guards.
   */
  private async hasActiveShare(
    tx: Prisma.TransactionClient,
    recording: Pick<LoadedRecording, 'id' | 'callType'>,
    actor: RecordingSharingActor,
  ): Promise<boolean> {
    const groupMappings = await tx.userGroupMapping.findMany({
      where: { userId: actor.userId },
      select: { userGroupId: true },
    });
    const channelParticipations = await tx.channelParticipant.findMany({
      where: { userId: actor.userId },
      select: { channelId: true },
    });
    const userGroupIds = groupMappings.map(mapping => mapping.userGroupId);
    const channelIds = channelParticipations.map(participation => participation.channelId);

    const share = await tx.entityAccess.findFirst({
      where: {
        workspaceId: actor.workspaceId,
        shareableEntityType: shareEntityTypeFor(recording.callType),
        entityId: recording.id,
        entityUserAccess: { not: EntityUserAccess.REVOKED },
        OR: [
          { userId: actor.userId },
          ...(userGroupIds.length ? [{ userGroupId: { in: userGroupIds } }] : []),
          ...(channelIds.length ? [{ channelId: { in: channelIds } }] : []),
        ],
      },
      select: { id: true },
    });
    return share !== null;
  }

  private async runTransaction<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await db.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        const isWriteConflict = (error as { code?: string } | null)?.code === 'P2034';
        if (!isWriteConflict || attempt === maxAttempts) throw error;
      }
    }
    throw new Error('Recording sharing transaction retry limit exceeded');
  }

  private async validateTargets(
    tx: Prisma.TransactionClient,
    recording: LoadedRecording,
    workspaceId: string,
    targets: RecordingShareTarget[],
  ): Promise<void> {
    for (const target of targets) {
      if (target.type === 'user') {
        if (target.id === recording.createdByUserId) {
          throw new RecordingSharingError(
            `The ${isRecording(recording) ? 'recording' : 'call'} owner already has access`,
            400,
          );
        }
        const user = await tx.user.findFirst({
          where: { id: target.id, workspaceId, leftAt: null },
          select: { id: true },
        });
        if (!user) throw new RecordingSharingError('User not found in this workspace', 400);
      } else if (target.type === 'user_group') {
        const group = await tx.userGroup.findFirst({
          where: { id: target.id, workspaceId },
          select: { id: true },
        });
        if (!group) throw new RecordingSharingError('User group not found in this workspace', 400);
      } else {
        const channel = await tx.channel.findFirst({
          where: { id: target.id, workspaceId },
          select: { id: true },
        });
        if (!channel) throw new RecordingSharingError('Channel not found in this workspace', 400);
      }
    }
  }

  private async findShare(
    tx: Prisma.TransactionClient,
    recording: Pick<LoadedRecording, 'id' | 'callType'>,
    workspaceId: string,
    target: RecordingShareTarget,
    intent: RecordingShareIntent,
  ): Promise<EntityAccess | null> {
    const shares = await tx.entityAccess.findMany({
      where: {
        workspaceId,
        shareableEntityType: shareEntityTypeFor(recording.callType),
        entityId: recording.id,
        ...targetWhere(target),
      },
    });
    return shares.find(share => getShareIntent(share.metadata) === intent) ?? null;
  }

  private async setAccess(
    tx: Prisma.TransactionClient,
    recording: LoadedRecording,
    workspaceId: string,
    target: RecordingShareTarget,
    access: GrantableEntityUserAccess,
    intent: RecordingShareIntent,
  ): Promise<AccessChange> {
    const existing = await this.findShare(tx, recording, workspaceId, target, intent);
    const activated = !existing || existing.entityUserAccess === EntityUserAccess.REVOKED;
    const share = existing
      ? await tx.entityAccess.update({
          where: { id: existing.id },
          data: {
            entityUserAccess: access,
            ...(existing.entityUserAccess === EntityUserAccess.REVOKED
              ? { metadata: { intent } }
              : {}),
            updatedAt: new Date(),
          },
        })
      : await tx.entityAccess.create({
          data: {
            id: randomUUID(),
            workspaceId,
            shareableEntityType: shareEntityTypeFor(recording.callType),
            entityId: recording.id,
            entityUserAccess: access,
            metadata: { intent },
            updatedAt: new Date(),
            ...targetData(target),
          },
        });
    await this.syncCanvasAccess(tx, recording, workspaceId, target, 'grant');
    return { share, activated };
  }

  private async syncCanvasAccess(
    tx: Prisma.TransactionClient,
    recording: LoadedRecording,
    workspaceId: string,
    target: RecordingShareTarget,
    action: 'grant' | 'revoke',
  ): Promise<void> {
    const canvasIds = await this.getShareCanvasIds(tx, recording);
    for (const canvasId of canvasIds) {
      const where =
        target.type === 'user'
          ? { canvasId_userId: { canvasId, userId: target.id } }
          : target.type === 'user_group'
            ? { canvasId_userGroupId: { canvasId, userGroupId: target.id } }
            : { canvasId_channelId: { canvasId, channelId: target.id } };
      const targetFields =
        target.type === 'user'
          ? { userId: target.id }
          : target.type === 'user_group'
            ? { userGroupId: target.id }
            : { channelId: target.id };
      if (action === 'grant') {
        await tx.canvasParticipant.upsert({
          where,
          create: {
            id: randomUUID(),
            canvasId,
            workspaceId,
            role: CanvasRole.VIEWER,
            ...targetFields,
          },
          update: {},
        });
      } else {
        const remainingAccess = await tx.entityAccess.findFirst({
          where: {
            workspaceId,
            shareableEntityType: shareEntityTypeFor(recording.callType),
            entityId: recording.id,
            entityUserAccess: { not: EntityUserAccess.REVOKED },
            ...targetWhere(target),
          },
          select: { id: true },
        });
        if (remainingAccess) continue;
        await tx.canvasParticipant.deleteMany({ where: { canvasId, ...targetFields } });
      }
    }
  }

  /**
   * A regular call's summary canvas is normally reached through its call message,
   * which a recipient outside the call's channel cannot read. Copy the pointer onto
   * the call row — the shape recordings already use — so a shared summary opens.
   * Written here rather than when the summary is generated: sharing is a single
   * writer, well clear of the concurrent post-call pipeline.
   */
  private async stampCallSummaryCanvasPointer(
    tx: Prisma.TransactionClient,
    recording: LoadedRecording,
  ): Promise<void> {
    const metadata = asMetadata(recording.metadata);
    if (typeof metadata['detailedSummaryCanvasId'] === 'string') return;
    const [canvasId] = await this.getShareCanvasIds(tx, recording);
    if (!canvasId) return;
    await tx.call.update({
      where: { id: recording.id },
      data: {
        metadata: { ...metadata, detailedSummaryCanvasId: canvasId } as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * Canvases a share has to carry along. A recording names them on its own row; a
   * regular call does not, so its summary canvas is found by the call it records
   * (stamped in createOrUpdateDetailedSummaryCanvas).
   */
  private async getShareCanvasIds(
    tx: Prisma.TransactionClient,
    recording: LoadedRecording,
  ): Promise<string[]> {
    if (!isRecording(recording)) {
      const canvases = await tx.canvas.findMany({
        where: {
          AND: [
            { metadata: { path: ['source'], equals: 'call_detailed_summary' } },
            { metadata: { path: ['callId'], equals: recording.externalId } },
          ],
        },
        select: { id: true },
      });
      return canvases.map(canvas => canvas.id);
    }

    const metadata = asMetadata(recording.metadata);
    const detailedSummaryCanvasId = metadata['detailedSummaryCanvasId'];
    const notesCanvasId = metadata['notesCanvasId'];
    const canvasIds: string[] = [];

    if (typeof detailedSummaryCanvasId === 'string' && detailedSummaryCanvasId.length > 0) {
      canvasIds.push(detailedSummaryCanvasId);
    }
    if (typeof notesCanvasId === 'string' && notesCanvasId.length > 0) {
      canvasIds.push(notesCanvasId);
    }

    return [...new Set(canvasIds)];
  }

}

export const recordingSharingService = new RecordingSharingService();
