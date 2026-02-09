import { Channel, MessageType, Schema } from '@xyne/shared';
import { Transaction } from '@rocicorp/zero';
import { AuthData, ParticipantOperationType } from '@/zero/mutators';
import { v4 as uuidv4 } from 'uuid';
import { zql } from '../queries';

type ParticipantMetadata = {
  operationType: ParticipantOperationType;
  participants: Array<{
    userId: string;
    userName: string;
  }>;
  adminUserId: string;
  adminUserName: string;
}

export function formatSystemGenerateMessage(
  participantsList: Array<{ userId: string; userName: string }>,
  operationType: ParticipantOperationType,
  authData: AuthData
): string {
  const allUserNames = participantsList.map((p) => p.userName);
  let formattedUsers = '';
  if (allUserNames.length === 1) {
    formattedUsers = allUserNames[0];
  } else if (allUserNames.length > 1) {
    formattedUsers = `${allUserNames.slice(0, -1).join(', ')} and ${allUserNames[allUserNames.length - 1]}`;
  }

  let systemMessage = '';
  if (
    operationType === 'participants_added' ||
    operationType === 'participants_removed'
  ) {
    const addedOrRemovedText =
      operationType === 'participants_added' ? 'added' : 'removed';
    systemMessage = `${formattedUsers} ${allUserNames.length === 1 ? 'was' : 'were'} ${addedOrRemovedText} by ${authData.name}`;
  } else if (operationType === 'participants_joined') {
    systemMessage = `${formattedUsers} joined the channel`;
  }
  return systemMessage;
}

export async function sendAddAndRemoveParticipantsSystemMessage(
  tx: Transaction<Schema>,
  {
    channel,
    newParticipants,
    authData,
    operationType,
  }: {
    channel: Channel;
    newParticipants: Array<{ userId: string; userName: string }>;
    authData: AuthData;
    operationType: ParticipantOperationType;
  }
): Promise<void> {
  const channelId = channel.id;
  if (newParticipants.length > 0) {
    // Check if the last message is a bot message about participant addition/removal by the same admin
    const lastConversation = await tx.run(zql.conversations
      .where('channelId', channelId)
      .orderBy('lastActivityAt', 'desc')
      .limit(1)
      );

    let shouldUpdateLastMessage = false;
    let lastMessage = null;
    let existingMetadata: ParticipantMetadata | null = null;

    if (lastConversation.length > 0) {
      const lastMessages = await tx.run(zql.messages
        .where('conversationId', lastConversation[0].conversationId)
        .orderBy('createdAt', 'desc')
        .limit(1)
        );

      if (lastMessages.length > 0) {
        lastMessage = lastMessages[0];

        // Check if it's a bot message with participant metadata by the same admin
        if (lastMessage.msgType === MessageType.SYSTEM && lastMessage.metadata) {
          try {
            existingMetadata = lastMessage.metadata as ParticipantMetadata;
            if (existingMetadata.operationType === operationType && existingMetadata.adminUserId === authData.sub) {
              shouldUpdateLastMessage = true;
            }
          } catch (error) {
            // Metadata parsing failed, treat as new message
            shouldUpdateLastMessage = false;
          }
        }
      }
    }

    if (shouldUpdateLastMessage && lastMessage && existingMetadata) {
      const allParticipants = [...existingMetadata.participants, ...newParticipants];
      const updatedContent = formatSystemGenerateMessage(allParticipants, operationType, authData);

      // Update metadata
      const updatedMetadata: ParticipantMetadata = {
        operationType,
        participants: allParticipants,
        adminUserId: authData.sub,
        adminUserName: authData.name,
      };

      // Update the existing message
      await tx.mutate.messages.update({
        messageId: lastMessage.messageId,
        content: updatedContent,
        metadata: updatedMetadata,
      });

      // Update channel last activity
      await tx.mutate.channels.update({
        id: channelId,
        lastActivityAt: Date.now(),
      });
    } else {
      // Create new message
      const systemContent = formatSystemGenerateMessage(newParticipants, operationType, authData);
      const now = Date.now();
      const conversationId = uuidv4();
      const messageId = uuidv4();

      // Create metadata
      const messageMetadata: ParticipantMetadata = {
        operationType,
        participants: newParticipants,
        adminUserId: authData.sub,
        adminUserName: authData.name,
      };

      // Create conversation for system message
      await tx.mutate.conversations.insert({
        conversationId,
        channelId,
        createdBy: 'system',
        initialMessageId: messageId,
        lastActivityAt: now,
        replyCount: 0,
        pinned: false,
        metadata: undefined,
        createdAt: now,
      });

      // Create system message (appears to come from the first added user)
      await tx.mutate.messages.insert({
        messageId,
        conversationId,
        senderId: newParticipants[0].userId,
        content: systemContent,
        msgType: MessageType.SYSTEM,
        hasAttachment: false,
        edited: false,
        isDeleted: false,
        createdAt: now,
        metadata: messageMetadata,
        showInChannel: false,
        isSent: true
      });

      // Update channel last activity
      await tx.mutate.channels.update({
        id: channelId,
        lastActivityAt: now,
      });
    }
  }
}

