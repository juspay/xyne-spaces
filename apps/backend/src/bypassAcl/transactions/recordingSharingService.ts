import { RecordingSharingService, RecordingSharingActor, asMetadata, RecordingSharingError, RecordingShareTarget, RECORDING_SHARE_INTENT, asSharePost, shareEntityTypeFor, targetData, targetWhere } from '@/services/recordingSharingService';
import { EntityUserAccess, MessageType, serializeRepliesMd, addReplyToData, parseRepliesMd, ConversationParticipation, CallVisibility, CanvasVisibility, type GrantableEntityUserAccess, buildInitialMessageMd, CanvasRole } from '@xyne/shared';
import { randomUUID } from 'node:crypto';
import { Prisma, EntityAccess } from '@prisma/client';
import type { RecordingAccessActivity } from '@/services/recordingSharingNotificationService';
import { logger } from '@/utils/logger';
import { transaction, type TableName } from '../base';
import { db } from '@/database/client';
import { isRecording } from '@/utils/callTypeUtils';
import { sanitizeMessageContent } from '@/utils/contentUtils';
import type { LoadedRecording, SharePost, AccessChange, RecordingShareIntent } from '@/services/recordingSharingService';
import { callShareService } from '@/services/callShareService';

/**
 * Relocated from services/recordingSharingService.ts's runTransaction: serializable transaction,
 * retried on a write conflict (P2034). Deliberately NOT exported — only the named operations in
 * this file may use it, each passing its own tables and reason.
 */
async function runTransaction<T>(
  tables: TableName[],
  reason: string,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await transaction(tables, reason, db, operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      const isWriteConflict = (error as { code?: string } | null)?.code === 'P2034';
      if (!isWriteConflict || attempt === maxAttempts) throw error;
    }
  }
  throw new Error('Recording sharing transaction retry limit exceeded');
}

export function setVisibilityTx(self: RecordingSharingService, callId: string, actor: RecordingSharingActor, visibility: CallVisibility) {
  return runTransaction(['Call', 'Canvas', 'ChannelParticipant', 'EntityAccess', 'UserGroupMapping'], 'setVisibility: call visibility and linked canvas visibility must commit atomically; tx is not ACL-wrapped', async tx => {
    const recording = await loadManageableRecording(self, tx, callId, actor);
    self.assertRecordingOnly(recording, 'Link access');
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
      where: { id: { in: self.getShareCanvasIds(recording) } },
      data: { visibility: canvasVisibility },
    });
  });
}

export function grantTx(self: RecordingSharingService, callId: string, actor: RecordingSharingActor, targets: RecordingShareTarget[]) {
  return runTransaction(['Call', 'Channel', 'ChannelParticipant', 'EntityAccess', 'User', 'UserGroup', 'UserGroupMapping'], 'grant: recording load and share-target validation must commit atomically; tx is not ACL-wrapped', async tx => {
    const recording = await loadManageableRecording(self, tx, callId, actor);
    await self.validateTargets(tx, recording, actor.workspaceId, targets);
  });
}

