/**
 * Mention Utilities
 * Functions for extracting and processing user mentions from message content
 */

import { UserRepository } from '../database/repositories/users';
import { UserGroupRepository } from '../database/repositories/userGroups';
import { ChannelParticipantRepository } from '@/database/repositories/channelParticipantRepository';
import { redisService } from '@/services/redisService';
import {logger} from '@/utils/logger';

export interface ExtractedMention {
  userId: string;
  username: string;
  userEmail?: string;
  userPicture?: string;
}

export interface ExtractedGroupMention {
  groupId: string;
  groupName: string;
  memberCount?: number;
}


// New simplified interface for unified mention processing
export interface ExtractedMentionForNotification {
  userId: string;
  username: string;
  userEmail?: string;
  userPicture?: string;
  mentionSource: 'direct' | 'group' | 'channel' | 'here'; // Track mention type
  groupId?: string; // If mentioned via group, store the group ID
  groupName?: string; // If mentioned via group, store the group name
}

// Special mention types detection result
export interface SpecialMentions {
  hasChannel: boolean; // @channel mentioned
  hasHere: boolean; // @here mentioned
}

/**
 * Extract mentions from message content
 * Handles both zero-width space delimited mentions and HTML span mentions
 */
export async function extractMentionsFromContent(content: string): Promise<ExtractedMention[]> {
  const mentions: ExtractedMention[] = [];
  const processedUserIds = new Set<string>(); // Prevent duplicates

  // Method 0: Extract mrkdwn token format <userid:ID> used in FlowJSON text components.
  // Slack user mentions in BlockKit are normalised to <userid:xyneDbId> by the
  // FlowJSON converter.  We need to handle this before the TipTap span scan.
  const mrkdwnUserTokenRegex = /<userid:([\w-]+)>/g;
  let mrkdwnMatch: RegExpExecArray | null;
  while ((mrkdwnMatch = mrkdwnUserTokenRegex.exec(content)) !== null) {
    const userId = mrkdwnMatch[1];
    if (!processedUserIds.has(userId)) {
      processedUserIds.add(userId);
      // userId is already the Xyne DB id — we don't have email/picture here
      mentions.push({ userId, username: userId });
    }
  }

  // Method 1: Extract from HTML span elements with data-user-id attribute
  // Matches both TipTap format (double quotes) and BlockKit-parsed format (single quotes)
  const spanTagRegex = /<span\b[^>]*\bdata-user-id=["'][^"']+["'][^>]*>(?:[^<]*)<\/span>/gi;
  let spanMatch;

  while ((spanMatch = spanTagRegex.exec(content)) !== null) {
    const spanTag = spanMatch[0];
    
    const userIdMatch = spanTag.match(/data-user-id=["']([^"']+)["']/i);
    const usernameMatch = spanTag.match(/data-username=["']([^"']+)["']/i);
    const userEmailMatch = spanTag.match(/data-user-email=["']([^"']*)["']/i);
    const userPictureMatch = spanTag.match(/data-user-picture=["']([^"']*)["']/i);

    if (!userIdMatch || !usernameMatch) {
      logger.warn(`⚠️ [MENTION-HTML] Skipping span tag missing required attributes: ${spanTag.substring(0, 100)}`);
      continue;
    }

    const userId = userIdMatch[1];
    const username = usernameMatch[1];
    const userEmail = userEmailMatch ? userEmailMatch[1] : undefined;
    let userPicture = userPictureMatch ? userPictureMatch[1] : undefined;
    if (userPicture) {
      userPicture = userPicture.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    }

    // Skip if we already processed this user ID
    if (processedUserIds.has(userId)) {
      continue;
    }
    processedUserIds.add(userId);

    mentions.push({
      userId,
      username,
      userEmail: userEmail || undefined,
      userPicture: userPicture || undefined,
    });

    logger.info(`✅ [MENTION-HTML] Extracted mention from HTML span: @${username} -> ${userId} (${userEmail})`);
  }

  // Method 2: Fallback to zero-width space delimited mentions (legacy format)
  const ZWSP = '\u200B';
  const mentionRegex = new RegExp(`${ZWSP}@([^${ZWSP}]+)${ZWSP}`, 'g');
  let match;

  const userRepository = new UserRepository();
  const processedUsernames = new Set<string>(); // Prevent duplicates

  while ((match = mentionRegex.exec(content)) !== null) {
    const username = match[1];

    // Skip if we already processed this username
    if (processedUsernames.has(username)) {
      continue;
    }
    processedUsernames.add(username);

    try {
      // Try to find user by searching (case-insensitive, starts with)
      const searchResults = await userRepository.findBySearch(username);
      const users = Array.isArray(searchResults) ? searchResults : searchResults.data;

      // Find exact match (case-insensitive)
      const user = users.find(u => u.name.toLowerCase() === username.toLowerCase());

      if (user) {
        // Skip if we already processed this user ID from HTML spans
        if (processedUserIds.has(user.id)) {
          continue;
        }
        processedUserIds.add(user.id);

        mentions.push({
          userId: user.id,
          username: user.name,
          userEmail: user.email,
          userPicture: user.picture || undefined,
        });

        logger.info(`✅ [MENTION-ZWSP] Resolved @${username} to user ${user.id} (${user.email})`);
      } else {
        logger.warn(`⚠️ [MENTION-ZWSP] Could not resolve username: ${username}`);
      }
    } catch (error) {
      logger.error(`❌ [MENTION-ZWSP] Error resolving username ${username}:`, error);
    }
  }

  logger.info(`🏷️ [MENTION] Extracted ${mentions.length} total mentions from message`);
  return mentions;
}

