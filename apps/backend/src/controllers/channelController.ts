import { Request, Response } from 'express';
import { WORKSPACE_LEVEL } from '@/integrations/core/sourceScope';
import { ExternalSourcePlatform } from '@/integrations/core/types';
import {
  buildAppDeskSourceName,
  buildSlackDeskSourceName,
  resolveAppDeskInstalledAppId,
  extractSlackChannelId,
} from '../integrations/core/deskSources';
import { ChannelRepository, CreateChannelInput } from '../database/repositories/channelRepository';
import { ChannelParticipantRepository } from '../database/repositories/channelParticipantRepository';
import { ConversationRepository, CreateConversationInput } from '../database/repositories/conversationRepository';
import { MessageRepository, CreateMessageInput } from '../database/repositories/messageRepository';
import { MessageAttachmentRepository } from '../database/repositories/messageAttachmentRepository';
import { UserRepository } from '../database/repositories/users';
import { UserGroupRepository } from '../database/repositories/userGroups';
import { ProjectRepository } from '../database/repositories/projectRepository';
import { Prisma, type User } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import {
  createForwardedMessageXml,
  parseForwardedMessageXml,
  ChannelScopeType,
  ChannelVisibility,
  MessageType,
  AttachmentEntityType,
  DeskType,
  EmailMergeMode,
  AppPermissionStatus,
  AppPermissionType,
  ActivityClassification,
  ActivityClassificationJobType, ChannelType, ChannelRole,
  normalizeHistoryScope,
  type AddGroupDmParticipantsRequest,
  type AddGroupDmParticipantsResponse,
} from '@xyne/shared';
import '../types/express'; // Import to enable Express types augmentation
import { unreadService } from '../services/unreadService';
import { redisService } from '../services/redisService';
import { notificationService } from '../services/notificationService';
import { ChannelParticipantsSideEffectHandler } from '../zero/side-effects/tables/channel-participants-handler';
import { handleUnreadCount } from '@/zero/utils/unreadCountUtlis';
import {
  CreateChannelResponse,
  CheckDuplicateChannelResponse,
} from '../api/types/ChannelTypes';
import { websocketService } from '../services/websocketService';
import { createChannelCreatedActivity } from '../utils/channelActivityUtils';
import { ChannelUserStatusRepository } from '@/database/repositories/channelUserStatusRepository';
import { EmailChannelPreferenceRepository } from '@/database/repositories/emailChannelPreferenceRepository';
import { userActivityTrackingService } from '@/services/userActivityTrackingService';
import { vespaQueue } from '@/queues/vespaQueue';
import { channelSchema } from '@/vespa/src/types';
import { db } from '@/database/client';
import { NAMESPACE } from '@/vespa/vespaConfig';
import {logger} from '@/utils/logger';
import { messageMetadataService } from '@/services/messageMetadataService';
import { extractSpecialMentions, getChannelParticipantsForMention, getOnlineChannelParticipants } from '@/utils/mentionUtils';
import { activityService } from '@/services/activity/activityService';
import { encrypt, decrypt } from '@/services/encryptionService';
import { vespaService } from '@/services/vespaSearch';
import { ChannelEmailAliasService } from '@/services/channelEmailAliasService';
import { ensureDmConversationAuthorParticipant } from '@/utils/dmConversationParticipants';
import { groupDmParticipantService } from '@/services/groupDmParticipantService';
import { AppError } from '@/middleware/errorHandler';

export class ChannelController {
  private channelRepository: ChannelRepository;
  private channelParticipantRepository: ChannelParticipantRepository;
  private conversationRepository: ConversationRepository;
  private messageRepository: MessageRepository;
  private messageAttachmentRepository: MessageAttachmentRepository;
  private userRepository: UserRepository;
  private userGroupRepository: UserGroupRepository;
  private channelUserStatusRepository: ChannelUserStatusRepository;
  private projectRepository: ProjectRepository;
  private emailChannelPreferenceRepository: EmailChannelPreferenceRepository;
  private channelEmailAliasService: ChannelEmailAliasService;

  constructor() {
    this.channelRepository = new ChannelRepository();
    this.channelParticipantRepository = new ChannelParticipantRepository();
    this.conversationRepository = new ConversationRepository();
    this.messageRepository = new MessageRepository();
    this.messageAttachmentRepository = new MessageAttachmentRepository();
    this.userRepository = new UserRepository();
    this.userGroupRepository = new UserGroupRepository();
    this.channelUserStatusRepository = new ChannelUserStatusRepository();
    this.projectRepository = new ProjectRepository();
    this.emailChannelPreferenceRepository = new EmailChannelPreferenceRepository();
    this.channelEmailAliasService = new ChannelEmailAliasService();
  }

  // Helper method to get user info
  private async getUserInfo(userId: string) {
    try {
      const user = await this.userRepository.findById(userId);
      if (user) {
        return {
          id: user.id,
          name: user.name,
          displayName: user.displayName,
          email: user.email,
          picture: user.picture
        };
      }
    } catch (error) {
      logger.warn(`Failed to lookup user ${userId}:`, error);
    }

    return {
      id: userId,
      name: 'User',
      email: 'user@example.com',
      picture: undefined
    };
  }

  // Helper method to send system message for added/removed participants
  private async sendAddAndRemoveParticipantsSystemMessage(
    channelId: string,
    newParticipants: Array<{ userId: string; userName: string }>,
    authData: { id: string; name: string },
    operationType:
      | 'participants_added'
      | 'participants_removed'
      | 'conversation_moved_source'
      | 'conversation_moved_target',
    options: { movedEverything?: boolean; destinationChannelId?: string } = {}
  ): Promise<void> {
    try {
      const isMove =
        operationType === 'conversation_moved_source' ||
        operationType === 'conversation_moved_target';
      if (newParticipants.length === 0 && operationType !== 'conversation_moved_target') {
        return;
      }

      // Names are user-supplied, so everything interpolated into the markup is escaped.
      const esc = (value: string): string =>
        value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      const userPill = (userId: string, userName: string): string =>
        `<span data-mention data-mention-type="user" data-user-id="${esc(userId)}" data-username="${esc(userName)}">${esc(userName)}</span>`;
      const channelPill = (id: string, label: string): string =>
        `<span data-channel-mention data-channel-id="${esc(id)}" data-channel-name="${esc(label)}" data-is-private="true">${esc(label)}</span>`;

      const pills = newParticipants.map(p => userPill(p.userId, p.userName));
      let formattedUsers = '';
      if (pills.length === 1) {
        formattedUsers = pills[0];
      } else if (pills.length > 1) {
        formattedUsers = `${pills.slice(0, -1).join(', ')} and ${pills[pills.length - 1]}`;
      }
      const actor = userPill(authData.id, authData.name);

      const addedOrRemovedText = operationType === 'participants_added' ? 'added' : 'removed';
      let systemContent: string;
      if (operationType === 'conversation_moved_source') {
        const howMany = options.movedEverything ? 'all' : 'some of';
        const destination = options.destinationChannelId
          ? channelPill(
              options.destinationChannelId,
              newParticipants.map(p => p.userName).join(', ')
            )
          : formattedUsers;
        systemContent = `${actor} moved ${howMany} the messages from this conversation to ${destination}`;
      } else if (operationType === 'conversation_moved_target') {
        systemContent = `${actor} moved messages from a previous conversation into this one`;
      } else {
        systemContent = `${formattedUsers} ${pills.length === 1 ? 'was' : 'were'} ${addedOrRemovedText} by ${actor}`;
      }

      // Create metadata
      const messageMetadata = {
        operationType,
        participants: newParticipants,
        adminUserId: authData.id,
        adminUserName: authData.name,
      };

      // Create conversation for system message
      const conversationData: CreateConversationInput = {
        channelId,
        createdBy: 'system',
        initialMessageId: 'temp', // Will be updated after message creation
      };

      const conversation = await this.conversationRepository.create(conversationData);

      // Create system message
      const messageData: CreateMessageInput = {
        conversationId: conversation.conversationId,
        senderId: isMove ? authData.id : newParticipants[0].userId,
        content: systemContent,
        msgType: MessageType.SYSTEM,
        hasAttachment: false,
        metadata: messageMetadata,
      };

      const createdMessage = await this.messageRepository.create(messageData);

      // Update conversation with real initial message ID
      await this.conversationRepository.update(conversation.conversationId, {
        initialMessageId: createdMessage.messageId,
      });
      await messageMetadataService.syncInitialMessageMd(conversation.conversationId);

      // Reopen DM for all participants so they can see the system message
      await this.channelUserStatusRepository.reopenForAllParticipants(channelId);

      // Get sender info
      const senderInfo = await this.getUserInfo(createdMessage.senderId);

      // Broadcast new conversation via WebSocket
      const conversationMessage = {
        conversationId: conversation.conversationId,
        channelId,
        messageId: createdMessage.messageId,
        senderId: createdMessage.senderId,
        senderName: senderInfo.name,
        senderPicture: senderInfo.picture,
        content: createdMessage.content,
        msgType: createdMessage.msgType,
        hasAttachment: createdMessage.hasAttachment,
        attachments: [],
        createdAt: createdMessage.createdAt,
      };

      await websocketService.broadcastToSession(channelId, 'new_conversation', conversationMessage);
      await redisService.broadcastMessageToSession(channelId, conversationMessage);
    } catch (error) {
      logger.error('Error sending add/remove participants system message:', error);
      logger.error('Channel ID:', channelId);
      logger.error('Operation type:', operationType);
      logger.error('Participants:', newParticipants);
      // Rethrow the error so the caller can handle it appropriately
      throw error;
    }
  }

