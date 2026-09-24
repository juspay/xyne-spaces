/**
 * Mention delivery: what a mentioned user gets, and the one path that gives it
 * to someone who could not get it when the message was sent.
 *
 * A mention is delivered by the messages onInsert side effect, once, against the
 * members the channel had at that moment — so someone mentioned while outside
 * the channel is dropped, on the assumption that the "not in channel" prompt
 * will resolve it. Adding them from that prompt used to do nothing more than put
 * them in the channel; `deliverMentionsToAddedMembers` gives them the mention.
 *
 * The pieces below are shared with the send path (messages-handler onInsert), so
 * a mention delivered late is built and worded exactly like a fresh one.
 */

import { v4 as uuidv4 } from 'uuid';
import { db } from '@/database/client';
import { withWorkspaceScope } from '@/database/tenant/context';
import { activityService, type CreateActivityParams } from '@/services/activity/activityService';
import { notificationService } from '@/services/notificationService';
import { slackService } from '@/services/slackService';
import { extractAllUsersForNotification } from '@/utils/mentionUtils';
import { getFlowJsonRawTextForMentions } from '@/utils/flowJson';
import { getSlackRecipientEmails } from '@/utils/notificationHelper';
import { prefetchFilterData, type PrefetchedFilterData } from '@/services/notificationFilterService';
import { ChannelRepository } from '@/database/repositories/channelRepository';
import { MessageAttachmentRepository } from '@/database/repositories/messageAttachmentRepository';
import type { AppMentionEventPayload } from '@/apps/types';
import { logger } from '@/utils/logger';
import { ActivityClassification, ChannelScopeType, MessageType, UserType } from '@xyne/shared';

const channelRepository = new ChannelRepository();
const messageAttachmentRepository = new MessageAttachmentRepository();

/** A user a message mentions by name or through a group. */
export interface MentionRecipient {
  userId: string;
  mentionSource: 'direct' | 'group';
}

/**
 * Who a message's mentions actually reach: named or group mentions of channel
 * members, never the sender. `only` narrows them to a known set — the users the
 * "not in channel" prompt just added.
 */
export function mentionRecipients(
  mentions: ReadonlyArray<{ userId: string; mentionSource: string }>,
  { participantIds, senderId, only }: {
    participantIds: ReadonlySet<string>;
    senderId: string;
    only?: ReadonlySet<string>;
  },
): MentionRecipient[] {
  return mentions
    .filter(u => (u.mentionSource === 'direct' || u.mentionSource === 'group')
      && participantIds.has(u.userId)
      && u.userId !== senderId
      && (!only || only.has(u.userId)))
    .map(u => ({ userId: u.userId, mentionSource: u.mentionSource as 'direct' | 'group' }));
}

/** The feed entry behind "you were mentioned", one per recipient. */
export function mentionActivities(
  recipients: ReadonlyArray<MentionRecipient>,
  { messageId, channelId, senderId, isThreadActivity }: {
    messageId: string;
    channelId: string;
    senderId: string;
    isThreadActivity: boolean;
  },
): CreateActivityParams[] {
  return recipients.map(user => ({
    id: uuidv4(),
    userId: user.userId,
    actorId: senderId,
    actorAction: user.mentionSource === 'direct' ? 'mentioned_user' as const : 'group_mention' as const,
    // Dual-write: populate both old and new columns
    actionSource: 'message' as const,
    actionSourceId: messageId,
    messageId: messageId,
    channelId,
    isThreadActivity,
    classification: ActivityClassification.PENDING,
  }));
}