/**
 * Check if message content contains any mentions
 * Checks for both HTML span mentions and zero-width space mentions
 */
export function hasMentions(content: string): boolean {
  // Check for HTML span mentions (TipTap format) - handle attributes in any order
  const spanMentionRegex = /<span[^>]*class="[^"]*chat-input-mention[^"]*"[^>]*>/;
  if (spanMentionRegex.test(content)) {
    return true;
  }

  // Check for zero-width space mentions (legacy format)
  const ZWSP = '\u200B';
  const mentionRegex = new RegExp(`${ZWSP}@([^${ZWSP}]+)${ZWSP}`, 'g');
  return mentionRegex.test(content);
}



/**
 * Extract group mentions from message content
 * Handles both HTML span group mentions and zero-width space group mentions
 */
export async function extractGroupMentionsFromContent(
  content: string,
  workspaceId: string
): Promise<ExtractedGroupMention[]> {
  const groupMentions: ExtractedGroupMention[] = [];
  const processedGroupIds = new Set<string>(); // Prevent duplicates

  // Method 0: Extract mrkdwn token format <groupid:ID:alias> used in FlowJSON text components.
  // Mirrors the <userid:ID> handling in extractMentionsFromContent.
  const mrkdwnGroupTokenRegex = /<groupid:([\w-]+)(?::([^>]+))?>/g;
  let mrkdwnGroupMatch: RegExpExecArray | null;
  while ((mrkdwnGroupMatch = mrkdwnGroupTokenRegex.exec(content)) !== null) {
    const groupId = mrkdwnGroupMatch[1];
    const groupAlias = mrkdwnGroupMatch[2] ?? groupId;
    if (!processedGroupIds.has(groupId)) {
      processedGroupIds.add(groupId);
      groupMentions.push({ groupId, groupName: groupAlias });
    }
  }

  // Method 1: Extract from HTML span elements with data-group-id attribute
  // Matches both TipTap format (double quotes, class="chat-input-group-mention")
  // and BlockKit-parsed format (single quotes, data-mention data-mention-type='group')
  const spanTagRegex = /<span\b[^>]*\bdata-group-id=["'][^"']+["'][^>]*>(?:[^<]*)<\/span>/gi;
  let spanMatch;

  while ((spanMatch = spanTagRegex.exec(content)) !== null) {
    const spanTag = spanMatch[0];
    
    const groupIdMatch = spanTag.match(/data-group-id=["']([^"']+)["']/i);
    const groupNameMatch = spanTag.match(/data-group-name=["']([^"']+)["']/i);
    const memberCountMatch = spanTag.match(/data-member-count=["']([^"']*)["']/i);

    if (!groupIdMatch || !groupNameMatch) {
      logger.warn(`⚠️ [GROUP-MENTION-HTML] Skipping span tag missing required attributes: ${spanTag.substring(0, 100)}`);
      continue;
    }

    const groupId = groupIdMatch[1];
    const groupName = groupNameMatch[1];
    const memberCount = memberCountMatch ? parseInt(memberCountMatch[1]) : undefined;

    // Skip if we already processed this group ID
    if (processedGroupIds.has(groupId)) {
      continue;
    }
    processedGroupIds.add(groupId);

    groupMentions.push({
      groupId,
      groupName,
      memberCount,
    });

    logger.info(`✅ [GROUP-MENTION-HTML] Extracted group mention from HTML span: @${groupName} -> ${groupId} (${memberCount} members)`);
  }

  // Method 2: Fallback to zero-width space delimited group mentions (legacy format)
  const ZWSP = '\u200B';
  // Pattern for group mentions: @group:groupname or @group-name (kebab-case)
  const groupMentionRegex = new RegExp(`${ZWSP}@(group:|[a-z0-9-]+)([^${ZWSP}]*)${ZWSP}`, 'gi');
  let match;

  const userGroupRepository = new UserGroupRepository();
  const processedGroupNames = new Set<string>(); // Prevent duplicates

  while ((match = groupMentionRegex.exec(content)) !== null) {
    let groupName = match[1] === 'group:' ? match[2] : match[1] + match[2];
    groupName = groupName.toLowerCase().trim();

    // Skip if we already processed this group name
    if (processedGroupNames.has(groupName)) {
      continue;
    }
    processedGroupNames.add(groupName);

    try {
      // Try to find group by alias first, then by name (case-insensitive)
      let group = await userGroupRepository.findByAlias(groupName, workspaceId);

      if (!group) {
        // Fallback to finding by name
        group = await userGroupRepository.findByName(groupName, workspaceId);
      }

      if (group) {
        // Skip if we already processed this group ID from HTML spans
        if (processedGroupIds.has(group.id)) {
          continue;
        }
        processedGroupIds.add(group.id);

        groupMentions.push({
          groupId: group.id,
          groupName: group.name,
          // Note: memberCount would require a separate query, can be added later if needed
        });

        const resolvedAs = group.alias === groupName ? 'alias' : 'name';
        logger.info(`✅ [GROUP-MENTION-ZWSP] Resolved @${groupName} to group ${group.id} (${group.name}) via ${resolvedAs}`);
      } else {
        logger.warn(`⚠️ [GROUP-MENTION-ZWSP] Could not resolve group alias or name: ${groupName}`);
      }
    } catch (error) {
      logger.error(`❌ [GROUP-MENTION-ZWSP] Error resolving group name ${groupName}:`, error);
    }
  }

  logger.info(`🏷️ [GROUP-MENTION] Extracted ${groupMentions.length} total group mentions from message`);
  return groupMentions;
}