  // Helper method to send initial message to a channel
  private async sendInitialMessage(
    channelId: string,
    senderId: string,
    messageContent: string
  ): Promise<{
    conversationId: string;
    initialMessage: {
      messageId: string;
      content: string;
      msgType: MessageType;
      hasAttachment: boolean;
      attachments: any[];
      createdAt: Date;
      sender: any;
    };
  } | null> {
    try {
      // Create conversation
      const conversationData: CreateConversationInput = {
        channelId: channelId,
        createdBy: senderId,
        initialMessageId: 'temp', // Will be updated after message creation
      };

      const conversation = await this.conversationRepository.create(conversationData);

      // Create initial message
      const messageData: CreateMessageInput = {
        conversationId: conversation.conversationId,
        senderId: senderId,
        content: messageContent.trim(),
        msgType: MessageType.USER,
        hasAttachment: false
      };

      const createdMessage = await this.messageRepository.create(messageData);

      // Update conversation with real initial message ID
      await this.conversationRepository.update(conversation.conversationId, {
        initialMessageId: createdMessage.messageId,
      });
      const targetChannel = await this.channelRepository.findById(channelId);
      if (targetChannel) {
        await ensureDmConversationAuthorParticipant({
          channelId,
          conversationId: conversation.conversationId,
          senderId,
          scopeType: targetChannel.scopeType as ChannelScopeType,
        });
      }
      await messageMetadataService.syncInitialMessageMd(conversation.conversationId);

      // Update channel last activity
      await this.channelRepository.updateLastActivity(channelId);

      // Reopen DM for all participants so they can see the message
      await this.channelUserStatusRepository.reopenForAllParticipants(channelId);

      // Get sender info
      const senderInfo = await this.getUserInfo(senderId);

      // Get channel participants for notifications and unread count
      const channelParticipants =
        await this.channelParticipantRepository.getChannelParticipants(channelId);

      // Get recipient IDs (all participants except sender)
      const recipientIds = channelParticipants
        .map(p => p.userId)
        .filter(userId => userId !== senderId);

      // Extract clean content for notification
      const cleanContent =
        messageContent.replace(/<[^>]*>/g, '').trim() || 'Sent a message';

      // Fetch workspaceId for notification URL
      const workspaceId = await this.channelRepository.getWorkspaceId(channelId);

      // Send notifications to recipients (skip for self-DMs)
      if (recipientIds.length > 0) {
        const isGroupDm = channelParticipants.length > 2;

        // @channel / @here in a group DM's first message must fire the explicit
        // channel-wide mention notification. This REST path bypasses the Zero
        // mutator pipeline, so the MessagesSideEffectHandler (which normally
        // handles special mentions) never runs — replicate its GROUP_DM branch here.
        const { hasChannel, hasHere } = extractSpecialMentions(messageContent);
        const mentionType = hasChannel ? '@channel' : hasHere ? '@here' : undefined;

        if (isGroupDm && mentionType) {
          const channel = await this.channelRepository.findById(channelId);
          await notificationService.createMentionNotifications(
            recipientIds,
            createdMessage.messageId,
            conversation.conversationId,
            channelId,
            channel?.name ?? channelId,
            senderId,
            senderInfo.name,
            cleanContent,
            workspaceId,
            mentionType,
            false, // isDMChannel
            false, // isThreadMessage
            senderInfo.picture ?? '',
            undefined, // prefetchedData
            true, // isGroupDM
          );

          // Mirror MessagesSideEffectHandler.handleSpecialMentionActivities: create
          // the activity-feed records for the @channel/@here audience so the mention
          // shows up in recipients' Activity, not just as a push notification.
          const audience =
            mentionType === '@channel'
              ? await getChannelParticipantsForMention(channelId)
              : await getOnlineChannelParticipants(channelId);
          const audienceUserIds = [
            ...new Set(audience.map(u => u.userId).filter(id => id && id !== senderId)),
          ];
          if (audienceUserIds.length > 0) {
            await activityService.createActivities(
              audienceUserIds.map(userId => ({
                id: uuidv4(),
                userId,
                actorId: senderId,
                actorAction: 'group_mention' as const,
                actionSource: 'message' as const,
                actionSourceId: createdMessage.messageId,
                messageId: createdMessage.messageId,
                channelId,
                isThreadActivity: false,
                classification: ActivityClassification.PENDING,
                classificationJobType: ActivityClassificationJobType.SPECIAL_MENTION_AUDIENCE,
              })),
            );
          }
        } else {
          await notificationService.createDirectMessageNotifications(
            recipientIds,
            createdMessage.messageId,
            conversation.conversationId,
            channelId,
            senderId,
            senderInfo.name,
            cleanContent,
            workspaceId,
            channelParticipants.length === 2 ? ChannelScopeType.DM : ChannelScopeType.GROUP_DM
          );
        }

        // Update unread counts for recipients (skip for self-DMs)
        await handleUnreadCount(
          channelId,
          true, // isDMChannel
          channelParticipants.map(p => ({ userId: p.userId })),
          senderId
        );
      }

      // Broadcast new conversation via WebSocket
      const conversationMessage = {
        conversationId: conversation.conversationId,
        channelId: channelId,
        messageId: createdMessage.messageId,
        senderId: createdMessage.senderId,
        senderName: senderInfo.name,
        senderPicture: senderInfo.picture,
        content: createdMessage.content,
        msgType: createdMessage.msgType,
        hasAttachment: createdMessage.hasAttachment,
        attachments: [],
        createdAt: createdMessage.createdAt,
      };

      await websocketService.broadcastToSession(channelId, 'new_conversation', conversationMessage);
      await redisService.broadcastMessageToSession(channelId, conversationMessage);

      return {
        conversationId: conversation.conversationId,
        initialMessage: {
          messageId: createdMessage.messageId,
          content: createdMessage.content,
          msgType: createdMessage.msgType as MessageType,
          hasAttachment: createdMessage.hasAttachment,
          attachments: [],
          createdAt: createdMessage.createdAt,
          sender: senderInfo,
        }
      };
    } catch (error) {
      logger.error('Error sending initial message:', error);
      // Don't fail the entire operation if message creation fails
      return null;
    }
  }