/** The APP_MENTION payload, attachments included, so a tagged app sees the message. */
export async function appMentionPayload(msg: {
  messageId: string;
  conversationId: string;
  channelId: string;
  channelName: string;
  content: string;
  cleanContent: string;
  createdAt: Date;
  hasAttachment: boolean;
  senderId: string;
  senderName: string;
}): Promise<AppMentionEventPayload> {
  const attachments = msg.hasAttachment
    ? await messageAttachmentRepository.findByMessageId(msg.messageId)
    : [];
  return {
    conversationId: msg.conversationId,
    messageId: msg.messageId,
    content: msg.content,
    cleanContent: msg.cleanContent,
    createdAt: msg.createdAt,
    userId: msg.senderId,
    senderName: msg.senderName,
    channelId: msg.channelId,
    channelName: msg.channelName,
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
}

export interface NotifyMentionedCtx {
  workspaceId: string;
  messageId: string;
  conversationId: string;
  channelId: string;
  channelName: string;
  senderId: string;
  senderName: string;
  senderPicture: string;
  cleanContent: string;
  isReply: boolean;
  isDM?: boolean;
  isGroupDM?: boolean;
  mentionType?: string;
  prefetchedData?: PrefetchedFilterData;
  /** userId → email. Given, Slack covers whoever the in-product notification missed. */
  slackEmails?: Map<string, string>;
}

/**
 * Mention notifications for `userIds`, then Slack for whoever they did not
 * reach. Never throws: a mention that cannot be notified keeps its activity, and
 * Slack then covers everyone. Returns who was delivered to in-product.
 */
export async function notifyMentioned(userIds: string[], ctx: NotifyMentionedCtx): Promise<string[]> {
  if (userIds.length === 0) return [];

  let deliveredUserIds: string[] = [];
  try {
    ({ deliveredUserIds } = await notificationService.createMentionNotifications(
      userIds,
      ctx.messageId,
      ctx.conversationId,
      ctx.channelId,
      ctx.channelName,
      ctx.senderId,
      ctx.senderName,
      ctx.cleanContent,
      ctx.workspaceId,
      ctx.mentionType,
      ctx.isDM ?? false,
      ctx.isReply,
      ctx.senderPicture,
      ctx.prefetchedData,
      ctx.isGroupDM ?? false,
    ));
  } catch (error) {
    logger.error('[MentionDelivery] Mention notifications failed — sending Slack to all recipients', { error });
  }

  // Group DMs reach Slack through the DM notification instead.
  if (ctx.slackEmails && !ctx.isGroupDM) {
    await slackService.sendMentionNotifications(
      getSlackRecipientEmails([...ctx.slackEmails.values()], deliveredUserIds, ctx.slackEmails),
      ctx.senderName,
      ctx.channelName,
      ctx.channelId,
      ctx.conversationId,
      ctx.messageId,
      ctx.mentionType,
    );
  }
  return deliveredUserIds;
}

/**
 * What this needs from the side-effect handler: its workspace, its app-event
 * dispatch, and its own notification-preview and DM-naming helpers, so the copy
 * a late mention shows is the copy a fresh one shows.
 */
export interface MentionDeliveryDeps {
  workspaceId: string;
  emitAppMention: (payload: AppMentionEventPayload, appUserIds: string[]) => void;
  previewText: (content: string, msgType: string, hasAttachment: boolean) => string;
  dmChannelName: (memberNames: string[]) => string;
}

/**
 * Deliver the mention `addedUserIds` missed on `messageId`. They are the users
 * the "not in channel" prompt added, so "ignore" — which adds nobody — delivers
 * nothing, and anyone the message already mentioned is skipped: nobody is
 * mentioned twice.
 */
export async function deliverMentionsToAddedMembers(
  messageId: string,
  addedUserIds: ReadonlySet<string>,
  deps: MentionDeliveryDeps,
): Promise<void> {
  if (addedUserIds.size === 0) return;

  const message = await db.message.findUnique({
    where: { messageId },
    select: {
      senderId: true,
      content: true,
      conversationId: true,
      msgType: true,
      hasAttachment: true,
      createdAt: true,
      isDeleted: true,
    },
  });
  if (!message || message.isDeleted || message.msgType === MessageType.SYSTEM) return;

  const conversation = await db.conversation.findUnique({
    where: { conversationId: message.conversationId },
    select: { channelId: true, initialMessageId: true },
  });
  if (!conversation?.channelId) return;

  const { senderId, content, conversationId } = message;
  const { channelId } = conversation;
  const [channel, sender, participants] = await Promise.all([
    db.channel.findUnique({ where: { id: channelId }, select: { name: true, scopeType: true } }),
    db.user.findUnique({
      where: { id: senderId },
      select: { name: true, displayName: true, picture: true },
    }),
    db.channelParticipant.findMany({ where: { channelId }, select: { userId: true } }),
  ]);
  // A 1:1 DM has nobody to add, and never shows the prompt.
  if (!channel || channel.scopeType === ChannelScopeType.DM) return;

  const participantIds = new Set(participants.map(p => p.userId));
  const workspaceId = await channelRepository.getWorkspaceId(channelId);
  const mentionText = getFlowJsonRawTextForMentions(content) ?? content;
  const candidates = mentionRecipients(
    await extractAllUsersForNotification(mentionText, workspaceId),
    { participantIds, senderId, only: addedUserIds },
  );
  if (candidates.length === 0) return;

  const delivered = await withWorkspaceScope(() => db.activity.findMany({
    where: {
      messageId,
      userId: { in: candidates.map(u => u.userId) },
      actorAction: { in: ['mentioned_user', 'group_mention'] },
    },
    select: { userId: true },
  }));
  const deliveredIds = new Set(delivered.map(a => a.userId));
  const recipients = candidates.filter(u => !deliveredIds.has(u.userId));
  if (recipients.length === 0) return;

  const recipientIds = recipients.map(u => u.userId);
  const users = await db.user.findMany({
    where: { id: { in: [...participantIds] } },
    select: { id: true, email: true, name: true, displayName: true, userType: true },
  });
  const userMap = new Map(users.map(u => [u.id, u]));

  const isGroupDM = channel.scopeType === ChannelScopeType.GROUP_DM;
  const isThreadActivity = conversation.initialMessageId !== messageId;
  const channelName = isGroupDM
    ? deps.dmChannelName(users.map(u => u.displayName || u.name || 'Unknown')) || 'Direct Message'
    : channel.name || 'Unknown Channel';
  const senderName = sender?.displayName || sender?.name || 'Someone';
  const cleanContent = deps.previewText(content, message.msgType, message.hasAttachment);

  await activityService.createActivities(
    mentionActivities(recipients, { messageId, channelId, senderId, isThreadActivity }),
  );

  const appUserIds = recipientIds.filter(id => userMap.get(id)?.userType === UserType.APP);
  if (appUserIds.length > 0) {
    deps.emitAppMention(await appMentionPayload({
      messageId,
      conversationId,
      channelId,
      channelName: channel.name ?? channelId,
      content,
      cleanContent,
      createdAt: message.createdAt,
      hasAttachment: message.hasAttachment,
      senderId,
      senderName,
    }), appUserIds);
  }

  const prefetchedData = await prefetchFilterData(recipientIds, channelId).catch(e => {
    logger.error('[MentionDelivery] Failed to prefetch filter data', { error: e });
    return undefined;
  });

  await notifyMentioned(recipientIds, {
    workspaceId: deps.workspaceId,
    messageId,
    conversationId,
    channelId,
    channelName,
    senderId,
    senderName,
    senderPicture: sender?.picture ?? '',
    cleanContent,
    isReply: isThreadActivity,
    isGroupDM,
    prefetchedData,
    slackEmails: new Map(
      recipientIds
        .map(id => userMap.get(id))
        .filter(u => u?.email)
        .map(u => [u!.id, u!.email]),
    ),
  });
}