/**
 * NEW: Extract all users to be notified (direct mentions + group member expansions + special mentions)
 * This replaces the need for separate processing of user vs group mentions
 */
export async function extractAllUsersForNotification(
  content: string,
  workspaceId: string, // Optional workspace context for group lookups
  channelId?: string, // Optional channel context for @channel and @here
  forceChannelMention?: boolean
): Promise<ExtractedMentionForNotification[]> {
  const allUsersToNotify: ExtractedMentionForNotification[] = [];
  const processedUserIds = new Set<string>(); // Prevent duplicate notifications

  // Get both direct user mentions and group mentions
  const [userMentions, groupMentions] = await Promise.all([
    extractMentionsFromContent(content),
    extractGroupMentionsFromContent(content, workspaceId)
  ]);

  // Add directly mentioned users
  for (const userMention of userMentions) {
    if (!processedUserIds.has(userMention.userId)) {
      processedUserIds.add(userMention.userId);
      allUsersToNotify.push({
        userId: userMention.userId,
        username: userMention.username,
        userEmail: userMention.userEmail,
        userPicture: userMention.userPicture,
        mentionSource: 'direct'
      });
    }
  }

  // Expand group mentions to individual users
  for (const groupMention of groupMentions) {
    try {
      logger.info(`🏷️ [MENTION-EXPANSION] Expanding group @${groupMention.groupName} (${groupMention.groupId}) to individual users`);

      // Get all group members
      const groupMembers = await getGroupMembersForNotification(groupMention.groupId);

      logger.info(`🏷️ [MENTION-EXPANSION] Found ${groupMembers.length} members in group ${groupMention.groupName}`);

      // Add each group member (avoid duplicates)
      for (const member of groupMembers) {
        if (!processedUserIds.has(member.userId)) {
          processedUserIds.add(member.userId);
          allUsersToNotify.push({
            userId: member.userId,
            username: member.name,
            userEmail: member.email,
            userPicture: undefined, // Group member data doesn't include picture
            mentionSource: 'group',
            groupId: groupMention.groupId,
            groupName: groupMention.groupName
          });
        }
      }
    } catch (error) {
      logger.error(`❌ [MENTION-EXPANSION] Error expanding group @${groupMention.groupName}:`, error);
      // Continue with other groups if one fails
    }
  }

  // Handle special mentions (@channel and @here) if channelId is provided
  if (channelId) {
    const specialMentions = extractSpecialMentions(content);

    logger.info('🏷️ [SPECIAL-MENTION-DEBUG] extractSpecialMentions result', {
      hasChannel: specialMentions.hasChannel,
      hasHere: specialMentions.hasHere,
      contentSnippet: content.slice(0, 200),
      hasAtChannel: content.includes('@channel'),
      hasBroadcastToken: content.includes('<broadcast:channel>'),
    });

    if (specialMentions.hasChannel || forceChannelMention) {
      logger.info(
        `🏷️ [SPECIAL-MENTION] Expanding @channel for channel ${channelId}` +
          (forceChannelMention && !specialMentions.hasChannel ? ' (forced by message type)' : ''),
      );
      const channelUsers = await getChannelParticipantsForMention(channelId);

      channelUsers.forEach(user => {
        if (!processedUserIds.has(user.userId)) {
          processedUserIds.add(user.userId);
          allUsersToNotify.push(user);
        }
      });

      logger.info(`🏷️ [SPECIAL-MENTION] Added ${channelUsers.length} users from @channel (${channelUsers.filter(u => !processedUserIds.has(u.userId)).length} new)`);
    }

    if (specialMentions.hasHere) {
      logger.info(`🏷️ [SPECIAL-MENTION] Expanding @here for channel ${channelId}`);
      const onlineUsers = await getOnlineChannelParticipants(channelId);

      onlineUsers.forEach(user => {
        if (!processedUserIds.has(user.userId)) {
          processedUserIds.add(user.userId);
          allUsersToNotify.push(user);
        }
      });

      logger.info(`🏷️ [SPECIAL-MENTION] Added ${onlineUsers.length} online users from @here (${onlineUsers.filter(u => !processedUserIds.has(u.userId)).length} new)`);
    }
  }

  const directCount = allUsersToNotify.filter(u => u.mentionSource === 'direct').length;
  const groupCount = allUsersToNotify.filter(u => u.mentionSource === 'group').length;
  const channelCount = allUsersToNotify.filter(u => u.mentionSource === 'channel').length;
  const hereCount = allUsersToNotify.filter(u => u.mentionSource === 'here').length;

  logger.info(`🏷️ [MENTION-EXPANSION] Total users to notify: ${allUsersToNotify.length} (${directCount} direct + ${groupCount} from groups + ${channelCount} from @channel + ${hereCount} from @here)`);

  return allUsersToNotify;
}