export function grantTx2(self: RecordingSharingService, callId: string, actor: RecordingSharingActor, targets: RecordingShareTarget[], access: GrantableEntityUserAccess, dmChannelIds: Map<string, string>, messageContent: string | undefined): { shares: any; activities: any; } | PromiseLike<{ shares: any; activities: any; }> {
  return runTransaction(['Call', 'CanvasParticipant', 'Channel', 'ChannelParticipant', 'Conversation', 'ConversationParticipant', 'EntityAccess', 'Message', 'User', 'UserGroup', 'UserGroupMapping'], 'grant: share rows, canvas access sync and share post messages must commit atomically; tx is not ACL-wrapped', async tx => {
    const recording = await loadManageableRecording(self, tx, callId, actor);
    await self.validateTargets(tx, recording, actor.workspaceId, targets);

    const shares: Array<{ id: string; target: RecordingShareTarget; access: string }> = [];
    const activities: RecordingAccessActivity[] = [];
    for (const target of targets) {
      const change = await setAccess(self, tx, recording, actor.workspaceId, target, access, RECORDING_SHARE_INTENT.DIRECT_SHARE);
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
        const post = await createRecordingPostMessage(tx, recording, actor, channelId, messageContent);
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
}

export function revokeTx(self: RecordingSharingService, callId: string, actor: RecordingSharingActor, targets: RecordingShareTarget[]): { shares: any; activities: any; } | PromiseLike<{ shares: any; activities: any; }> {
  return runTransaction(['Call', 'CanvasParticipant', 'ChannelParticipant', 'Conversation', 'ConversationParticipant', 'EntityAccess', 'Message', 'MessageAttachment', 'Reaction', 'ReactionCount', 'Ticket', 'UserGroupMapping'], 'revoke: share revocation, canvas access sync and share post cleanup must commit atomically; tx is not ACL-wrapped', async tx => {
    const recording = await loadManageableRecording(self, tx, callId, actor);
    const shares: Array<{ id: string; target: RecordingShareTarget; access: string }> = [];
    const activities: RecordingAccessActivity[] = [];
    const uniqueTargets = [
      ...new Map(targets.map(target => [`${target.type}:${target.id}`, target])).values(),
    ];

    for (const target of uniqueTargets) {
      const existing = await self.findShare(
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
        await deleteRecordingPostMessage(tx, sharePost);
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
      await syncCanvasAccess(self, tx, recording, actor.workspaceId, target, 'revoke');
      shares.push({ id: share.id, target, access: share.entityUserAccess });
      if (wasActive && target.type !== 'channel') {
        activities.push({ shareId: share.id, action: 'recording_access_revoked' });
      }
    }
    return { shares, activities };
  });
}

export function linkTicketTx(self: RecordingSharingService, callId: string, actor: RecordingSharingActor, ticketId: string) {
  return runTransaction(['Call', 'CanvasParticipant', 'Channel', 'ChannelParticipant', 'Conversation', 'ConversationParticipant', 'EntityAccess', 'Message', 'Ticket', 'UserGroupMapping'], 'linkTicket: ticket share, link message, participant rows and call metadata must commit atomically; tx is not ACL-wrapped', async tx => {
    const recording = await loadManageableRecording(self, tx, callId, actor);
    self.assertRecordingOnly(recording, 'Ticket linking');
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
    const ticketAccess = await setAccess(self, tx, recording, actor.workspaceId, target, EntityUserAccess.VIEW, RECORDING_SHARE_INTENT.TICKET_LINK);

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
}

export function unlinkTicketTx(self: RecordingSharingService, callId: string, actor: RecordingSharingActor) {
  return runTransaction(['Call', 'CanvasParticipant', 'ChannelParticipant', 'Conversation', 'ConversationParticipant', 'EntityAccess', 'Message', 'MessageAttachment', 'Reaction', 'ReactionCount', 'Ticket', 'UserGroupMapping'], 'unlinkTicket: linked ticket share, message and conversation cleanup must commit atomically; tx is not ACL-wrapped', async tx => {
    const recording = await loadManageableRecording(self, tx, callId, actor);
    self.assertRecordingOnly(recording, 'Ticket linking');
    await removeLinkedTicket(self, tx, recording, actor);
  });
}

  /** Creates the recording share conversation. */
export async function createRecordingPostMessage(tx: Prisma.TransactionClient, recording: LoadedRecording, actor: RecordingSharingActor, channelId: string, messageContent?: string): Promise<SharePost> {
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
        ? {
            messageSubtype: 'recording_share_post',
            isRecordingMessage: true,
            operation: 'recording_ended',
          }
        : { messageSubtype: 'call_share_post', isCallShareMessage: true, callRowId: recording.id }),
      ...(sanitizedMessageContent ? { messageContent: sanitizedMessageContent } : {}),
    };

    // Store the initial message snapshot for conversation lists.
    const initialMessageMd = buildInitialMessageMd({
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
      metadata,
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
export async function deleteRecordingPostMessage(tx: Prisma.TransactionClient, post: SharePost): Promise<void> {
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

    // Ticket.conversation is a required relation: a conversation carrying a ticket can't be
    // hard-deleted (Prisma Client throws P2014), so it falls through to the tombstone below.
    const hasTicket = (await tx.ticket.count({ where: { conversationId: post.conversationId } })) > 0;

    if (replyCount === 0 && !hasTicket) {
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
    const tombstoneMd = buildInitialMessageMd({
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

export async function removeLinkedTicket(self: RecordingSharingService, tx: Prisma.TransactionClient, recording: LoadedRecording, actor: RecordingSharingActor, expectedChannelId?: string): Promise<{ share: EntityAccess; channelId: string }> {
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
    const existingShare = await self.findShare(
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
    await syncCanvasAccess(self, tx, recording, actor.workspaceId, target, 'revoke');

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

export async function loadManageableRecording(self: RecordingSharingService, tx: Prisma.TransactionClient, callId: string, actor: RecordingSharingActor): Promise<LoadedRecording> {
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
    const canManage =
      (await self.hasActiveShare(tx, call, actor)) ||
      (!isRecording(call) && (await callShareService.isCallAudience(call, actor.userId)));
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

export async function setAccess(self: RecordingSharingService, tx: Prisma.TransactionClient, recording: LoadedRecording, workspaceId: string, target: RecordingShareTarget, access: GrantableEntityUserAccess, intent: RecordingShareIntent): Promise<AccessChange> {
    const existing = await self.findShare(tx, recording, workspaceId, target, intent);
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
    await syncCanvasAccess(self, tx, recording, workspaceId, target, 'grant');
    return { share, activated };
  }

export async function syncCanvasAccess(self: RecordingSharingService, tx: Prisma.TransactionClient, recording: LoadedRecording, workspaceId: string, target: RecordingShareTarget, action: 'grant' | 'revoke'): Promise<void> {
    const canvasIds = self.getShareCanvasIds(recording);
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
