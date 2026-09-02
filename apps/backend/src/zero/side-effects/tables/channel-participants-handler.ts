import { BaseSideEffectHandler } from '../base-handler';
import type { SideEffectJobConfig, ChannelParticipantPreviousValue } from '../types';
import { db } from '@/database/client';
import { notificationService } from '@/services/notificationService';
import { logger } from '@/utils/logger';
import { ChannelScopeType, UserType, MessageType } from '@xyne/shared';
import { refreshCanvasPermissionsForChannel } from '@/services/canvasPermissionSync';
import { extractAllUsersForNotification } from '@/utils/mentionUtils';
import { extractPlainTextFromHtml } from '@/utils/contentUtils';
import { handleEventSubscriptionsForUsers } from '@/apps/core/eventSubscriptionUtils';
import { AppEventType, type AppMentionEventPayload, type BaseAppEvent } from '@/apps/types';
import { MessageAttachmentRepository } from '@/database/repositories/messageAttachmentRepository';

const messageAttachmentRepository = new MessageAttachmentRepository();

/**
 * How far back to look for the message that triggered a suggestion-box add.
 * The add happens right after the mention, so a tight window is enough and it
 * prevents replaying a stale mention if the same app is re-added much later.
 */
const PENDING_MENTION_LOOKBACK_MS = 10 * 60 * 1000;
/** Cap on how many recent messages we scan for a pending mention. */
const PENDING_MENTION_SCAN_LIMIT = 20;

export class ChannelParticipantsSideEffectHandler extends BaseSideEffectHandler {

  /**
   * A member joined/left this channel → refresh the denormalized ACL of every canvas
   * shared to it. This is the precise membership signal (unlike a chat_container
   * re-feed, which also fires on message activity), so canvases aren't recomputed on
   * every message.
   */
  async onDelete(job: SideEffectJobConfig): Promise<void> {
    const previousValue = job.previousValue as ChannelParticipantPreviousValue | undefined;
    if (!previousValue) {
      logger.warn(`[ChannelParticipantsHandler] No previousValue for deleted participant ID: ${job.entityId}`);
      return;
    }
    await refreshCanvasPermissionsForChannel(previousValue.channelId).catch(err =>
      logger.error(`[ChannelParticipantsHandler] canvas ACL refresh failed for channel ${previousValue.channelId}: ${err}`),
    );
  }

  async onInsert(job: SideEffectJobConfig): Promise<void> {
    logger.info(`[ChannelParticipantsHandler] onInsert called for entity: ${job.entityId}`);

    try {
      // Query DB for participant record
      const participant = await db.channelParticipant.findUnique({
        where: { id: job.entityId },
        select: {
          channelId: true,
          userId: true,
        }
      });

      if (!participant) {
        logger.warn(`[ChannelParticipantsHandler] Participant not found for ID: ${job.entityId}`);
        return;
      }

      const { channelId, userId } = participant;

      // Member joined → refresh canvases shared to this channel (regardless of notification).
      await refreshCanvasPermissionsForChannel(channelId).catch(err =>
        logger.error(`[ChannelParticipantsHandler] canvas ACL refresh failed for channel ${channelId}: ${err}`));


      if (this.ctx.userID === userId) {
        logger.info(`[ChannelParticipantsHandler] User ${userId} joined channel ${channelId} themselves - skipping notification`);
        return; // Don't notify user when they join themselves
      }

      // Someone else added them - get the adder's info
      const adder = await db.user.findUnique({
        where: { id: this.ctx.userID },
        select: { name: true, displayName: true, id: true }
      });
      const adderName = adder?.displayName || adder?.name || 'Someone';
      const adderId = adder?.id || 'unknown';
      
      logger.info(`[ChannelParticipantsHandler] User ${userId} was added to channel ${channelId} by ${this.ctx.userID} (${adderName})`);

      // Query channel for name
      const channel = await db.channel.findUnique({
        where: { id: channelId },
        select: { name: true, scopeType: true }
      });

      const channelName = channel?.name || 'a channel';

      // Send notification to the added user
      await notificationService.createParticipantAddedNotifications(
        [userId],
        channelId,
        channel?.scopeType === ChannelScopeType.GROUP_DM ? 'a group DM' : channelName,
        adderId,
        adderName,
        this.ctx.workspaceId
      );

      logger.info(`[ChannelParticipantsHandler] Notification sent for user ${userId} added to channel ${channelId} by ${adderName}`);

      // Slice 1: if the just-added user is an installed APP that was @mentioned in a
      // recent message it wasn't yet a member of, replay that mention as an APP_MENTION
      // so the agent triggers automatically — the user should not have to re-tag it after
      // adding it from the suggestion box. Humans already got the participant-added
      // notification above, so this replay is APP-only. Fire-and-forget: a failure here
      // must never break the add/notify path.
      await this.replayPendingMentionForAddedApp(
        channelId,
        userId,
        channel?.name ?? channelId,
        channel?.scopeType as ChannelScopeType | undefined,
      ).catch(err =>
        logger.error(`[ChannelParticipantsHandler] pending-mention replay failed for user ${userId} in channel ${channelId}: ${err}`));

    } catch (error) {
      logger.error(`[ChannelParticipantsHandler] Failed to process onInsert for entity ${job.entityId}:`, error);
    }
  }

