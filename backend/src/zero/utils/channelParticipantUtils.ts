import { Transaction } from '@rocicorp/zero';
import { Schema, ChannelRole } from '@xyne/shared';
import { v4 as uuidv4 } from 'uuid';
import { zql } from '../queries'
/**
 * Adds a single participant to a channel and increments participantCount
 * @param tx - Zero transaction
 * @param channelId - Channel ID to add participant to
 * @param userId - User ID to add
 * @param role - Participant role (default: 'member')
 * @param participantId - Optional pre-generated participant ID
 * @param channelUserStatusId - Optional pre-generated channel user status ID
 * @param timestamp - Optional timestamp for joinedAt and other date fields
 * @returns Object with added status and participantId
 */
export async function addChannelParticipant(
  tx: Transaction<Schema>,
  channelId: string,
  userId: string,
  role: ChannelRole = ChannelRole.MEMBER,
  participantId: string,
  channelUserStatusId: string,
  timestamp: number
): Promise<{ added: boolean; participantId: string }> {
  // Check if participant already exists
  const existingParticipant = await tx.run(zql.channel_participants
    .where('channelId', channelId)
    .where('userId', userId)
    .one());

  if (existingParticipant) {
    return { added: false, participantId: existingParticipant.id };
  }

  const id = participantId;
  const now = timestamp;

  // Insert into channel_participants
  await tx.mutate.channel_participants.insert({
    id,
    channelId,
    userId,
    role,
    joinedAt: now,
    // Deprecated columns
    lastViewedAt: now,
    isStarred: false,
    isClosed: false,
  });

  // Insert into channel_user_status
  await tx.mutate.channel_user_status.insert({
    id: channelUserStatusId,
    channelId,
    userId,
    lastViewedAt: now,
    isStarred: false,
    isClosed: false,
    unreadCount: 0,
    isRecapSubscribed: false,
  });

  // Increment participantCount
  const channel = await tx.run(zql.channels.where('id', channelId).one());
  if (channel) {
    await tx.mutate.channels.update({
      id: channelId,
      participantCount: (channel.participantCount || 0) + 1,
    });
  }

  return { added: true, participantId: id };
}

/**
 * Adds multiple participants to a channel in bulk and updates participantCount
 * @param tx - Zero transaction
 * @param channelId - Channel ID to add participants to
 * @param userIds - Array of user IDs to add
 * @param role - Participant role for all users (default: 'member')
 * @returns Object with count and list of added user IDs
 */
export async function addChannelParticipants(
  tx: Transaction<Schema>,
  channelId: string,
  userIds: string[],
  role: ChannelRole = ChannelRole.MEMBER
): Promise<{ addedCount: number; addedUserIds: string[] }> {
  if (userIds.length === 0) {
    return { addedCount: 0, addedUserIds: [] };
  }

  // Get existing participants
  const existingParticipants = await tx.run(zql.channel_participants
    .where('channelId', channelId));

  const existingUserIds = new Set(existingParticipants.map((p: any) => p.userId));

  // Filter out users who are already participants
  const newUserIds = userIds.filter((userId) => !existingUserIds.has(userId));

  if (newUserIds.length === 0) {
    return { addedCount: 0, addedUserIds: [] };
  }

  // Insert all new participants
  for (const userId of newUserIds) {
    const participantId = uuidv4();
    
    await tx.mutate.channel_participants.insert({
      id: participantId,
      channelId,
      userId,
      role,
      joinedAt: Date.now(),
      // Deprecated columns
      lastViewedAt: Date.now(),
      isStarred: false,
      isClosed: false,
    });

    await tx.mutate.channel_user_status.insert({
      id: uuidv4(),
      channelId,
      userId,
      lastViewedAt: Date.now(),
      isStarred: false,
      isClosed: false,
      unreadCount: 0,
      isRecapSubscribed: false,
    });
  }

  // Increment participantCount by the number of actually added participants
  const channel = await tx.run(zql.channels.where('id', channelId).one());
  if (channel) {
    await tx.mutate.channels.update({
      id: channelId,
      participantCount: (channel.participantCount || 0) + newUserIds.length,
    });
  }

  return { addedCount: newUserIds.length, addedUserIds: newUserIds };
}

/**
 * Removes a participant from a channel and decrements participantCount
 * @param tx - Zero transaction
 * @param channelId - Channel ID to remove participant from
 * @param userId - User ID to remove
 * @returns Object with removed status and participantId
 */
export async function removeChannelParticipant(
  tx: Transaction<Schema>,
  channelId: string,
  userId: string
): Promise<{ removed: boolean; participantId: string | null }> {
  // Find the participant
  const participant = await tx.run(zql.channel_participants
    .where('channelId', channelId)
    .where('userId', userId)
    .one());

  if (!participant) {
    return { removed: false, participantId: null };
  }

  // Update channel participantCount BEFORE deleting participant
  // This ensures the user is still a participant when the ACL check runs
  const channel = await tx.run(zql.channels.where('id', channelId).one());
  if (channel) {
    await tx.mutate.channels.update({
      id: channelId,
      participantCount: Math.max((channel.participantCount || 0) - 1, 0),
    });
  }

  // Delete from channel_participants
  await tx.mutate.channel_participants.delete({ id: participant.id });

  // Delete from channel_user_status
  const userStatus = await tx.run(zql.channel_user_status
    .where('channelId', channelId)
    .where('userId', userId)
    .one());

  if (userStatus) {
    await tx.mutate.channel_user_status.delete({ id: userStatus.id });
  }

  return { removed: true, participantId: participant.id };
}

/**
 * Updates a participant's role in a channel
 * @param tx - Zero transaction
 * @param channelId - Channel ID
 * @param userId - User ID
 * @param role - New role for the participant
 * @returns Object with updated status
 */
export async function updateChannelParticipantRole(
  tx: Transaction<Schema>,
  channelId: string,
  userId: string,
  role: ChannelRole
): Promise<{ updated: boolean; participantId: string | null }> {
  // Find the participant
  const participant = await tx.run(zql.channel_participants
    .where('channelId', channelId)
    .where('userId', userId)
    .one());

  if (!participant) {
    return { updated: false, participantId: null };
  }

  // Update the role
  await tx.mutate.channel_participants.update({
    id: participant.id,
    role,
  });

  return { updated: true, participantId: participant.id };
}