  // Helper method to send a forwarded message to a channel
  private async sendForwardedMessage(
    channelId: string,
    senderId: string,
    forwardedMessage: { originalMessageId: string; optionalMessage?: string }
  ): Promise<{
    conversationId: string;
    forwardedMessage: {
      messageId: string;
      content: string;
      msgType: MessageType;
      hasAttachment: boolean;
      attachments: any[];
      createdAt: Date;
      sender: any;
      metadata: any;
    };
  } | null> {
    try {
      // Get the original message
      const originalMessage = await this.messageRepository.findById(
        forwardedMessage.originalMessageId
      );
      if (!originalMessage) {
        logger.error('Original message not found:', forwardedMessage.originalMessageId);
        return null;
      }

      const originalConversation = await this.conversationRepository.findById(
        originalMessage.conversationId
      );
      if (!originalConversation) {
        logger.error('Original conversation not found');
        return null;
      }

      // Check if user has access to original channel
      const hasAccess = await this.channelParticipantRepository.isParticipant(
        originalConversation.channelId,
        senderId
      );
      if (!hasAccess) {
        logger.error("User doesn't have access to original message channel");
        return null;
      }

      // Handle re-forwarding: if the original message is already forwarded,
      // parse the XML to get the optionalText and use that as content (if exists)
      // When using optionalText, don't include attachments (it's either optionalText OR message content with attachments)
      const isReForwarding = originalMessage.msgType === MessageType.FORWARDED;
      let forwardedContent = originalMessage.content;
      let useOptionalText = false;

      if (isReForwarding) {
        const parsedForwarded = parseForwardedMessageXml(originalMessage.content);
        if (parsedForwarded?.optionalText) {
          forwardedContent = parsedForwarded.optionalText;
          useOptionalText = true;
        } else if (parsedForwarded?.content) {
          forwardedContent = parsedForwarded.content;
        }
      }

      // Get attachments from the original message (only if not using optionalText)
      const originalAttachments = useOptionalText
        ? []
        : await this.messageAttachmentRepository.findByMessageId(
            forwardedMessage.originalMessageId
          );

      // Get original sender info with fallback
      let originalSenderInfo;
      try {
        originalSenderInfo = await this.getUserInfo(originalMessage.senderId);
      } catch (error) {
        logger.warn('Original sender not found, using fallback:', originalMessage.senderId);
        originalSenderInfo = { name: 'Deleted User', picture: null };
      }

      let effectiveSenderName = originalSenderInfo.name || 'Unknown User';

      const meta = originalMessage.metadata as any;
      const contentStr = typeof originalMessage.content === 'string' ? originalMessage.content : '';
      
      const isCall = 
        (originalMessage.msgType === MessageType.SYSTEM && meta?.isCallMessage === true) ||
        meta?.callId !== undefined ||
        /started a call|Call ended|joined the call/i.test(contentStr);

      if (isCall) {
        effectiveSenderName = 'Xyne Call';
      }

      // Get sender info (read operation, can be outside transaction)
      const senderInfo = await this.getUserInfo(senderId);

      // Create XML content for the forwarded message
      const xmlContent = createForwardedMessageXml({
        originalMessageId: forwardedMessage.originalMessageId,
        originalSenderId: originalMessage.senderId,
        originalSenderName: effectiveSenderName,
        originalCreatedAt: originalMessage.createdAt.getTime(),
        originalChannelId: originalConversation?.channelId || null,
        originalConversationId: originalMessage.conversationId,
        optionalText: forwardedMessage.optionalMessage || null,
        content: forwardedContent,
      });

      // Use transaction for all write operations to maintain atomicity
      const channelWorkspaceId = await this.channelRepository.getWorkspaceId(channelId);
      const targetChannel = await this.channelRepository.findById(channelId);
      const result = await db.$transaction(async (tx) => {
        // Create conversation
      const conversation = await tx.conversation.create({
        data: {
          channelId: channelId,
          createdBy: senderId,
          initialMessageId: 'temp',
          workspaceId: channelWorkspaceId,
          lastActivityAt: new Date(),
          replyCount: 0,
          pinned: false,
        },
      });

        const forwardedMessageMetadata = {} as Record<string, unknown>;
        if (isCall) {
          forwardedMessageMetadata['isCallMessage'] = true;
          if (meta?.callId) {
            forwardedMessageMetadata['callId'] = meta.callId;
          }
        }

        // Create the forwarded message with XML content
        const createdMessage = await tx.message.create({
          data: {
            conversationId: conversation.conversationId,
            senderId: senderId,
            workspaceId: channelWorkspaceId,
            content: xmlContent,
            msgType: MessageType.FORWARDED,
            hasAttachment: originalAttachments.length > 0,
            metadata: forwardedMessageMetadata as Prisma.InputJsonValue,
          },
        });
        if (targetChannel) {
          await ensureDmConversationAuthorParticipant({
            channelId,
            conversationId: conversation.conversationId,
            senderId,
            scopeType: targetChannel.scopeType as ChannelScopeType,
            tx,
          });
        }

         // Copy attachments to the new message
         const copiedAttachments: any[] = [];
        if (originalAttachments.length > 0) {
           // Preserve the sender's display order: sort by explicit position
           // (falling back to createdAt/id for legacy rows), then stamp a fresh
           // strictly-increasing position + createdAt on each copy so the
           // forwarded message renders in the same order as the source.
           const orderedOriginalAttachments = [...originalAttachments].sort(
             (a, b) =>
               (a.position ?? Number.MAX_SAFE_INTEGER) -
                 (b.position ?? Number.MAX_SAFE_INTEGER) ||
               a.createdAt.getTime() - b.createdAt.getTime() ||
               a.id.localeCompare(b.id)
           );
           const forwardCloneBaseTs = Date.now();
           for (const [attIndex, attachment] of orderedOriginalAttachments.entries()) {
             const copiedAttachment = await tx.messageAttachment.create({
               data: {
                 entityId: createdMessage.messageId,
                 entityType: AttachmentEntityType.CHAT,
                 originalFilename: attachment.originalFilename,
                 size: attachment.size,
                 mimetype: attachment.mimetype,
                 url: attachment.url,
                 thumbnailUrl: attachment.thumbnailUrl || undefined,
                 uploadedByUserId: senderId,
                 createdBy: senderId,
                 storageProvider: attachment.storageProvider,
                 conversationId: conversation.conversationId,
                 workspaceId: channelWorkspaceId,
                metadata: (attachment.metadata as Record<string, any>) || {},
                 width: attachment.width ?? undefined,
                 height: attachment.height ?? undefined,
                 createdAt: new Date(forwardCloneBaseTs + attIndex),
                 position: attIndex,
               },
             });
             copiedAttachments.push(copiedAttachment);
           }
         }

        let totalReplyCount = 0;

        // If it is a call message, we want to clone all non-user bot messages (like transcipts/summaries)
        if (isCall) {
          // Get all bot thread messages from the original conversation
          const botMessages = await tx.message.findMany({
            where: {
              conversationId: originalMessage.conversationId,
              msgType: MessageType.BOT
            }
          });

          totalReplyCount = botMessages.length;

          // Insert the cloned bot messages into the new conversation
          for (let i = 0; i < botMessages.length; i++) {
            const botMsg = botMessages[i]!;
            const clonedMessage = await tx.message.create({
              data: {
                conversationId: conversation.conversationId,
                senderId: botMsg.senderId,
                workspaceId: channelWorkspaceId,
                content: botMsg.content,
                msgType: botMsg.msgType,
                hasAttachment: botMsg.hasAttachment,
                edited: botMsg.edited,
                isDeleted: botMsg.isDeleted,
                isSent: botMsg.isSent,
                showInChannel: botMsg.showInChannel,
                childConversationId: botMsg.childConversationId,
                metadata: (botMsg.metadata as Prisma.InputJsonValue) || {},
                visibleTo: botMsg.visibleTo,
              }
            });

            // If the bot message had attachments, clone them too
            if (botMsg.hasAttachment) {
              const botOriginalAttachments = await tx.messageAttachment.findMany({
                where: {
                  entityId: botMsg.messageId,
                  entityType: AttachmentEntityType.CHAT
                }
              });

              const botChannelWorkspaceId = await this.channelRepository.getWorkspaceId(conversation.channelId);
              const orderedBotAttachments = [...botOriginalAttachments].sort(
                (a, b) =>
                  (a.position ?? Number.MAX_SAFE_INTEGER) -
                    (b.position ?? Number.MAX_SAFE_INTEGER) ||
                  a.createdAt.getTime() - b.createdAt.getTime() ||
                  a.id.localeCompare(b.id)
              );
              const botCloneBaseTs = Date.now();
              for (const [botAttIndex, originalAtt] of orderedBotAttachments.entries()) {
                await tx.messageAttachment.create({
                  data: {
                    entityId: clonedMessage.messageId,
                    entityType: AttachmentEntityType.CHAT,
                    originalFilename: originalAtt.originalFilename,
                    size: originalAtt.size,
                    mimetype: originalAtt.mimetype,
                    url: originalAtt.url,
                    thumbnailUrl: originalAtt.thumbnailUrl || undefined,
                    uploadedByUserId: senderId,
                    createdBy: senderId,
                    storageProvider: originalAtt.storageProvider,
                    conversationId: conversation.conversationId,
                    workspaceId: botChannelWorkspaceId,
                    metadata: (originalAtt.metadata as Prisma.InputJsonValue) || {},
                    width: originalAtt.width ?? undefined,
                    height: originalAtt.height ?? undefined,
                    createdAt: new Date(botCloneBaseTs + botAttIndex),
                    position: botAttIndex,
                  }
                });
              }
            }
          }
        }

        // Update conversation with real initial message ID and replyCount
        await tx.conversation.update({
          where: { conversationId: conversation.conversationId },
          data: { 
            initialMessageId: createdMessage.messageId,
            replyCount: totalReplyCount,
          },
        });

        // Update channel last activity in channel_stats
        await tx.channelStats.upsert({
          where: { channelId },
          update: { lastActivityAt: new Date() },
          create: { channelId, lastActivityAt: new Date(), workspaceId: channelWorkspaceId },
        });

        // Reopen DM for all participants so they can see the message
        await tx.channelUserStatus.updateMany({
          where: { channelId: channelId, isClosed: true },
          data: { isClosed: false, updatedAt: new Date() },
        });

        return {
          conversation,
          createdMessage,
          copiedAttachments,
        };
      });
      await messageMetadataService.syncInitialMessageMd(result.conversation.conversationId);

      // Get channel participants for notifications and unread count
      const channelParticipants = await this.channelParticipantRepository.getChannelParticipants(channelId);

      // Extract clean content for notification - parse forwarded XML to get actual content
      const parsedContent = parseForwardedMessageXml(result.createdMessage.content);
      let cleanContent = parsedContent?.optionalText || parsedContent?.content || 'Forwarded a message';
      // Strip any remaining HTML tags
      cleanContent = cleanContent.replace(/<[^>]*>/g, '').trim();
      if (!cleanContent) {
        cleanContent = result.createdMessage.hasAttachment ? 'Forwarded an attachment' : 'Forwarded a message';
      }

      // Get recipient IDs (all participants except sender)
      const recipientIds = channelParticipants
        .map(p => p.userId)
        .filter(userId => userId !== senderId);

      // Fetch workspaceId for notification URL
      const workspaceId = await this.channelRepository.getWorkspaceId(channelId);

      // Send notifications to recipients (skip for self-DMs)
      if (recipientIds.length > 0) {
        await notificationService.createDirectMessageNotifications(
          recipientIds,
          result.createdMessage.messageId,
          result.conversation.conversationId,
          channelId,
          senderId,
          senderInfo.name,
          cleanContent,
          workspaceId,
          channelParticipants.length === 2 ? ChannelScopeType.DM : ChannelScopeType.GROUP_DM
        );

        // Update unread counts for recipients (skip for self-DMs)
        await handleUnreadCount(
          channelId,
          true, // isDMChannel
          channelParticipants.map(p => ({ userId: p.userId })),
          senderId
        );
      }

      // Broadcast new conversation via WebSocket
      const conversationMessage = {
        conversationId: result.conversation.conversationId,
        channelId: channelId,
        messageId: result.createdMessage.messageId,
        senderId: result.createdMessage.senderId,
        senderName: senderInfo.name,
        senderPicture: senderInfo.picture,
        content: result.createdMessage.content,
        msgType: result.createdMessage.msgType,
        hasAttachment: result.createdMessage.hasAttachment,
        attachments: result.copiedAttachments,
        createdAt: result.createdMessage.createdAt,
      };

      await websocketService.broadcastToSession(channelId, 'new_conversation', conversationMessage);
      await redisService.broadcastMessageToSession(channelId, conversationMessage);

      return {
        conversationId: result.conversation.conversationId,
        forwardedMessage: {
          messageId: result.createdMessage.messageId,
          content: result.createdMessage.content,
          msgType: result.createdMessage.msgType as MessageType,
          hasAttachment: result.createdMessage.hasAttachment,
          attachments: result.copiedAttachments,
          createdAt: result.createdMessage.createdAt,
          sender: senderInfo,
          metadata: {},
        },
      };
    } catch (error) {
      logger.error('Error sending forwarded message:', error);
      // Don't fail the entire operation if message creation fails
      return null;
    }
  }