/**
 * Check if message content contains any group mentions
 */
export function hasGroupMentions(content: string): boolean {
  // Check for HTML span group mentions - handle attributes in any order
  const spanGroupMentionRegex = /<span[^>]*class="[^"]*chat-input-group-mention[^"]*"[^>]*>/;
  if (spanGroupMentionRegex.test(content)) {
    return true;
  }

  // Check for zero-width space group mentions
  const ZWSP = '\u200B';
  const groupMentionRegex = new RegExp(`${ZWSP}@(group:|[a-z0-9-]+)([^${ZWSP}]*)${ZWSP}`, 'gi');
  return groupMentionRegex.test(content);
}

/**
 * Check if message content contains any mentions (user or group)
 */
export function hasAnyMentions(content: string): boolean {
  return hasMentions(content) || hasGroupMentions(content);
}

/**
 * NEW: Simplified check for any mentions - more efficient than extracting
 * Includes user mentions, group mentions, and special mentions (@channel/@here)
 */
export function hasAnyMentionsToNotify(content: string): boolean {
  return hasAnyMentions(content) || hasSpecialMentions(content);
}


/**
 * Get all group members for notification purposes
 */
export async function getGroupMembersForNotification(groupId: string): Promise<{ userId: string; name: string; email: string }[]> {
  try {
    const userGroupRepository = new UserGroupRepository();

    // Get group with users (both direct FK and memberships)
    const groupWithUsers = await userGroupRepository.findWithMappings(groupId);

    if (!groupWithUsers) {
      logger.warn(`⚠️ [GROUP-NOTIFICATION] Group ${groupId} not found`);
      return [];
    }

    // Block notifications for deactivated groups
    if (!groupWithUsers.isActive) {
      logger.info(`🔕 [GROUP-NOTIFICATION] Group ${groupId} is deactivated, blocking notifications`);
      return [];
    }

    const allUsers: { userId: string; name: string; email: string }[] = [];

    // Add users from userGroupMappings
    if (groupWithUsers.userGroupMappings) {
      const membershipUsers = groupWithUsers.userGroupMappings
        .filter((membership) => membership.user && membership.user.status === 'ACTIVE')
        .map((membership) => ({
          userId: membership.user!.id,
          name: membership.user!.name,
          email: membership.user!.email
        }));
      allUsers.push(...membershipUsers);
    }

    // Remove duplicates (in case a user is in both relationships)
    const uniqueUsers = allUsers.filter((user, index, self) =>
      index === self.findIndex(u => u.userId === user.userId)
    );

    logger.info(`🏷️ [GROUP-MEMBERS] Found ${uniqueUsers.length} unique active members in group ${groupId}`);
    return uniqueUsers;

  } catch (error) {
    logger.error(`❌ [GROUP-NOTIFICATION] Error getting group members for ${groupId}:`, error);
    return [];
  }
}

