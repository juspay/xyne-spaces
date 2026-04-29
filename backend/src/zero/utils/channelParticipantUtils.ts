import { Transaction } from '@rocicorp/zero';
import { Schema, ChannelRole, ChannelType } from '@xyne/shared';
import { v4 as uuidv4 } from 'uuid';
import { zql } from '../queries'

/**
 * Per-(channel, user) unread count for email channels.
 * A ticket is unread if:
 *   - the user has no email_reads row for it, OR
 *   - their email_reads.updatedAt is older than ticket.lastEmailAt (i.e. a
 *     newer email arrived after they last read the thread).
 *
 * This catches the "read but a reply arrived since" case that a plain
 * `tickets - email_reads` subtraction would miss.
 *
 * Returns 0 for non-email channels (their unread is derived elsewhere).
 */
async function computeUnreadCountForUser(
  tx: Transaction<Schema>,
  channelId: string,
  userId: string,
): Promise<number> {
  const channel = await tx.run(zql.channels.where('id', channelId).one());
  if (channel?.type !== ChannelType.EMAIL) return 0;

  const tickets = await tx.run(
    zql.tickets.where('channelId', channelId).where('isArchived', false),
  );
  if (tickets.length === 0) return 0;

  const ticketIds = tickets.map(t => t.id);
  const reads = await tx.run(
    zql.email_reads
      .where('userId', userId)
      .where((helpers: any) => helpers.cmp('ticketId', 'IN', ticketIds)),
  );
  const readAtByTicket = new Map<string, number>(
    reads.map(r => [r.ticketId, r.updatedAt]),
  );

  let unread = 0;
  for (const t of tickets) {
    const readAt = readAtByTicket.get(t.id);
    if (readAt === undefined || readAt < t.lastEmailAt) unread += 1;
  }
  return unread;
}
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

  // Check for existing soft-deleted channel_user_status to restore
  const existingSoftDeletedStatus = await tx.run(zql.channel_user_status
    .where('channelId', channelId)
    .where('userId', userId)
    .where('isDeleted', true)
    .one());

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
  
  const unreadCount = await computeUnreadCountForUser(tx, channelId, userId);

  if (existingSoftDeletedStatus) {
    await tx.mutate.channel_user_status.update({
      id: existingSoftDeletedStatus.id,
      isDeleted: false,
      lastViewedAt: now,
      isClosed: false,
      unreadCount,
      updatedAt: now,
    });
  } else {
    await tx.mutate.channel_user_status.insert({
      id: channelUserStatusId,
      channelId,
      userId,
      lastViewedAt: now,
      isStarred: false,
      isClosed: false,
      unreadCount,
      isRecapSubscribed: false,
      desktopNotificationLevel: 'ALL',
      mobileNotificationLevel: 'ALL',
      isDeleted: false,
      updatedAt: now,
    });
  }

  // Increment participantCount in channel_stats
  const channelStats = await tx.run(zql.channel_stats.where('channelId', channelId).one());
  if (channelStats) {
    await tx.mutate.channel_stats.update({
      channelId,
      participantCount: (channelStats.participantCount || 0) + 1,
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
 * @param timestamp - Timestamp for the operation
 * @returns Object with count and list of added user IDs
 */
export async function addChannelParticipants(
  tx: Transaction<Schema>,
  channelId: string,
  userIds: string[],
  role: ChannelRole = ChannelRole.MEMBER,
  timestamp: number
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

  // Check for existing soft-deleted channel_user_status records
  const existingSoftDeletedStatuses = await tx.run(zql.channel_user_status
    .where('channelId', channelId)
    .where('isDeleted', true));

  const softDeletedStatusMap = new Map(
    existingSoftDeletedStatuses
      .filter((s: any) => newUserIds.includes(s.userId))
      .map((s: any) => [s.userId, s])
  );

  // unreadCount is recomputed per user since rejoiners may carry their own
  // pre-existing email_reads — no shared value across users.
  for (const userId of newUserIds) {
    const participantId = uuidv4();
    const softDeletedStatus = softDeletedStatusMap.get(userId);

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

    const unreadCount = await computeUnreadCountForUser(tx, channelId, userId);

    if (softDeletedStatus) {
      await tx.mutate.channel_user_status.update({
        id: softDeletedStatus.id,
        isDeleted: false,
        lastViewedAt: timestamp,
        isClosed: false,
        unreadCount,
        updatedAt: timestamp,
      });
    } else {
      await tx.mutate.channel_user_status.insert({
        id: uuidv4(),
        channelId,
        userId,
        lastViewedAt: timestamp,
        isStarred: false,
        isClosed: false,
        unreadCount,
        isRecapSubscribed: false,
        desktopNotificationLevel: 'ALL',
        mobileNotificationLevel: 'ALL',
        isDeleted: false,
        updatedAt: timestamp,
      });
    }
  }

  // Increment participantCount by the number of actually added participants in channel_stats
  const channelStats = await tx.run(zql.channel_stats.where('channelId', channelId).one());
  if (channelStats) {
    await tx.mutate.channel_stats.update({
      channelId,
      participantCount: (channelStats.participantCount || 0) + newUserIds.length,
    });
  }

  return { addedCount: newUserIds.length, addedUserIds: newUserIds };
}

/**
 * Removes a participant from a channel and decrements participantCount
 * @param tx - Zero transaction
 * @param channelId - Channel ID to remove participant from
 * @param userId - User ID to remove
 * @param timestamp - Timestamp for the operation
 * @returns Object with removed status and participantId
 */
export async function removeChannelParticipant(
  tx: Transaction<Schema>,
  channelId: string,
  userId: string,
  timestamp: number
): Promise<{ removed: boolean; participantId: string | null }> {
  // Find the participant
  const participant = await tx.run(zql.channel_participants
    .where('channelId', channelId)
    .where('userId', userId)
    .one());

  if (!participant) {
    return { removed: false, participantId: null };
  }

  // Update channel_stats participantCount BEFORE deleting participant
  // This ensures the user is still a participant when the ACL check runs
  const channelStats = await tx.run(zql.channel_stats.where('channelId', channelId).one());
  if (channelStats) {
    await tx.mutate.channel_stats.update({
      channelId,
      participantCount: Math.max((channelStats.participantCount || 0) - 1, 0),
    });
  }

  // Delete from channel_participants
  await tx.mutate.channel_participants.delete({ id: participant.id });

  // Delete from channel_user_status (soft delete)
  const userStatus = await tx.run(zql.channel_user_status
    .where('channelId', channelId)
    .where('userId', userId)
    .one());

  if (userStatus) {
    await tx.mutate.channel_user_status.update({
      id: userStatus.id,
      isDeleted: true,
      updatedAt: timestamp,
    });
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
