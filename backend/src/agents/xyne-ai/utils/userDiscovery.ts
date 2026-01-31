/**
 * Field Value Discovery Utility
 * 
 * Provides fuzzy matching for field values like usernames, sender IDs, etc.
 */

import { db } from '../../../database/client.js';
import { logger } from '../../../utils/logger.js';
import { calculateSimilarity } from './sequenceMatcher.js';

/**
 * User result with matching score
 */
export interface MatchedUser {
  id: string;
  name: string | null;
  email: string | null;
  matchScore: number;
  matchType: 'exact' | 'fuzzy' | 'partial';
}

/**
 * Discovery result with user(s) and action
 */
export interface UserDiscoveryResult {
  success: boolean;
  users?: MatchedUser[];
  error?: string;
  needsClarification?: boolean;
  clarificationMessage?: string;
}

/**
 * Get all users from one or more channels
 */
async function getChannelUsers(channelIds: string[]): Promise<Array<{ id: string; name: string | null; email: string | null }>> {
  if (channelIds.length === 0) {
    return [];
  }

  logger.info(`[FieldDiscovery] Getting users from ${channelIds.length} channel(s)`);

  // Get all participants from all channels
  const participants = await db.channelParticipant.findMany({
    where: { channelId: { in: channelIds } },
    select: { userId: true },
  });

  // Deduplicate user IDs
  const uniqueUserIds = [...new Set(participants.map((p: any) => p.userId))];
  
  if (uniqueUserIds.length === 0) {
    logger.info(`[FieldDiscovery] No participants found in channel(s)`);
    return [];
  }

  // Get user details for all unique participants
  const users = await db.user.findMany({
    where: { id: { in: uniqueUserIds } },
    select: { id: true, name: true, email: true },
  });

  logger.info(`[FieldDiscovery] Found ${users.length} unique users`);
  return users;
}

/**
 * Normalize user name for comparison
 */