/**
 * Detect special mentions (@channel, @here) in message content
 */
export function extractSpecialMentions(content: string): SpecialMentions {
  const result: SpecialMentions = {
    hasChannel: false,
    hasHere: false
  };

  // Check for @channel - HTML span format
  const channelSpanRegex = /<span[^>]*class="[^"]*chat-input-special-mention[^"]*"[^>]*data-mention-type="channel"[^>]*>@channel<\/span>/i;
  if (channelSpanRegex.test(content)) {
    result.hasChannel = true;
    logger.info('✅ [SPECIAL-MENTION] Found @channel mention (HTML span)');
  }

  // Check for @here - HTML span format
  const hereSpanRegex = /<span[^>]*class="[^"]*chat-input-special-mention[^"]*"[^>]*data-mention-type="here"[^>]*>@here<\/span>/i;
  if (hereSpanRegex.test(content)) {
    result.hasHere = true;
    logger.info('✅ [SPECIAL-MENTION] Found @here mention (HTML span)');
  }

  const contentWithoutCode = content
    .replace(/<pre[^>]*>[\s\S]*?<\/pre>/gi, '')
    .replace(/<code[^>]*>[\s\S]*?<\/code>/gi, '');
  // Fallback: Check for plain text @channel or @here (case-insensitive)
  // Match @channel or @here as whole words (not part of other words)
  const plainChannelRegex = /@channel\b/i;
  const plainHereRegex = /@here\b/i;

  // Also match the mrkdwn broadcast token format used in FlowJSON text components:
  // Slack's <!channel>/<!here> are normalised to <broadcast:channel>/<broadcast:here>
  // by the BlockKit→FlowJSON converter, so we need to detect that form too.
  const broadcastChannelRegex = /<broadcast:channel>/i;
  const broadcastHereRegex = /<broadcast:here>/i;

  if (!result.hasChannel && (plainChannelRegex.test(contentWithoutCode) || broadcastChannelRegex.test(contentWithoutCode))) {
    result.hasChannel = true;
    logger.info('✅ [SPECIAL-MENTION] Found @channel mention (plain text or broadcast token)');
  }

  if (!result.hasHere && (plainHereRegex.test(contentWithoutCode) || broadcastHereRegex.test(contentWithoutCode))) {
    result.hasHere = true;
    logger.info('✅ [SPECIAL-MENTION] Found @here mention (plain text or broadcast token)');
  }

  return result;
}

