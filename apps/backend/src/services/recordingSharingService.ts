import { randomUUID } from 'node:crypto';
import { Prisma, type EntityAccess } from '@prisma/client';
import {
  addReplyToData,
  EntityUserAccess,
  parseRepliesMd,
  serializeRepliesMd,
  ShareableEntityType,
  type GrantableEntityUserAccess,
  CallType,
  CanvasRole,
  ConversationParticipation,
  MessageType,
} from '@xyne/shared';
import { config } from '@/config/env';
import { db } from '@/database/client';
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
    }
  | { action: 'revoke'; targets: RecordingShareTarget[] }
  | { action: 'link_ticket'; ticketId: string }
  | { action: 'unlink_ticket' };

export interface RecordingSharingActor {
  userId: string;
  workspaceId: string;
}

export interface RecordingSharingResult {
  action: RecordingSharingCommand['action'];
  linkedTicketId?: string | null;
  linkedTicketMessageId?: string | null;
  shares?: Array<{ id: string; target: RecordingShareTarget; access: string }>;
}

interface LoadedRecording {
  id: string;
  externalId: string;
  title: string | null;
  metadata: Prisma.JsonValue;
  createdByUserId: string;
}

interface AccessChange {
  share: EntityAccess;
  activated: boolean;
}

export class RecordingSharingError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'RecordingSharingError';
  }
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const asMetadata = (value: Prisma.JsonValue): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

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
        return this.grant(callId, actor, command.targets, command.access ?? EntityUserAccess.VIEW);
      case 'revoke':
        return this.revoke(callId, actor, command.targets);
      case 'link_ticket':
        return this.linkTicket(callId, actor, command.ticketId);
      case 'unlink_ticket':
        return this.unlinkTicket(callId, actor);
    }
  }

  private async grant(
    callId: string,
    actor: RecordingSharingActor,
    targets: RecordingShareTarget[],
    access: GrantableEntityUserAccess,
  ): Promise<RecordingSharingResult> {
    const { shares, activities } = await this.runTransaction(async tx => {
      const recording = await this.loadManageableRecording(tx, callId, actor);
      await this.validateTargets(tx, recording, actor.workspaceId, targets);

      const shares: Array<{ id: string; target: RecordingShareTarget; access: string }> = [];
      const activities: RecordingAccessActivity[] = [];
      for (const target of targets) {
        const change = await this.setAccess(tx, recording, actor.workspaceId, target, access);
        shares.push({ id: change.share.id, target, access: change.share.entityUserAccess });
        if (change.activated && target.type !== 'channel') {
          activities.push({ shareId: change.share.id, action: 'recording_shared' });
        }
      }
      return { shares, activities };
    });

    await recordingSharingNotificationService.publish(actor.userId, activities);
    return { action: 'grant', shares };
  }

  private async revoke(
    callId: string,
    actor: RecordingSharingActor,
    targets: RecordingShareTarget[],
  ): Promise<RecordingSharingResult> {
    const { shares, activities, ticketUnlinked } = await this.runTransaction(async tx => {
      const recording = await this.loadManageableRecording(tx, callId, actor);
      const shares: Array<{ id: string; target: RecordingShareTarget; access: string }> = [];
      const activities: RecordingAccessActivity[] = [];
      const metadata = asMetadata(recording.metadata);
      const linkedTicketId = metadata['linkedTicketId'];
      const linkedMessageId = metadata['linkedTicketMessageId'];
      let linkedTicketChannelId: string | null = null;
      if (typeof linkedTicketId === 'string' || typeof linkedMessageId === 'string') {
        if (typeof linkedTicketId !== 'string' || typeof linkedMessageId !== 'string') {
          throw new RecordingSharingError('Recording ticket link metadata is incomplete', 409);
        }
        const linkedTicket = await tx.ticket.findFirst({
          where: { id: linkedTicketId, workspaceId: actor.workspaceId },
          select: { channelId: true },
        });
        if (!linkedTicket) throw new RecordingSharingError('Linked ticket not found', 409);
        linkedTicketChannelId = linkedTicket.channelId;
      }

      let ticketUnlinked = false;
      const uniqueTargets = [
        ...new Map(targets.map(target => [`${target.type}:${target.id}`, target])).values(),
      ];

      for (const target of uniqueTargets) {
        if (target.type === 'channel' && target.id === linkedTicketChannelId) {
          const removedLink = await this.removeLinkedTicket(tx, recording, actor, target.id);
          shares.push({
            id: removedLink.share.id,
            target,
            access: removedLink.share.entityUserAccess,
          });
          ticketUnlinked = true;
          continue;
        }

        const existing = await this.findShare(tx, recording.id, actor.workspaceId, target);
        if (!existing) continue;
        const wasActive = existing.entityUserAccess !== EntityUserAccess.REVOKED;
        const share =
          !wasActive
            ? existing
            : await tx.entityAccess.update({
                where: { id: existing.id },
                data: {
                  entityUserAccess: EntityUserAccess.REVOKED,
                  updatedAt: new Date(),
                },
              });
        await this.syncCanvasAccess(tx, recording, actor.workspaceId, target, 'revoke');
        shares.push({ id: share.id, target, access: share.entityUserAccess });
        if (wasActive && target.type !== 'channel') {
          activities.push({ shareId: share.id, action: 'recording_access_revoked' });
        }
      }
      return { shares, activities, ticketUnlinked };
    });

    await recordingSharingNotificationService.publish(actor.userId, activities);
    return {
      action: 'revoke',
      shares,
      ...(ticketUnlinked
        ? { linkedTicketId: null, linkedTicketMessageId: null }
        : {}),
    };
  }

  private async linkTicket(
    callId: string,
    actor: RecordingSharingActor,
    ticketId: string,
  ): Promise<RecordingSharingResult> {
    const transactionResult = await this.runTransaction(async tx => {
      const recording = await this.loadManageableRecording(tx, callId, actor);
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
      await this.setAccess(
        tx,
        recording,
        actor.workspaceId,
        target,
        EntityUserAccess.VIEW,
      );

      const messageId = randomUUID();
      const now = new Date();
      const recordingUrl = `${config.frontendUrl.replace(/\/$/, '')}/${actor.workspaceId}/recordings/${recording.externalId}`;
      const title = recording.title?.trim() || 'Untitled Recording';
      const content = `<p>🎥 <strong>${escapeHtml(title)}</strong><br/><a href="${escapeHtml(recordingUrl)}">View recording</a></p>`;
      await tx.message.create({
        data: {
          messageId,
          conversationId: ticket.conversationId,
          workspaceId: actor.workspaceId,
          senderId: actor.userId,
          content,
          msgType: MessageType.USER,
          metadata: {
            messageSubtype: 'recording_ticket_link',
            callId: recording.externalId,
            ticketId,
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
    await this.runTransaction(async tx => {
      const recording = await this.loadManageableRecording(tx, callId, actor);
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
    const existingShare = await this.findShare(tx, recording.id, actor.workspaceId, target);
    if (!existingShare || existingShare.entityUserAccess === EntityUserAccess.REVOKED) {
      throw new RecordingSharingError('Linked ticket access not found', 409);
    }
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
        workspaceId: true,
        createdByUserId: true,
      },
    });
    if (
      !call ||
      call.callType !== CallType.HEADLESS ||
      (call.workspaceId !== null && call.workspaceId !== actor.workspaceId)
    ) {
      throw new RecordingSharingError('Recording not found', 404);
    }
    if (call.createdByUserId !== actor.userId) {
      throw new RecordingSharingError(
        'Only the recording creator can manage sharing',
        403,
      );
    }
    return call;
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
          throw new RecordingSharingError('The recording owner already has access', 400);
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

  private findShare(
    tx: Prisma.TransactionClient,
    recordingId: string,
    workspaceId: string,
    target: RecordingShareTarget,
  ): Promise<EntityAccess | null> {
    return tx.entityAccess.findFirst({
      where: {
        workspaceId,
        shareableEntityType: ShareableEntityType.NOTE_TAKER,
        entityId: recordingId,
        ...targetWhere(target),
      },
    });
  }

  private async setAccess(
    tx: Prisma.TransactionClient,
    recording: LoadedRecording,
    workspaceId: string,
    target: RecordingShareTarget,
    access: GrantableEntityUserAccess,
  ): Promise<AccessChange> {
    const existing = await this.findShare(tx, recording.id, workspaceId, target);
    const activated = !existing || existing.entityUserAccess === EntityUserAccess.REVOKED;
    const share = existing
      ? await tx.entityAccess.update({
          where: { id: existing.id },
          data: { entityUserAccess: access, updatedAt: new Date() },
        })
      : await tx.entityAccess.create({
          data: {
            id: randomUUID(),
            workspaceId,
            shareableEntityType: ShareableEntityType.NOTE_TAKER,
            entityId: recording.id,
            entityUserAccess: access,
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
    const canvasIds = this.getShareCanvasIds(recording);
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
        await tx.canvasParticipant.deleteMany({ where: { canvasId, ...targetFields } });
      }
    }
  }

  private getShareCanvasIds(recording: LoadedRecording): string[] {
    const metadata = asMetadata(recording.metadata);
    const detailedSummaryCanvasId = metadata['detailedSummaryCanvasId'];
    const notesCanvasId = metadata['notesCanvasId'];
    if (typeof detailedSummaryCanvasId !== 'string' || detailedSummaryCanvasId.length === 0) {
      throw new RecordingSharingError('Detailed summary canvas is not ready yet', 409);
    }
    if (typeof notesCanvasId !== 'string' || notesCanvasId.length === 0) {
      throw new RecordingSharingError('Recording notes canvas is not ready yet', 409);
    }
    return [...new Set([detailedSummaryCanvasId, notesCanvasId])];
  }

}

export const recordingSharingService = new RecordingSharingService();