function normalizeName(name: string | null): string {
  if (!name) return '';
  return name.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Discover user by username using fuzzy matching across multiple channels
 * 
 * @param query - The search query (username or part of name)
 * @param channelIds - The channel ID(s) to search within (string or array)
 * @param threshold - Minimum similarity threshold (0-1), default 0.6
 * @returns Discovery result with matched user(s)
 */
export async function discoverUserByName(
  query: string,
  channelIds: string | string[],
  threshold: number = 0.6
): Promise<UserDiscoveryResult> {
  try {
    // Input validation
    if (!query || typeof query !== 'string') {
      return { success: false, error: 'Invalid query parameter' };
    }

    // Sanitize and validate query length
    const trimmedQuery = query.trim();
    if (trimmedQuery.length < 2) {
      return { success: false, error: 'Query must be at least 2 characters' };
    }

    const channelIdArray = Array.isArray(channelIds) ? channelIds : [channelIds];
    
    logger.info(`[FieldDiscovery] Discovering user for query="${trimmedQuery}" in ${channelIdArray.length} channel(s): ${channelIdArray.join(', ')}`);

    const normalizedQuery = normalizeName(trimmedQuery);

    // Get users from all channels
    const channelUsers = await getChannelUsers(channelIdArray);
    
    // Pre-filter users: only consider users whose name or email contains the query
    // This significantly reduces the number of users we need to evaluate
    const relevantUsers = channelUsers.filter((user: { id: string; name: string | null; email: string | null }) => {
      const name = normalizeName(user.name);
      const email = normalizeName(user.email);
      
      if (!name && !email) return false;
      
      // Include if query is found in name or email (case-insensitive)
      if (normalizedQuery.length >= 2) {
        return name.includes(normalizedQuery) || email?.includes(normalizedQuery);
      }
      
      // For very short queries (1 char), include all users with names
      return !!name || !!email;
    });
    
    logger.info(`[FieldDiscovery] Pre-filtered to ${relevantUsers.length} relevant users from ${channelUsers.length} total participants`);
    
    const matchedUsers: MatchedUser[] = [];

    // Search within relevant channel users
    for (const user of relevantUsers) {
      const name = normalizeName(user.name);
      const email = normalizeName(user.email);
      
      // Skip users without name or email
      if (!name && !email) continue;

      let matchScore = 0;
      let matchType: 'exact' | 'fuzzy' | 'partial' = 'partial';

      // Exact match on name or email
      if (name === normalizedQuery || email === normalizedQuery) {
        matchScore = 1.0;
        matchType = 'exact';
      }
      // Check if name starts with query (e.g., "Aman" in "Aman Srivastava")
      else if ((name.startsWith(normalizedQuery) || email?.startsWith(normalizedQuery)) && normalizedQuery.length >= 2) {
        matchScore = 0.95;
        matchType = 'fuzzy';
      }
      // Check if query is contained in name (substring match)
      // Only allow if query is at least 3 chars to avoid matching "am" in "Raman"
      else if ((name.includes(normalizedQuery) || email?.includes(normalizedQuery)) && normalizedQuery.length >= 3) {
        matchScore = 0.7;
        matchType = 'fuzzy';
      }
      else {
        // Fuzzy matching using shared sequence matcher
        const nameSimilarity = calculateSimilarity(name, normalizedQuery);
        const emailSimilarity = email ? calculateSimilarity(email, normalizedQuery) : 0;
        
        matchScore = Math.max(nameSimilarity, emailSimilarity);
        
        if (matchScore >= threshold) {
          matchType = 'fuzzy';
        }
      }

      if (matchScore >= threshold) {
        matchedUsers.push({
          id: user.id,
          name: user.name,
          email: user.email,
          matchScore,
          matchType,
        });
        logger.info(`[FieldDiscovery] Matched user "${user.name}" with score ${matchScore.toFixed(2)}`);
      }
    }

    // If no matches in channel, search ALL users in database
    if (matchedUsers.length === 0) {
      logger.info(`[FieldDiscovery] No matches in channel, searching all users in database`);
      
      // Use sanitized trimmedQuery for database search
      const allUsers = await db.user.findMany({
        where: {
          OR: [
            { name: { contains: trimmedQuery, mode: 'insensitive' } },
            { email: { contains: trimmedQuery, mode: 'insensitive' } },
          ],
        },
        select: { id: true, name: true, email: true },
        take: 10,
      });

      logger.info(`[FieldDiscovery] Database search found ${allUsers.length} users`);

      for (const user of allUsers) {
        const name = normalizeName(user.name);
        const email = normalizeName(user.email);
        
        if (!name && !email) continue;

        let matchScore = 0;
        let matchType: 'exact' | 'fuzzy' | 'partial' = 'partial';

        if (name === normalizedQuery || email === normalizedQuery) {
          matchScore = 1.0;
          matchType = 'exact';
        }
        // Check if name starts with query
        else if ((name.startsWith(normalizedQuery) || email?.startsWith(normalizedQuery)) && normalizedQuery.length >= 2) {
          matchScore = 0.95;
          matchType = 'fuzzy';
        }
        // Check if query is contained in name (substring match)
        else if ((name.includes(normalizedQuery) || email?.includes(normalizedQuery)) && normalizedQuery.length >= 3) {
          matchScore = 0.7;
          matchType = 'fuzzy';
        }
        else {
          const nameSimilarity = calculateSimilarity(name, normalizedQuery);
          const emailSimilarity = email ? calculateSimilarity(email, normalizedQuery) : 0;
          matchScore = Math.max(nameSimilarity, emailSimilarity);
          
          if (matchScore >= threshold) {
            matchType = 'fuzzy';
          }
        }

        if (matchScore >= threshold) {
          matchedUsers.push({
            id: user.id,
            name: user.name,
            email: user.email,
            matchScore,
            matchType,
          });
        }
      }
    }

    // Sort by match score descending
    matchedUsers.sort((a, b) => b.matchScore - a.matchScore);

    logger.info(`[FieldDiscovery] Found ${matchedUsers.length} matches for query="${query}"`);

    if (matchedUsers.length === 0) {
      return {
        success: false,
        error: `No users found matching "${query}"`,
      };
    }

    // Check if matched users are in this channel (participants)
    const usersInChannel = matchedUsers.filter(u => {
      return channelUsers.some(cu => cu.id === u.id);
    });

    if (usersInChannel.length === 0 && matchedUsers.length > 0) {
      // Found users but none are in this channel
      const userNames = matchedUsers.slice(0, 3).map(u => u.name || u.email || 'Unknown').join(', ');
      return {
        success: false,
        error: `Found user(s) matching "${query}": ${userNames}, but they are not in this channel.`,
      };
    }

    // Filter to only users in this channel
    const finalMatches = usersInChannel.length > 0 ? usersInChannel : matchedUsers;

    // If multiple matches, always ask for clarification to ensure correct user selection
    if (finalMatches.length > 1) {
      const userList = finalMatches.slice(0, 5).map((u, i) => {
        const displayName = u.name || u.email || 'Unknown';
        const scoreDisplay = (u.matchScore * 100).toFixed(0);
        return `${i + 1}. ${displayName} (${scoreDisplay}% match)`;
      }).join('\n');

      return {
        success: true,
        users: finalMatches,
        needsClarification: true,
        clarificationMessage: `I found multiple users matching "${query}". Which one did you mean?\n${userList}`,
      };
    }

    // Return single best match
    return {
      success: true,
      users: [finalMatches[0]],
    };

  } catch (error) {
    logger.error('[FieldDiscovery] Error discovering user:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Discover multiple users by name patterns
 */
export async function discoverUsersByNames(
  queries: string[],
  channelId: string,
  threshold: number = 0.5
): Promise<Map<string, UserDiscoveryResult>> {
  const results = new Map<string, UserDiscoveryResult>();

  for (const query of queries) {
    const result = await discoverUserByName(query, channelId, threshold);
    results.set(query, result);
  }

  return results;
}