  // POST /api/channels - Create new channel
  createChannel = async (req: Request, res: Response): Promise<void> => {
    try {
      const {
        scopeType,
        scopeId, // For DM channels - other user ID (not stored in DB)
        name,
        description,
        visibility,
        projectId,
        participants,
        type: channelType,
        assigneeUserGroupId,
        deskType,
        dlEmail,
        slackChannelId,
        installedAppId,
        boardId,
      }: {
        scopeType: ChannelScopeType;
        scopeId?: string;
        name?: string;
        description?: string;
        visibility?: ChannelVisibility;
        projectId: string;
        participants?: string[];
        type?: 'DEFAULT' | 'EMAIL' | 'SUPPORT' | 'SLACK' | 'APP' | 'CALL';
        assigneeUserGroupId?: string;
        deskType?: DeskType;
        dlEmail?: string;
        slackChannelId?: string;
        installedAppId?: string;
        boardId?: string;
      } = req.body;

      const userId = req.user!.id;

      // Validate required fields
      if (!scopeType || !projectId) {
        res.status(400).json({
          error: 'ScopeType and projectId are required',
          details: {
            scopeType: !scopeType ? 'ScopeType is required' : undefined,
            projectId: !projectId ? 'ProjectId is required' : undefined,
          }
        });
        return;
      }

      // For non-DM channels, name is required
      if (scopeType !== 'DM' && !name) {
        res.status(400).json({
          error: 'Name is required for non-DM channels'
        });
        return;
      }

      // Validate scopeType using Prisma enum
      const validScopeTypes = Object.values(ChannelScopeType);
      if (!validScopeTypes.includes(scopeType)) {
        res.status(400).json({
          error: 'Invalid scopeType',
          validValues: validScopeTypes
        });
        return;
      }

      // Validate visibility if provided using Prisma enum
      if (visibility) {
        const validVisibilities = Object.values(ChannelVisibility);
        if (!validVisibilities.includes(visibility)) {
          res.status(400).json({
            error: 'Invalid visibility',
            validValues: validVisibilities
          });
          return;
        }
      }

      // EMAIL channels — deskType is required, and DL desks need extra validation.
      if (channelType === 'EMAIL') {
        if (!deskType || (deskType !== DeskType.EMAIL && deskType !== DeskType.DL)) {
          res.status(400).json({ error: 'deskType (EMAIL or DL) is required for EMAIL channels' });
          return;
        }
        if (deskType === DeskType.DL) {
          if (!dlEmail) {
            res.status(400).json({ error: 'dlEmail is required when deskType is DL' });
            return;
          }
          const workspaceId = req.user!.workspaceId!;
          const sharedSource = await db.externalSource.findFirst({
            where: { workspaceId, ...WORKSPACE_LEVEL, sourceType: { in: ['google', 'microsoft'] }, isActive: true },
            select: { displayName: true, isActive: true },
          });
          if (!sharedSource) {
            res.status(409).json({ error: 'Workspace has no shared desk email configured' });
            return;
          }
          if (!sharedSource.isActive) {
            res.status(409).json({ error: 'Shared mailbox is disconnected' });
            return;
          }
          const alreadyClaimed = await db.emailChannelPreference.findUnique({
            where: { workspaceId_dlEmail: { workspaceId, dlEmail } },
            select: { channelId: true },
          });
          if (alreadyClaimed) {
            res.status(409).json({ error: 'A desk already exists for this DL' });
            return;
          }
        }
      }

      if (channelType === 'CALL') {
        if (!deskType || deskType !== DeskType.CALL) {
          res.status(400).json({ error: 'deskType CALL is required for CALL channels' });
          return;
        }
      }

      // SLACK channels — slackChannelId is required, workspace must have Slack connected.
      if (channelType === 'SLACK') {
        if (!slackChannelId) {
          res.status(400).json({ error: 'slackChannelId is required for SLACK channels' });
          return;
        }
        const slackWorkspaceSource = await db.externalSource.findFirst({
          where: { workspaceId: req.user!.workspaceId!, ...WORKSPACE_LEVEL, sourceType: 'slack', isActive: true },
        });
        if (!slackWorkspaceSource) {
          res.status(503).json({ error: 'Slack is not connected for this workspace. Please connect Slack first.' });
          return;
        }
        const sourceName = buildSlackDeskSourceName(slackChannelId);
        // Scoped to the caller's workspace: `sourceName` is derived from the
        // caller-supplied slackChannelId, so an unscoped lookup would let one
        // workspace find — and the reactivate path below repoint — another
        // workspace's desk source. A row owned elsewhere is simply not found, and
        // the create falls through to a truthful `name` unique violation.
        const existingSource = await db.externalSource.findFirst({
          where: { name: sourceName, workspaceId: req.user!.workspaceId! },
          select: { id: true, isActive: true },
        });
        if (existingSource?.isActive) {
          res.status(409).json({ error: 'A desk already exists for this Slack channel' });
          return;
        }
      }

      if (channelType === 'APP') {
        if (!installedAppId) {
          res.status(400).json({ error: 'installedAppId is required for APP channels' });
          return;
        }
        const installedApp = await db.installedApps.findUnique({
          where: { id: installedAppId },
          select: { id: true, userId: true, user: { select: { workspaceId: true } } },
        });
        if (!installedApp || installedApp.user.workspaceId !== req.user!.workspaceId!) {
          res.status(404).json({ error: 'App is not installed in this workspace' });
          return;
        }
        const hasDeskWrite = await db.installedAppPermission.findFirst({
          where: {
            installedAppId,
            status: { in: [AppPermissionStatus.APPROVED, AppPermissionStatus.PENDINGDELETE] },
            permission: { name: 'desk', type: AppPermissionType.WRITE },
          },
          select: { id: true },
        });
        if (!hasDeskWrite) {
          res.status(403).json({ error: 'App must have the desk:write permission to back a desk' });
          return;
        }
      }

      // For DM channels, ensure scopeId is provided (other user's ID)
      if (scopeType === 'DM' && !scopeId) {
        res.status(400).json({
          error: 'scopeId (other user ID) is required for DM channels'
        });
        return;
      }

      // For DM channels, validate that participants array is not provided
      // DM channels should only have 2 participants: creator and scopeId user
      if (scopeType === 'DM' && participants && participants.length > 0) {
        res.status(400).json({
          error: 'A direct message can only be created with one other member. Do not provide participants array for DM channels.'
        });
        return;
      }

      // For DM channels, check if channel already exists
      if (scopeType === 'DM' && scopeId) {
        const existingDM = await this.channelRepository.getDMChannel(userId, scopeId);
        if (existingDM) {
          res.status(200).json({
            message: 'DM channel already exists',
            id: existingDM.id,
            name: existingDM.name,
            scopeType: existingDM.scopeType,
            createdAt: existingDM.createdAt,
          });
          return;
        }
      }

      // For DM channels, auto-generate name from user IDs
      let channelName: string;
      if (scopeType === 'DM' && scopeId) {
        channelName = [userId, scopeId].sort().join(",");
      } else {
        channelName = name!; // Already validated above
      }

      // Create channel
      const channelData: CreateChannelInput = {
        scopeType,
        name: channelName,
        description,
        visibility: (visibility || 'PUBLIC') as ChannelVisibility,
        createdBy: userId,
        projectId,
        workspaceId: req.user!.workspaceId!,
        type: (channelType || 'DEFAULT') as ChannelType,
      };

      const channel = await this.channelRepository.create(channelData);

      // Add creator as channel participant with admin role
      await this.channelParticipantRepository.addParticipant(
        channel.id,
        userId,
        ChannelRole.ADMIN
      );

      // For DM channels, add the other user as participant
      if (scopeType === 'DM' && scopeId) {
        await this.channelParticipantRepository.addParticipant(
          channel.id,
          scopeId,
          ChannelRole.MEMBER
        );
      }

      // Add additional participants if provided
      const participantAddResults: Array<{ userId: string; success: boolean; error?: string }> = [];

      if (participants && participants.length > 0) {
        // Validate participants are valid user IDs
        const validParticipants = participants.filter(p =>
          typeof p === 'string' && p.trim().length > 0 && p !== userId
        );

        for (const participantId of validParticipants) {
          try {
            // Check if user exists before adding
            const user = await this.userRepository.findById(participantId);
            if (user && user.status === 'ACTIVE') {
              await this.channelParticipantRepository.addParticipant(
                channel.id,
                participantId,
                ChannelRole.MEMBER
              );
              participantAddResults.push({ userId: participantId, success: true });
            } else {
              participantAddResults.push({
                userId: participantId,
                success: false,
                error: 'User not found or inactive'
              });
            }
          } catch (error) {
            logger.warn(`Failed to add participant ${participantId}:`, error);
            participantAddResults.push({
              userId: participantId,
              success: false,
              error: 'Failed to add participant'
            });
          }
        }
      }

      // Save EmailChannelPreference for EMAIL desks
      if (channelType === 'EMAIL') {
        const isDl = deskType === DeskType.DL;
        let resolvedBoardId: string | undefined = boardId;
        if (isDl && !resolvedBoardId) {
          const firstBoard = await db.board.findFirst({
            where: { projectId: channel.projectId },
            orderBy: { createdAt: 'asc' },
            select: { id: true },
          });
          resolvedBoardId = firstBoard?.id;
          if (!resolvedBoardId) {
            logger.error('Cannot create DL desk: project has no boards', { projectId: channel.projectId });
            await db.channel.delete({ where: { id: channel.id } }).catch(() => {});
            res.status(409).json({ error: 'Project has no boards configured — cannot create DL desk' });
            return;
          }
        }
        try {
          await this.emailChannelPreferenceRepository.create({
            channelId: channel.id,
            ownerUserId: userId,
            ...(assigneeUserGroupId && { assigneeUserGroupId }),
            deskType: deskType!,
            ...(resolvedBoardId && { boardId: resolvedBoardId }),
            ...(isDl && {
              dlEmail: dlEmail!,
              workspaceId: req.user!.workspaceId!,
              sendAsEmail: dlEmail!,
            }),
          });
        } catch (error) {
          if (isDl) {
            logger.error('Failed to create DL EmailChannelPreference, rolling back channel', error);
            await db.channel.delete({ where: { id: channel.id } }).catch(err => {
              logger.error(`Channel rollback failed for ${channel.id}`, err);
            });
            const code = (error as { code?: string })?.code;
            if (code === 'P2002') {
              res.status(409).json({ error: 'A desk already exists for this DL' });
            } else {
              res.status(500).json({ error: 'Failed to create DL desk' });
            }
            return;
          }
          logger.error('Failed to create EmailChannelPreference:', error);
          // Don't fail the entire channel creation if preference fails
        }
      }

      if (channelType === 'CALL') {
        try {
          let callBoardId = boardId;
          if (!callBoardId) {
            const firstBoard = await db.board.findFirst({
              where: { projectId: channel.projectId },
              orderBy: { createdAt: 'asc' },
              select: { id: true },
            });
            if (!firstBoard) {
              await db.channel.delete({ where: { id: channel.id } }).catch(() => {});
              res.status(409).json({ error: 'Project has no boards configured — cannot create call desk' });
              return;
            }
            callBoardId = firstBoard.id;
          }

          await this.emailChannelPreferenceRepository.create({
            channelId: channel.id,
            ownerUserId: userId,
            deskType: DeskType.CALL,
            boardId: callBoardId,
            emailMergeMode: EmailMergeMode.DISABLED,
            ...(assigneeUserGroupId && { assigneeUserGroupId }),
          });
        } catch (error) {
          logger.error('Failed to create call desk resources, rolling back channel', error);
          await db.channel.delete({ where: { id: channel.id } }).catch(err => {
            logger.error(`Channel rollback failed for ${channel.id}`, err);
          });
          res.status(500).json({ error: 'Failed to create call desk' });
          return;
        }
      }

      // Save EmailChannelPreference + ExternalSource for SLACK channels
      if (channelType === 'SLACK' && slackChannelId) {
        try {
          let slackBoardId = boardId;
          if (!slackBoardId) {
            const firstBoard = await db.board.findFirst({
              where: { projectId: channel.projectId },
              orderBy: { createdAt: 'asc' },
              select: { id: true },
            });
            if (!firstBoard) {
              await db.channel.delete({ where: { id: channel.id } }).catch(() => {});
              res.status(409).json({ error: 'Project has no boards configured — cannot create Slack desk' });
              return;
            }
            slackBoardId = firstBoard.id;
          }

          await this.emailChannelPreferenceRepository.create({
            channelId: channel.id,
            ownerUserId: userId,
            deskType: DeskType.SLACK,
            boardId: slackBoardId,
            emailMergeMode: EmailMergeMode.DISABLED,
            ...(assigneeUserGroupId && { assigneeUserGroupId }),
          });

          const sourceName = buildSlackDeskSourceName(slackChannelId);
          // Read bot token from workspace-level Slack source
          const slackWorkspaceSource = await db.externalSource.findFirst({
            where: { workspaceId: req.user!.workspaceId!, ...WORKSPACE_LEVEL, sourceType: 'slack', isActive: true },
          });
          if (!slackWorkspaceSource) {
            await db.channel.delete({ where: { id: channel.id } }).catch(() => {});
            res.status(503).json({ error: 'Slack is not connected for this workspace' });
            return;
          }
          const slackCreds = JSON.parse(decrypt(slackWorkspaceSource.credentials));
          const credentials = encrypt(JSON.stringify({
            signingSecret: slackCreds.signingSecret,
            botOauthToken: slackCreds.botOauthToken,
          }));

          // Reactivate existing or create new ExternalSource. Workspace-scoped for
          // the same reason as the pre-check above.
          const existingSource = await db.externalSource.findFirst({
            where: { name: sourceName, workspaceId: req.user!.workspaceId! },
            select: { id: true },
          });

          if (existingSource) {
            await db.externalSource.update({
              where: { id: existingSource.id },
              data: { isActive: true, credentials, channelId: channel.id, displayName: name! },
            });
          } else {
            await db.externalSource.create({
              data: {
                name: sourceName,
                sourceType: 'slack-desk',
                displayName: name!,
                channelId: channel.id,
                credentials,
                isActive: true,
                workspaceId: req.user!.workspaceId!,
              },
            });
          }
        } catch (error) {
          logger.error('Failed to create Slack desk resources, rolling back channel', error);
          await db.channel.delete({ where: { id: channel.id } }).catch(err => {
            logger.error(`Channel rollback failed for ${channel.id}`, err);
          });
          const code = (error as { code?: string })?.code;
          if (code === 'P2002') {
            res.status(409).json({ error: 'A desk with this Slack channel already exists' });
          } else {
            res.status(500).json({ error: 'Failed to create Slack desk' });
          }
          return;
        }
      }

      if (channelType === 'APP' && installedAppId) {
        try {
          let appBoardId = boardId;
          if (!appBoardId) {
            const firstBoard = await db.board.findFirst({
              where: { projectId: channel.projectId },
              orderBy: { createdAt: 'asc' },
              select: { id: true },
            });
            if (!firstBoard) {
              await db.channel.delete({ where: { id: channel.id } }).catch(() => {});
              res.status(409).json({ error: 'Project has no boards configured — cannot create app desk' });
              return;
            }
            appBoardId = firstBoard.id;
          }

          const installedApp = await db.installedApps.findUnique({
            where: { id: installedAppId },
            select: { id: true, userId: true, user: { select: { workspaceId: true } } },
          });
          if (!installedApp || installedApp.user.workspaceId !== req.user!.workspaceId!) {
            await db.channel.delete({ where: { id: channel.id } }).catch(() => {});
            res.status(404).json({ error: 'App is not installed in this workspace' });
            return;
          }

          await this.emailChannelPreferenceRepository.create({
            channelId: channel.id,
            ownerUserId: userId,
            deskType: DeskType.APP,
            boardId: appBoardId,
            emailMergeMode: EmailMergeMode.DISABLED,
            ...(assigneeUserGroupId && { assigneeUserGroupId }),
          });

          await db.externalSource.create({
            data: {
              name: buildAppDeskSourceName(channel.id),
              sourceType: 'app-desk',
              displayName: name!,
              channelId: channel.id,
              externalIdentifier: installedAppId,
              credentials: encrypt(JSON.stringify({ installedAppId })),
              isActive: true,
              workspaceId: req.user!.workspaceId!,
            },
          });

          await this.channelParticipantRepository.addParticipant(
            channel.id,
            installedApp.userId,
            ChannelRole.MEMBER
          );
        } catch (error) {
          logger.error('Failed to create app desk resources, rolling back channel', error);
          await db.channel.delete({ where: { id: channel.id } }).catch(err => {
            logger.error(`Channel rollback failed for ${channel.id}`, err);
          });
          const code = (error as { code?: string })?.code;
          if (code === 'P2002') {
            res.status(409).json({ error: 'A desk already exists for this channel' });
          } else {
            res.status(500).json({ error: 'Failed to create app desk' });
          }
          return;
        }
      }

      // ChannelBoardMapping is now populated by ChannelRepository.create itself
      // (dual-write for any channel creation path), so no manual createMany here.

      // Create activities for all channel members (excluding creator)
      await createChannelCreatedActivity(channel.id, userId);

      // Track channel creation activity
      void userActivityTrackingService.trackChannelCreated(userId, {
        channelId: channel.id,
        name: channel.name,
        scopeType: channel.scopeType,
      });

      // Queue channel for Vespa ingestion AFTER participants are added
      //await this.channelRepository.queueChannelForVespa(channel.id, 'feed');

      // Response includes participant addition results
      const response: CreateChannelResponse = {
        channelId: channel.id,
        id: channel.id,
        name: channel.name,
        scopeType: channel.scopeType as ChannelScopeType,
        description: channel.description,
        visibility: channel.visibility as ChannelVisibility,
        projectId: channel.projectId,
        createdAt: channel.createdAt,
      };

      // Include participant results if any were processed
      if (participantAddResults.length > 0) {
        response.participantResults = {
          total: participantAddResults.length,
          successful: participantAddResults.filter(r => r.success).length,
          failed: participantAddResults.filter(r => !r.success).length,
          details: participantAddResults
        };
      }

      res.status(201).json(response);

      // Queue Vespa job in background
      const allParticipantIds = [userId]; // Creator
      if (scopeType === 'DM' && scopeId) {
        allParticipantIds.push(scopeId); // DM partner
      }
      participantAddResults.forEach(p => {
        if (p.success) {
          allParticipantIds.push(p.userId); // Additional participants
        }
      });

      // Queue Vespa job in background - worker will handle all processing
      vespaQueue.addJob({
        schema: channelSchema,
        jobType: "feed",
        docId: channel.id,
        userId: userId,
        workspaceId: req.user!.workspaceId!,
      }).catch(async (error) => {
        logger.error('Error queuing Vespa job for channel:', error);
        // Log failed insertion to Postgres for later retry
        try {
          const vespaLogs = db.vespaInsertionLogs;
          if (vespaLogs) {
            await vespaLogs.create({
              data: {
                status: "FAILED",
                type: "INSERT",
                entityId: channel.id,
                entityType: channelSchema,
                namespace: NAMESPACE,
                errorMessage: `Failed to enqueue Vespa job: ${error instanceof Error ? error.message : String(error)}`,
                errorDetails: JSON.stringify(error),
                userId: userId,
                createdAt: new Date(),
                workspaceId: req.user!.workspaceId!,
              },
            });
          }
        } catch (dbError) {
          logger.error('Failed to log Vespa insertion error to database:', dbError);
        }
      });
    } catch (error) {
      logger.error('Error creating channel:', error);

      // Handle specific duplicate channel error
      if (error instanceof Error && error.message.includes('already exists in organization')) {
        res.status(409).json({
          error: 'DUPLICATE_CHANNEL_NAME',
          message: error.message
        });
        return;
      }

      // Handle database unique constraint violation (if migration is applied)
      if (error instanceof Error && error.message.includes('unique_channel_per_org_scope')) {
        res.status(409).json({
          error: 'DUPLICATE_CHANNEL_NAME',
          message: 'A channel with this name already exists in this organization'
        });
        return;
      }

      res.status(500).json({ error: 'Internal server error' });
    }
  };