  /**
   * Re-fire the APP_MENTION event for an app that was @mentioned before it was a
   * channel member. On message create, mentions are only delivered to current
   * participants (messages-handler filters on channelParticipantIds), so a mention of
   * a non-member app is dropped. When that app is subsequently added — e.g. via the
   * compose-box "add to channel" suggestion — this replays the single most recent
   * triggering mention so the agent runs without the sender re-tagging it.
   *
   * Safety properties:
   * - APP users only. Humans are never auto-triggered (they get the participant-added
   *   notification instead).
   * - Bounded lookback + scan cap, so a much-later re-add can't resurrect a stale mention.
   * - Delivery reuses handleEventSubscriptionsForUsers, which no-ops for an app without a
   *   valid webhook and never delivers to the sender — so this can't self-trigger.
   * - onInsert only fires on a real participant insert (the mutator skips already-present
   *   members), so this won't double-fire against the original create-time delivery.
   */
  private async replayPendingMentionForAddedApp(
    channelId: string,
    addedUserId: string,
    channelName: string,
    scopeType: ChannelScopeType | undefined,
  ): Promise<void> {
    // DMs / group DMs have their own APP_MENTION delivery path; only the regular
    // channel add flow needs this replay.
    if (scopeType === ChannelScopeType.DM || scopeType === ChannelScopeType.GROUP_DM) {
      return;
    }

    const addedUser = await db.user.findUnique({
      where: { id: addedUserId },
      select: { userType: true },
    });
    if (addedUser?.userType !== UserType.APP) {
      return; // only agents auto-trigger on add
    }

    const workspaceId = this.ctx.workspaceId;
    const since = new Date(Date.now() - PENDING_MENTION_LOOKBACK_MS);

    const recentMessages = await db.message.findMany({
      where: {
        conversation: { is: { channelId } },
        isDeleted: false,
        msgType: { not: MessageType.SYSTEM },
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'desc' },
      take: PENDING_MENTION_SCAN_LIMIT,
      select: {
        messageId: true,
        conversationId: true,
        content: true,
        senderId: true,
        createdAt: true,
        hasAttachment: true,
      },
    });

    for (const msg of recentMessages) {
      if (msg.senderId === addedUserId) continue; // never trigger on the app's own message
      const content = msg.content ?? '';
      if (!content) continue;

      const mentioned = await extractAllUsersForNotification(content, workspaceId);
      const isDirectlyMentioned = mentioned.some(
        u => u.userId === addedUserId && (u.mentionSource === 'direct' || u.mentionSource === 'group'),
      );
      if (!isDirectlyMentioned) continue;

      // Found the message that triggered the add → replay APP_MENTION for this app only.
      const sender = await db.user.findUnique({
        where: { id: msg.senderId },
        select: { name: true, displayName: true, orgMemberId: true },
      });
      const senderName = sender?.displayName || sender?.name || 'Someone';
      const attachments = msg.hasAttachment
        ? await messageAttachmentRepository.findByMessageId(msg.messageId)
        : [];

      const payload: AppMentionEventPayload = {
        workspaceId,
        ...(sender?.orgMemberId ? { orgMemberId: sender.orgMemberId } : {}),
        conversationId: msg.conversationId,
        messageId: msg.messageId,
        content,
        cleanContent: extractPlainTextFromHtml(content).replace(/\s+/g, ' ').trim(),
        createdAt: msg.createdAt,
        userId: msg.senderId,
        senderName,
        channelId,
        channelName,
        ...(attachments.length > 0 && {
          attachments: attachments.map(att => ({
            attachmentId: att.id,
            fileName: att.originalFilename,
            fileSize: att.size,
            mimeType: att.mimetype,
            fileUrl: att.url,
          })),
        }),
      };

      const event: BaseAppEvent = {
        eventType: AppEventType.APP_MENTION,
        payload,
        timestamp: new Date().toISOString(),
      };

      await handleEventSubscriptionsForUsers(event, [addedUserId]);

      logger.info(
        `[ChannelParticipantsHandler] Replayed APP_MENTION for app ${addedUserId} on message ${msg.messageId} after add to channel ${channelId}`,
      );
      return; // only the most recent triggering mention is replayed
    }
  }
}