/**
 * Check if message content contains special mentions
 */
export function hasSpecialMentions(content: string): boolean {
  const mentions = extractSpecialMentions(content);
  return mentions.hasChannel || mentions.hasHere;
}

/**
 * Get all channel participants for @channel mention
 */
export async function getChannelParticipantsForMention(
  channelId: string
): Promise<ExtractedMentionForNotification[]> {
  try {
    logger.info(`🏷️ [@CHANNEL] Getting all participants for channel ${channelId}`);

    // 1. Get all channel participants from DB
    const channelParticipantRepo = new ChannelParticipantRepository();
    const participants = await channelParticipantRepo.findMany({ channelId });

    logger.info(`🏷️ [@CHANNEL] Found ${participants.length} participants in channel`);

    if (participants.length === 0) {
      return [];
    }

    // 2. Get user details in a single bulk query (avoids N+1 problem)
    const userIds = participants.map(p => p.userId);
    const userRepository = new UserRepository();
    const users = await userRepository.findMany({
      where: {
        id: { in: userIds },
        status: 'ACTIVE' // Only fetch active users
      }
    });

    // 3. Convert to ExtractedMentionForNotification format
    const mentionUsers = users.map(user => ({
      userId: user.id,
      username: user.name,
      userEmail: user.email,
      userPicture: user.picture || undefined,
      mentionSource: 'channel' as const
    }));

    logger.info(`🏷️ [@CHANNEL] Prepared ${mentionUsers.length} active users for @channel mention`);
    return mentionUsers;

  } catch (error) {
    logger.error(`❌ [@CHANNEL] Error getting channel participants for ${channelId}:`, error);
    return [];
  }
}

/**
 * Get online channel participants for @here mention
 */
export async function getOnlineChannelParticipants(
  channelId: string
): Promise<ExtractedMentionForNotification[]> {
  try {
    logger.info(`🏷️ [@HERE] Getting online participants for channel ${channelId}`);

    // 1. Get all channel participants
    const allParticipants = await getChannelParticipantsForMention(channelId);

    // 2. Filter by online status using Redis
    const onlineChecks = await Promise.all(
      allParticipants.map(async (user) => {
        const connections = await redisService.getUserConnections(user.userId);
        const isOnline = connections.length > 0;
        return { user, isOnline };
      })
    );

    // 3. Return only online users with updated mentionSource
    const onlineUsers = onlineChecks
      .filter(check => check.isOnline)
      .map(check => ({
        ...check.user,
        mentionSource: 'here' as const
      }));

    logger.info(`🏷️ [@HERE] Found ${onlineUsers.length} online users out of ${allParticipants.length} total participants`);
    return onlineUsers;

  } catch (error) {
    logger.error(`❌ [@HERE] Error getting online participants for ${channelId}:`, error);
    return [];
  }
}