  // POST /api/channels/check-duplicate - Check if channel name is duplicate
  checkDuplicate = async (req: Request, res: Response): Promise<void> => {
    try {
      // projectId is accepted for backwards compatibility with older clients but
      // is no longer required or used: duplicate-channel checks are workspace-scoped.
      const { name, projectId }: { name: string; projectId?: string } = req.body;

      // Validate required fields
      if (!name) {
        res.status(400).json({
          error: 'Name is required',
          details: {
            name: 'Name is required',
          }
        });
        return;
      }

      // Check if channel name exists within the workspace
      const workspaceId = req.user?.workspaceId;
      if (!workspaceId) {
        res.status(400).json({ error: 'Missing workspaceId' });
        return;
      }
      const isDuplicate = await this.channelRepository.checkDuplicateName(name.trim(), workspaceId);

      const response: CheckDuplicateChannelResponse = {
        isDuplicate,
        name: name.trim(),
        ...(projectId ? { projectId } : {}),
      };

      res.status(200).json(response);
    } catch (error) {
      logger.error('Error checking channel duplicate:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  getConnectedEmail = async (req: Request, res: Response): Promise<void> => {
    try {
      const { channelId } = req.params;
      if (!channelId) {
        res.status(400).json({ error: 'channelId is required' });
        return;
      }

      // This endpoint returns the channel's connected desk mailbox / owner account
      // email. Gate it with the same rule the socket layer uses (canAccessChannel):
      // workspace boundary + participant-only for PRIVATE channels.
      const userId = req.user?.id;
      const workspaceId = req.user?.workspaceId;
      if (!userId || !workspaceId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const channel = await this.channelRepository.findById(channelId);
      if (!channel || channel.workspaceId !== workspaceId) {
        res.status(404).json({ error: 'Channel not found' });
        return;
      }
      if (channel.visibility === 'PRIVATE') {
        const isParticipant = await this.channelParticipantRepository.isParticipant(channelId, userId);
        if (!isParticipant) {
          res.status(403).json({ error: 'Forbidden' });
          return;
        }
      }

      res.setHeader('Cache-Control', 'private, no-cache');

      const source = await db.externalSource.findFirst({
        where: { channelId, workspaceId },
        select: { name: true, displayName: true, sourceType: true, isActive: true, externalIdentifier: true },
        orderBy: { createdAt: 'desc' },
      });
      const hasSource = !!source;
      let isConnected = source?.isActive === true;
      const sourceType = source?.sourceType ?? null;

      let connectedLabel: string | null = null;
      let outboundConfigured = true;
      let googlePlayApps: Array<{
        id: string;
        displayName: string;
        packageName: string | null;
        isActive: boolean;
      }> = [];
      if (source?.sourceType === ExternalSourcePlatform.APP_DESK) {
        const installedAppId = resolveAppDeskInstalledAppId(source) ?? '';
        const installedApp = await db.installedApps.findUnique({
          where: { id: installedAppId },
          select: { webhookUrl: true, app: { select: { name: true, signingSecret: true } } },
        });
        connectedLabel = installedApp?.app?.name ?? null;
        outboundConfigured = Boolean(
          installedApp?.webhookUrl?.trim() && installedApp.app?.signingSecret,
        );
      } else if (source?.sourceType === ExternalSourcePlatform.SLACK_DESK) {
        connectedLabel = extractSlackChannelId(source.name);
      } else if (source?.sourceType === ExternalSourcePlatform.GOOGLE_PLAY) {
        const reviewSources = await db.externalSource.findMany({
          where: { channelId, workspaceId, sourceType: ExternalSourcePlatform.GOOGLE_PLAY },
          select: {
            id: true,
            displayName: true,
            externalIdentifier: true,
            isActive: true,
          },
          orderBy: { createdAt: 'asc' },
        });
        const activeReviewSources = reviewSources.filter(reviewSource => reviewSource.isActive);
        isConnected = activeReviewSources.length > 0;
        googlePlayApps = reviewSources.map(reviewSource => ({
          id: reviewSource.id,
          displayName: reviewSource.displayName,
          packageName: reviewSource.externalIdentifier,
          isActive: reviewSource.isActive,
        }));
        connectedLabel = activeReviewSources
          .map(reviewSource => reviewSource.displayName)
          .join(', ') || 'No active Google Play apps';
      }

      const fromDisplay = (source?.displayName ?? '').match(/[\w.+-]+@[\w.-]+\.[\w.-]+/)?.[0];
      if (fromDisplay) {
        const email = fromDisplay.toLowerCase();
        res
          .status(200)
          .json({ email, isConnected, hasSource, sourceType, connectedLabel: connectedLabel ?? email, outboundConfigured, googlePlayApps });
        return;
      }

      const preference = await db.emailChannelPreference.findUnique({
        where: { channelId },
        select: { ownerUserId: true },
      });
      if (preference?.ownerUserId) {
        const owner = await db.user.findUnique({
          where: { id: preference.ownerUserId },
          select: { email: true },
        });
        if (owner?.email) {
          const email = owner.email.toLowerCase();
          res
            .status(200)
            .json({ email, isConnected, hasSource, sourceType, connectedLabel: connectedLabel ?? email, outboundConfigured, googlePlayApps });
          return;
        }
      }

      res.status(200).json({ email: null, isConnected, hasSource, sourceType, connectedLabel, outboundConfigured, googlePlayApps });
    } catch (error) {
      logger.error('Error in getConnectedEmail:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  getEmailAlias = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      const { channelId } = req.params;

      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      if (!channelId) {
        res.status(400).json({ error: 'channelId is required' });
        return;
      }

      const isParticipant = await this.channelParticipantRepository.isParticipant(channelId, userId);
      if (!isParticipant) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }

      const channel = await this.channelRepository.findById(channelId);
      if (!channel) {
        res.status(404).json({ error: 'Channel not found' });
        return;
      }

      const info = await this.channelEmailAliasService.getChannelEmailInfo(
        channel.workspaceId,
        channelId,
      );
      res.status(200).json(info);
    } catch (error) {
      logger.error('Error in getEmailAlias:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  // POST /api/channels/member-counts - Participant counts for a set of channels
  getChannelMemberCounts = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const { channelIds } = req.body as { channelIds?: unknown };
      if (!Array.isArray(channelIds) || channelIds.some(id => typeof id !== 'string')) {
        res.status(400).json({ success: false, error: 'channelIds must be an array of strings' });
        return;
      }

      // Bound the input so a single request can't issue an unbounded IN query.
      const MAX_CHANNEL_IDS = 10000;
      if (channelIds.length > MAX_CHANNEL_IDS) {
        res.status(400).json({
          success: false,
          error: `channelIds exceeds the maximum of ${MAX_CHANNEL_IDS}`,
        });
        return;
      }

      const counts: Record<string, number> = {};
      if (channelIds.length === 0) {
        res.status(200).json({ success: true, data: { counts } });
        return;
      }

      const stats = await db.channelStats.findMany({
        where: { channelId: { in: channelIds as string[] } },
        select: { channelId: true, participantCount: true },
      });

      for (const stat of stats) counts[stat.channelId] = stat.participantCount;

      res.status(200).json({ success: true, data: { counts } });
    } catch (error) {
      logger.error('Error in getChannelMemberCounts:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };

  // GET /api/channels/:channelId/vespa-participants - Channel participants (user IDs) from Vespa chat_container.permissions
  getVespaParticipants = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user!.id;
      const { channelId } = req.params;
      if (!channelId) {
        res.status(400).json({ success: false, error: 'channelId is required' });
        return;
      }
      const userIds = await vespaService.channelService.getChannelParticipants(channelId, userId);
      res.status(200).json({ success: true, data: { userIds } });
    } catch (error) {
      logger.error('Error in getVespaParticipants:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };

  // GET /api/channels/:channelId/members - channel members as { id, name }
  getChannelMembers = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user!.id;
      const { channelId } = req.params;
      if (!channelId) {
        res.status(400).json({ success: false, error: 'channelId is required' });
        return;
      }
      // Only members of the channel may view its roster.
      const isMember = await this.channelParticipantRepository.isParticipant(channelId, userId);
      if (!isMember) {
        res.status(403).json({ success: false, error: 'Forbidden' });
        return;
      }
      const members = await this.channelParticipantRepository.getActiveChannelMembers(channelId);
      res.status(200).json({ success: true, data: { members } });
    } catch (error) {
      logger.error('Error in getChannelMembers:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };

  // GET /api/channels/search - Unified search for users and groups
  searchForMentions = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user!.id;
      const { q, limit = '10', types = 'users,groups' } = req.query;

      // Validate query parameter - allow 1+ characters for mentions
      if (!q || typeof q !== 'string' || q.trim().length < 1) {
        res.status(400).json({
          error: 'Search query (q) is required and must be at least 1 character',
          details: 'Provide a search term of minimum 1 character'
        });
        return;
      }

      // Parse and validate limit
      const searchLimit = Math.min(parseInt(limit as string) || 10, 15); // Max 15 results

      // Parse types parameter
      const searchTypes = (types as string).split(',').map(type => type.trim());
      const includeUsers = searchTypes.includes('users');
      const includeGroups = searchTypes.includes('groups');

      const results: any[] = [];

      try {
        // Parallel search promises
        const searchPromises: Promise<any>[] = [];

        // User search
        if (includeUsers) {
          const userSearchPromise = this.userRepository.findBySearch(q.trim(), {
            page: 1,
            pageSize: searchLimit
          }).then(searchResults => {
            const users = Array.isArray(searchResults) ? searchResults : searchResults.data;
            return users
              .filter(user => user.status === 'ACTIVE' && user.id !== userId)
              .slice(0, searchLimit)
              .map(user => ({
                id: user.id,
                name: user.displayName || user.name,
                email: user.email,
                picture: user.picture,
                type: 'user'
              }));
          });
          searchPromises.push(userSearchPromise);
        }

        // Group search
        if (includeGroups) {
          const groupSearchPromise = this.userGroupRepository.findBySearch(q.trim(), {
            page: 1,
            pageSize: searchLimit
          }).then(async searchResults => {
            const groups = Array.isArray(searchResults) ? searchResults : searchResults.data;
            return await Promise.all(
              groups.slice(0, searchLimit).map(async group => {
                try {
                  const memberCount = await this.userGroupRepository.getUserCount(group.id);
                  return {
                    id: group.id,
                    name: group.name,
                    alias: group.alias,
                    description: group.description,
                    memberCount,
                    type: 'group'
                  };
                } catch (error) {
                  logger.warn(`Failed to get member count for group ${group.id}:`, error);
                  return {
                    id: group.id,
                    name: group.name,
                    alias: group.alias,
                    description: group.description,
                    memberCount: 0,
                    type: 'group'
                  };
                }
              })
            );
          });
          searchPromises.push(groupSearchPromise);
        }

        // Execute searches in parallel and combine results
        const searchResults = await Promise.all(searchPromises);
        searchResults.forEach(searchResult => {
          results.push(...searchResult);
        });

        // Limit total results
        const limitedResults = results.slice(0, searchLimit);

        res.status(200).json({
          results: limitedResults,
          total: limitedResults.length,
          query: q,
          limit: searchLimit,
          types: searchTypes
        });
      } catch (searchError) {
        logger.error('Error during unified search:', searchError);
        res.status(500).json({ error: 'Search failed' });
      }
    } catch (error) {
      logger.error('Error in unified search for mentions:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  // GET /api/channels/publish-targets - Get channels where user can publish docs
  // Returns DEFAULT scope channels (not DMs or GROUP_DMs)
  getChannelsForDocs = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;

      if (!userId) {
        res.status(403).json({ error: 'Unauthorized - user not authenticated' });
        return;
      }

      const userParticipations = await this.channelParticipantRepository.getUserChannels(userId);
      const channelIds = userParticipations.map(p => p.channelId);

      if (channelIds.length === 0) {
        res.status(200).json({ channels: [] });
        return;
      }

      const allChannels = await this.channelRepository.getChannelsByIds(channelIds);

      const docsChannels = allChannels.filter(channel =>
        channel.scopeType === ChannelScopeType.DEFAULT || channel.scopeType === ChannelScopeType.DOCUMENT
      );

      res.status(200).json({
        channels: docsChannels.map(c => ({
          id: c.id,
          name: c.name,
          projectId: c.projectId,
          scopeType: c.scopeType,
        })),
      });
    } catch (error) {
      logger.error('Error getting channels for docs:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  // GET /api/users/me/dms - Get all user's DM channels
  getUserDMs = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user!.id;

      // Get user's channel participations for DM channels only
      const userParticipations = await this.channelParticipantRepository.getUserChannels(userId);

      // Get all DM channels where user is a participant
      const dmChannelIds = userParticipations
        .map(p => p.id);

      if (dmChannelIds.length === 0) {
        res.status(200).json({
          channels: [],
          total: 0,
        });
        return;
      }

      const allDMChannels = await this.channelRepository.getChannelsByIds(dmChannelIds);

      // Filter to only include USER (1-on-1 DMs) and GROUP_DM scope types
      const dmChannels = allDMChannels.filter(channel =>
        channel.scopeType === ChannelScopeType.DM || channel.scopeType === ChannelScopeType.GROUP_DM
      );

      if (dmChannels.length === 0) {
        res.status(200).json({
          channels: [],
          total: 0,
        });
        return;
      }

      const channelIds = dmChannels.map(c => c.id);

      // Batch fetch all related data to avoid N+1 queries
      const [allConversations, allParticipants, allUnreadCounts, allChannelStats] = await Promise.all([
        // Fetch all conversations for all channels in one query
        this.conversationRepository.findMany({
          where: { channelId: { in: channelIds } }
        }),
        // Fetch all participants for all channels in one query
        this.channelParticipantRepository.findMany({
          where: { channelId: { in: channelIds } }
        }),
        // Fetch all unread counts for all channels
        Promise.all(channelIds.map(channelId =>
          unreadService.getUnreadCountForChannel(channelId, userId)
        )),
        // Fetch all channel stats for lastActivityAt
        db.channelStats.findMany({
          where: { channelId: { in: channelIds } }
        }),
      ]);

      // Create maps for efficient lookup
      const conversationsByChannel = new Map<string, any[]>();
      allConversations.forEach(conv => {
        if (!conversationsByChannel.has(conv.channelId)) {
          conversationsByChannel.set(conv.channelId, []);
        }
        conversationsByChannel.get(conv.channelId)!.push(conv);
      });

      const participantsByChannel = new Map<string, any[]>();
      allParticipants.forEach(participant => {
        if (!participantsByChannel.has(participant.channelId)) {
          participantsByChannel.set(participant.channelId, []);
        }
        participantsByChannel.get(participant.channelId)!.push(participant);
      });

      const unreadCountMap = new Map(channelIds.map((id, index) => [id, allUnreadCounts[index]]));
      const channelStatsMap = new Map(allChannelStats.map(s => [s.channelId, s]));

      // Collect all unique user IDs for batch user fetch
      const userIds = new Set<string>();
      allParticipants.forEach(p => {
        if (p.userId && p.userId !== userId) {
          userIds.add(p.userId);
        }
      });

      // Batch fetch all user info
      const users = await this.userRepository.findMany({
        where: { id: { in: Array.from(userIds) } }
      });
      const userMap = new Map(users.map(u => ({ id: u.id, name: u.displayName || u.name, email: u.email, picture: u.picture })).map(u => [u.id, u]));

      // Assemble the response data
      const dmChannelsWithCounts = dmChannels.map(channel => {
        const conversations = conversationsByChannel.get(channel.id) || [];
        const participants = participantsByChannel.get(channel.id) || [];
        const participation = userParticipations.find(p => p.id === channel.id);
        const unreadCount = unreadCountMap.get(channel.id) || 0;

        // Get DM partner info - determine who the partner is relative to current user
        let partnerInfo = null;
        if (channel.scopeType === ChannelScopeType.DM) {
          const otherParticipant = participants.find(p => p.userId !== userId);
          // If no other participant, this is a self-DM - use current user info
          if (otherParticipant?.userId) {
            partnerInfo = userMap.get(otherParticipant.userId) || null;
          } else if (participants.some(p => p.userId === userId)) {
            // Self-DM case - return current user info
            partnerInfo = userMap.get(userId) || null;
          }
        }

        let participantsName = null;
        if (channel.scopeType === ChannelScopeType.GROUP_DM) {
          const otherParticipants = participants.filter(p => p.userId !== userId);
          participantsName = otherParticipants
            .map(p => userMap.get(p.userId)?.name)
            .filter(Boolean);
        }

        return {
          id: channel.id,
          name: channel.name,
          scopeType: channel.scopeType,
          description: channel.description,
          visibility: channel.visibility,
          createdBy: channel.createdBy,
          conversationCount: conversations.length,
          participantCount: participants.length,
          unreadCount,
          lastActivityAt: channelStatsMap.get(channel.id)?.lastActivityAt ?? channel.createdAt,
          createdAt: channel.createdAt,
          userRole: participation?.role,
          isMember: true, // Always true for DMs
          partner: partnerInfo, // Partner user info for frontend
          participantsName: participantsName
        };
      });

      // Sort DMs by last activity
      dmChannelsWithCounts.sort((a, b) =>
        new Date(b.lastActivityAt || b.createdAt).getTime() -
        new Date(a.lastActivityAt || a.createdAt).getTime()
      );

      res.status(200).json({
        channels: dmChannelsWithCounts,
        total: dmChannelsWithCounts.length,
      });
    } catch (error) {
      logger.error('Error getting user DMs:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  // POST /api/users/me/dms - Create a new DM (1-on-1 or group)
  createNewDM = async (req: Request, res: Response): Promise<void> => {
    try {
      const currentUserId = req.user!.id;
      const workspaceId = req.user!.workspaceId!;
      const { participantIds, message, forwardedMessage, silent }: {
        participantIds: string[],
        message?: string,
        forwardedMessage?: { originalMessageId: string; optionalMessage?: string }
        silent?: boolean,
      } = req.body;

      // When a DM is auto-created without an initial message, keep it hidden from
      // the creator's list until the first message is actually sent.
      const shouldHideCreator = Boolean(silent) && !message && !forwardedMessage;

      // Validate participantIds
      if (!participantIds || !Array.isArray(participantIds) || participantIds.length === 0) {
        res.status(400).json({
          error: 'participantIds array is required and cannot be empty',
          details: 'Provide at least one participant ID'
        });
        return;
      }

      // Get DM project ID for this workspace
      const dmProjectId = await this.projectRepository.getDMProjectId(workspaceId);
      if (!dmProjectId) {
        res.status(500).json({ error: 'DM project not found for workspace' });
        return;
      }

      // Remove duplicates
      const uniqueParticipantIds = [...new Set(participantIds)];

      // Check if this is a self-DM (only current user in participantIds)
      const isSelfDm = uniqueParticipantIds.length === 1 && uniqueParticipantIds[0] === currentUserId;

      if (uniqueParticipantIds.length === 0) {
        res.status(400).json({
          error: 'No valid participants provided',
          details: 'Cannot create DM with empty participant list'
        });
        return;
      }

      // For non-self-DMs, filter out current user from other participants
      const otherParticipantIds = isSelfDm ? [] : uniqueParticipantIds.filter(id => id !== currentUserId);

      // Validate that we have valid participants (either self-DM or at least one other user)
      if (!isSelfDm && otherParticipantIds.length === 0) {
        res.status(400).json({
          error: 'No valid participants provided',
          details: 'Cannot create DM with empty participant list'
        });
        return;
      }

      // Check participant limit (9 others + 1 creator = 10 max)
      if (!isSelfDm && otherParticipantIds.length > 9) {
        res.status(400).json({
          error: 'Too many participants',
          details: 'Maximum 9 participants allowed (10 total including creator)',
          maxParticipants: 9
        });
        return;
      }

      // Validate all participants exist and are active (skip for self-DM)
      let participantUsers: User[] = [];
      if (!isSelfDm) {
        const { users, missingUserId } =
          await this.userRepository.findActiveByIds(otherParticipantIds);
        if (missingUserId) {
          res.status(404).json({
            error: 'Participant not found or inactive',
            userId: missingUserId
          });
          return;
        }
        participantUsers = users;
      }

      // Handle self-DM case
      if (isSelfDm) {
        // Check if self-DM already exists
        const existingSelfDm = await this.channelRepository.getDMChannel(currentUserId, currentUserId);
        if (existingSelfDm) {
          const conversations = await this.conversationRepository.getChannelConversations(existingSelfDm.id);
          const participants = await this.channelParticipantRepository.getChannelParticipants(existingSelfDm.id);
          const unreadCount = await unreadService.getUnreadCountForChannel(existingSelfDm.id, currentUserId);

          // Send message or forwarded message if provided, even for existing self-DM
          let initialConversation = null;
          if (forwardedMessage) {
            initialConversation = await this.sendForwardedMessage(existingSelfDm.id, currentUserId, forwardedMessage);
          } else if (message && message.trim()) {
            initialConversation = await this.sendInitialMessage(existingSelfDm.id, currentUserId, message);
          }

          const currentUserInfo = await this.getUserInfo(currentUserId);
          const selfDmStats = await db.channelStats.findUnique({ where: { channelId: existingSelfDm.id } });

          res.status(200).json({
            message: 'Self-DM channel already exists',
            id: existingSelfDm.id,
            name: existingSelfDm.name,
            scopeType: existingSelfDm.scopeType,
            description: existingSelfDm.description,
            visibility: existingSelfDm.visibility,
            conversationCount: initialConversation ? conversations.length + 1 : conversations.length,
            participantCount: participants.length,
            unreadCount,
            lastActivityAt: selfDmStats?.lastActivityAt ?? existingSelfDm.createdAt,
            createdAt: existingSelfDm.createdAt,
            isExisting: true,
            isSelfDm: true,
            targetUser: {
              id: currentUserInfo.id,
              name: currentUserInfo.name,
              email: currentUserInfo.email,
              picture: currentUserInfo.picture
            },
            initialConversation
          });
          return;
        }

        // Create new self-DM
        const channelData: CreateChannelInput = {
          scopeType: ChannelScopeType.DM,
          name: currentUserId,
          description: 'Saved messages',
          visibility: ChannelVisibility.PRIVATE,
          createdBy: currentUserId,
          projectId: dmProjectId,
          workspaceId,
        };

        const channel = await this.channelRepository.create(channelData);

        // Add current user as the only participant
        await this.channelParticipantRepository.addParticipant(channel.id, currentUserId, ChannelRole.ADMIN);

        // If message or forwarded message is provided, create initial conversation and message
        let initialConversation = null;
        if (forwardedMessage) {
          initialConversation = await this.sendForwardedMessage(channel.id, currentUserId, forwardedMessage);
        } else if (message && message.trim()) {
          initialConversation = await this.sendInitialMessage(channel.id, currentUserId, message);
        }

        const currentUserInfo = await this.getUserInfo(currentUserId);

        const response = {
          message: 'Self-DM channel created successfully',
          id: channel.id,
          name: channel.name,
          scopeType: channel.scopeType,
          description: channel.description,
          visibility: channel.visibility,
          conversationCount: initialConversation ? 1 : 0,
          participantCount: 1,
          unreadCount: 0,
          lastActivityAt: channel.createdAt,
          createdAt: channel.createdAt,
          isSelfDm: true,
          targetUser: {
            id: currentUserInfo.id,
            name: currentUserInfo.displayName || currentUserInfo.name,
            email: currentUserInfo.email,
            picture: currentUserInfo.picture
          },
          isExisting: false,
          initialConversation
        };

        res.status(201).json(response);

        // Queue Vespa job in background for self-DM
        vespaQueue.addJob({
          schema: channelSchema,
          jobType: "feed",
          docId: channel.id,
          userId: currentUserId,
          workspaceId: workspaceId,
        }).catch(error => {
          logger.error('Error queuing Vespa job for self-DM:', error);
        });
        return;
      }

      // Determine scope type and handle accordingly
      const isOneOnOne = otherParticipantIds.length === 1;

      if (isOneOnOne) {
        // Handle 1-on-1 DM (existing logic)
        const targetUserId = otherParticipantIds[0];
        const targetUser = participantUsers[0];

        // Check if DM already exists
        const existingDM = await this.channelRepository.getDMChannel(currentUserId, targetUserId);
        if (existingDM) {
          const conversations = await this.conversationRepository.getChannelConversations(existingDM.id);
          const participants = await this.channelParticipantRepository.getChannelParticipants(existingDM.id);
          const unreadCount = await unreadService.getUnreadCountForChannel(existingDM.id, currentUserId);

          // Send message or forwarded message if provided, even for existing DM
          let initialConversation = null;
          if (forwardedMessage) {
            initialConversation = await this.sendForwardedMessage(existingDM.id, currentUserId, forwardedMessage);
          } else if (message && message.trim()) {
            initialConversation = await this.sendInitialMessage(existingDM.id, currentUserId, message);
          }

          const existingDMStats = await db.channelStats.findUnique({ where: { channelId: existingDM.id } });

          res.status(200).json({
            message: 'DM channel already exists',
            id: existingDM.id,
            name: existingDM.name,
            scopeType: existingDM.scopeType,
            description: existingDM.description,
            visibility: existingDM.visibility,
            projectId: existingDM.projectId,
            conversationCount: initialConversation ? conversations.length + 1 : conversations.length,
            participantCount: participants.length,
            unreadCount,
            lastActivityAt: existingDMStats?.lastActivityAt ?? existingDM.createdAt,
            createdAt: existingDM.createdAt,
            isExisting: true,
            targetUser: {
              id: targetUser.id,
              name: targetUser.displayName || targetUser.name,
              email: targetUser.email,
              picture: targetUser.picture
            },
            initialConversation
          });
          return;
        }

        const v = [targetUserId, currentUserId];

        // Create new 1-on-1 DM
        const channelData: CreateChannelInput = {
          scopeType: ChannelScopeType.DM,
          name: v.sort().join(","),
          description: `Direct message between ${await this.getUserInfo(currentUserId).then(u => u.displayName || u.name)} and ${targetUser.displayName || targetUser.name}`,
          visibility: ChannelVisibility.PRIVATE,
          createdBy: currentUserId,
          projectId: dmProjectId,
          workspaceId,
        };

        const channel = await this.channelRepository.create(channelData);

        // Add participants - creator sees DM immediately unless this is a silent auto-create
        // without an initial message, in which case the channel is hidden until the first
        // message is sent.
        await this.channelParticipantRepository.addParticipant(
          channel.id,
          currentUserId,
          ChannelRole.ADMIN,
          shouldHideCreator,
        );
        await this.channelParticipantRepository.addParticipant(channel.id, targetUserId, ChannelRole.MEMBER, true);

        // If message or forwarded message is provided, create initial conversation and message using helper method
        let initialConversation = null;
        if (forwardedMessage) {
          initialConversation = await this.sendForwardedMessage(channel.id, currentUserId, forwardedMessage);
        } else if (message && message.trim()) {
          initialConversation = await this.sendInitialMessage(channel.id, currentUserId, message);
        }

        const response = {
          message: 'DM channel created successfully',
          id: channel.id,
          name: channel.name,
          scopeType: channel.scopeType,
          description: channel.description,
          visibility: channel.visibility,
          conversationCount: initialConversation ? 1 : 0,
          participantCount: 2,
          unreadCount: 0,
          lastActivityAt: channel.createdAt,
          createdAt: channel.createdAt,
          targetUser: {
            id: targetUser.id,
            name: targetUser.displayName || targetUser.name,
            email: targetUser.email,
            picture: targetUser.picture
          },
          isExisting: false,
          initialConversation
        };

        res.status(201).json(response);

        // Queue Vespa job in background for DM - worker will handle all processing
        vespaQueue.addJob({
          schema: channelSchema,
          jobType: "feed",
          docId: channel.id,
          userId: currentUserId,
          workspaceId: workspaceId,
        }).catch(error => {
          logger.error('Error queuing Vespa job for DM:', error);
        });
      } else {
        // Handle Group DM
        const allMemberIds = [currentUserId, ...otherParticipantIds].sort();

        // Check for existing group DM with same members
        const existingGroupDM = await this.channelRepository.getGroupChannelByMembers(allMemberIds);
        if (existingGroupDM) {
          const conversations = await this.conversationRepository.getChannelConversations(existingGroupDM.id);
          const participants = await this.channelParticipantRepository.getChannelParticipants(existingGroupDM.id);
          const unreadCount = await unreadService.getUnreadCountForChannel(existingGroupDM.id, currentUserId);

          // Get participant user info
          const participantDetails = await Promise.all(
            participants.map(async (p) => ({
              userId: p.userId,
              role: p.role,
              joinedAt: p.joinedAt,
              user: await this.getUserInfo(p.userId),
            }))
          );

          // Send message or forwarded message if provided, even for existing Group DM
          let initialConversation = null;
          if (forwardedMessage) {
            initialConversation = await this.sendForwardedMessage(existingGroupDM.id, currentUserId, forwardedMessage);
          } else if (message && message.trim()) {
            initialConversation = await this.sendInitialMessage(existingGroupDM.id, currentUserId, message);
          }

          const existingGroupDMStats = await db.channelStats.findUnique({ where: { channelId: existingGroupDM.id } });

          res.status(200).json({
            message: 'Group DM already exists',
            id: existingGroupDM.id,
            name: existingGroupDM.name,
            scopeType: existingGroupDM.scopeType,
            description: existingGroupDM.description,
            visibility: existingGroupDM.visibility,
            projectId: existingGroupDM.projectId,
            conversationCount: initialConversation ? conversations.length + 1 : conversations.length,
            participantCount: participants.length,
            unreadCount,
            lastActivityAt: existingGroupDMStats?.lastActivityAt ?? existingGroupDM.createdAt,
            createdAt: existingGroupDM.createdAt,
            participants: participantDetails,
            isExisting: true,
            initialConversation
          });
          return;
        }

        const titleForGroupDms = allMemberIds.sort().join(",");

        // Create new group DM
        const channelData: CreateChannelInput = {
          scopeType: ChannelScopeType.GROUP_DM,
          name: titleForGroupDms,
          visibility: ChannelVisibility.PRIVATE,
          createdBy: currentUserId,
          projectId: dmProjectId,
          workspaceId,
        };

        const channel = await this.channelRepository.create(channelData);

        // Add all participants - creator sees DM immediately unless this is a silent auto-create
        // without an initial message, in which case the channel is hidden until the first
        // message is sent.
        await this.channelParticipantRepository.addParticipant(
          channel.id,
          currentUserId,
          ChannelRole.ADMIN,
          shouldHideCreator,
        );

        const participantAddResults = [];
        for (const participantId of uniqueParticipantIds) {
          await this.channelParticipantRepository.addParticipant(channel.id, participantId, ChannelRole.MEMBER, true);
          participantAddResults.push({
            userId: participantId,
            user: participantUsers.find(u => u.id === participantId),
            role: 'MEMBER'
          });
        }

        // Add creator info
        const allParticipantDetails = [
          {
            userId: currentUserId,
            user: await this.getUserInfo(currentUserId),
            role: 'ADMIN'
          },
          ...participantAddResults
        ];

        // If message or forwarded message is provided, create initial conversation and message using helper method
        let initialConversation = null;
        if (forwardedMessage) {
          initialConversation = await this.sendForwardedMessage(channel.id, currentUserId, forwardedMessage);
        } else if (message && message.trim()) {
          initialConversation = await this.sendInitialMessage(channel.id, currentUserId, message);
        }

        const response = {
          message: 'Group DM created successfully',
          id: channel.id,
          name: channel.name,
          scopeType: channel.scopeType,
          description: channel.description,
          visibility: channel.visibility,
          conversationCount: initialConversation ? 1 : 0,
          participantCount: allMemberIds.length,
          unreadCount: 0,
          lastActivityAt: channel.createdAt,
          createdAt: channel.createdAt,
          participants: allParticipantDetails,
          isExisting: false,
          initialConversation
        };

        res.status(201).json(response);

        // Queue Vespa job in background for Group DM - worker will handle all processing
        vespaQueue.addJob({
          schema: channelSchema,
          jobType: "feed",
          docId: channel.id,
          userId: currentUserId,
          workspaceId: workspaceId,
        }).catch(error => {
          logger.error('Error queuing Vespa job for Group DM:', error);
        });
      }
    } catch (error) {
      logger.error('Error creating DM:', error);

      if (error instanceof Error && error.message.includes('already exists in organization')) {
        res.status(409).json({
          error: 'DM_ALREADY_EXISTS',
          message: 'A DM channel already exists'
        });
        return;
      }

      res.status(500).json({ error: 'Internal server error' });
    }
  };

  getDmHistoryPreview = async (req: Request, res: Response): Promise<void> => {
    try {
      const currentUserId = req.user!.id;
      const { channelId } = req.params;
      const sinceParam = typeof req.query.since === 'string' ? Number(req.query.since) : NaN;
      const limitParam = typeof req.query.limit === 'string' ? Number(req.query.limit) : NaN;

      const since = Number.isFinite(sinceParam) ? new Date(sinceParam) : null;
      const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 50) : 20;

      const { conversations, total } = await groupDmParticipantService.getHistoryPreview({
        channelId,
        currentUserId,
        since,
        limit,
      });

      res.status(200).json({ conversations, total });
    } catch (error) {
      if (error instanceof AppError) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }
      logger.error('Error building DM history preview:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  addGroupDmParticipants = async (req: Request, res: Response): Promise<void> => {
    try {
      const currentUserId = req.user!.id;
      const workspaceId = req.user!.workspaceId!;
      const { channelId } = req.params;
      const body = req.body as AddGroupDmParticipantsRequest;

      const result = await groupDmParticipantService.addParticipants({
        channelId,
        currentUserId,
        workspaceId,
        userIds: body.userIds,
        historyScope: normalizeHistoryScope(body),
      });

      const movedHistory = result.conversationsMoved > 0;

      if (result.addedParticipants.length > 0 || movedHistory) {
        const authData = await this.getUserInfo(currentUserId);
        try {
          // A brand-new group announces the people. Merging into an existing one announces the
          // move instead, since its members were already there — and only if anything moved.
          if (!result.isExisting) {
            await this.sendAddAndRemoveParticipantsSystemMessage(
              result.channelId,
              result.addedParticipants,
              authData,
              'participants_added'
            );
          } else if (movedHistory) {
            await this.sendAddAndRemoveParticipantsSystemMessage(
              result.channelId,
              [],
              authData,
              'conversation_moved_target'
            );
          }
          if (movedHistory) {
            await this.sendAddAndRemoveParticipantsSystemMessage(
              result.sourceChannelId,
              result.destinationMembers,
              authData,
              'conversation_moved_source',
              {
                movedEverything: result.movedEverything,
                destinationChannelId: result.channelId,
              }
            );
          }
        } catch (error) {
          // Message can carry user-supplied names; strip newlines so it can't forge log lines.
          const message = (error instanceof Error ? error.message : String(error)).replace(/\n|\r/g, ' ');
          logger.error('Failed to post add-people system messages', { error: message });
        }

        const handler = new ChannelParticipantsSideEffectHandler({
          userID: currentUserId,
          workspaceId: req.user!.workspaceId,
          role: req.user!.role,
          orgRole: req.user!.orgRole,
          memberId: req.user!.memberId,
        });
        for (const participant of result.addedParticipants) {
          handler.onInsert({
            entityId: participant.participantId,
            entityType: 'channel_participants',
            operation: 'insert'
          }).catch(err => logger.error('Side-effect handler error: channel_participants onInsert', err));
        }
      }

      const response: AddGroupDmParticipantsResponse = {
        channelId: result.channelId,
        isExisting: result.isExisting,
        participantsAdded: result.participantsAdded,
        conversationsMoved: result.conversationsMoved,
        message: result.message,
      };

      res.status(result.isExisting ? 200 : 201).json(response);
    } catch (error) {
      if (error instanceof AppError) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }
      logger.error('Error adding GROUP_DM participants:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}