/**
 * Format call duration from milliseconds to human readable format
 * Examples: "45s", "2m", "15m", "1h 23m", "2h"
 */
function formatCallDuration(durationMs: number): string {
  const seconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours === 0 && minutes === 0) {
    return `${seconds}s`;
  } else if (hours === 0) {
    return `${minutes}m`;
  } else if (remainingMinutes === 0) {
    return `${hours}h`;
  } else {
    return `${hours}h ${remainingMinutes}m`;
  }
}

/**
 * Format final call message based on participant count
 * Examples:
 * - 1 participant: "Alice started a call • lasted 2m"
 * - 2 participants: "Alice and Bob were in the call for 9m"
 * - 3+ participants: "Alice and 2 others were in the call for 15m"
 */
function formatFinalCallMessage(
  participants: Array<{ userId: string; userName: string }>,
  durationMs: number,
  currentUserId: string
): string {
  const duration = formatCallDuration(durationMs);
  
  if (participants.length === 1) {
    return `${participants[0].userName} started a call • lasted ${duration}`;
  } else if (participants.length === 2) {
    return `${participants[0].userName} and ${participants[1].userName} were in the call for ${duration}`;
  } else {
    const firstParticipant = participants.find(p => p.userId === currentUserId) 
      ? participants.find(p => p.userId !== currentUserId) || participants[0]
      : participants[0];
    const othersCount = participants.length - 1;
    return `${firstParticipant.userName} and ${othersCount} ${othersCount === 1 ? 'other' : 'others'} were in the call for ${duration}`;
  }
}

/**
 * Create a system message for a call that will be updated when the call ends.
 * Only ONE message is created per call.
 * The message ID is stored in call.metadata for later updates.
 */
export async function sendCallSystemMessage(
  tx: Transaction<Schema>,
  {
    callExternalId,
    channelId,
    initiatorUserName,
  }: {
    callExternalId: string;
    channelId: string;
    initiatorUserName: string;
  }
): Promise< {messageId: string; conversationId: string} > {
  const now = Date.now();
  const conversationId = uuidv4();
  const messageId = uuidv4();

  // Create message metadata for UI to detect this is a call message
  const messageMetadata = {
    isCallMessage: true,
    callId: callExternalId,
    operation: 'call_active', // Will be changed to 'call_ended' when call finishes
  };

  // Create conversation for system message
  await tx.mutate.conversations.insert({
    conversationId,
    channelId,
    createdBy: 'system',
    initialMessageId: messageId,
    lastActivityAt: now,
    replyCount: 0,
    pinned: false,
    metadata: undefined,
    createdAt: now,
  });

  // Create system message - content will be updated when call ends
  // For now, use placeholder that will be hidden by overlay component
  // Use 'system' as senderId instead of actual user
  await tx.mutate.messages.insert({
    messageId,
    conversationId,
    senderId: 'system',
    content: `${initiatorUserName} started a call`, // Placeholder, will be updated on end
    msgType: MessageType.SYSTEM,
    hasAttachment: false,
    edited: false,
    isDeleted: false,
    createdAt: now,
    metadata: messageMetadata,
    showInChannel: false, // Only show as conversation card, not as standalone message
    isSent: true,
  });

  // Update channel last activity
  await tx.mutate.channels.update({
    id: channelId,
    lastActivityAt: now,
  });

  return { messageId, conversationId };
}

/**
 * Update the call system message when the call ends.
 * Calculates duration and formats the final message based on participants.
 */
export async function updateCallSystemMessageOnEnd(
  tx: Transaction<Schema>,
  {
    messageId,
    participants,
    startedAt,
    endedAt,
    callId,
    currentUserId,
  }: {
    messageId: string;
    participants: Array<{ userId: string; userName: string }>;
    startedAt: number;
    endedAt: number;
    callId: string;
    currentUserId: string;
  }
): Promise<void> {
  const durationMs = endedAt - startedAt;
  const finalContent = formatFinalCallMessage(participants, durationMs, currentUserId);

  // Update message with final content and mark as ended
  await tx.mutate.messages.update({
    messageId,
    content: finalContent,
    metadata: {
      isCallMessage: true,
      callId,
      operation: 'call_ended',
      durationMs,
    },
  });
}
