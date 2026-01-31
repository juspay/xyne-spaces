import { PrismaClient } from '@prisma/client';
import { DatabaseClient } from '@/database/client';
import { UnifiedSearchRow } from '../../services/search/types';
import {logger} from '@/utils/logger';

export class SearchRepository {
  private db: PrismaClient;

  constructor() {
    this.db = DatabaseClient.getInstance();
  }

  /**
   * Log errors with environment-appropriate detail level
   *
   * Development: Logs full context for debugging
   * Production: Logs minimal info to avoid log spam and protect privacy
   *
   * @private
   */
  private logError(method: string, error: unknown, context?: Record<string, unknown>): void {
    const isDevelopment = process.env.NODE_ENV === 'development';

    // Type guard: Check if error is an Error object with message and code properties
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorCode = typeof error === 'object' && error !== null && 'code' in error
      ? (error as { code: unknown }).code
      : undefined;

    logger.error(`[SearchRepository.${method}] Database error:`, {
      error: errorMessage,
      code: errorCode,
      timestamp: new Date().toISOString(),
      // Only include sensitive context in development
      ...(isDevelopment && context && { context })
    });
  }

  /**
   * Execute unified search query built by SearchQueryBuilder
   * 
   * This method ONLY executes the pre-built SQL query - it does not build queries.
   * Query building is done in the service layer (SearchQueryBuilder).
   * 
   * The query uses UNION ALL to combine results from all entity types into a
   * standardized structure, then applies sorting and pagination at the database level.
   * 
   * Benefits:
   * - Single database query instead of multiple queries
   * - Database-level sorting and pagination for efficiency
   * - Accurate total count using COUNT(*) OVER()
   * - Scales to millions of results
   * 
   * @param sql - Complete SQL query string with parameter placeholders ($1, $2, etc.)
   * @param params - Array of parameters corresponding to placeholders
   * @returns Array of UnifiedSearchRow with standardized structure
   */
  async executeUnifiedSearch(
    sql: string,
    params: any[]
  ): Promise<UnifiedSearchRow[]> {
    try {
      const results = await this.db.$queryRawUnsafe<UnifiedSearchRow[]>(sql, ...params);
      return results;
    } catch (error: unknown) {
      this.logError('executeUnifiedSearch', error, {
        paramCount: params.length,
        queryPreview: sql.substring(0, 200) + '...', // Log first 200 chars for debugging
      });
      throw error;
    }
  }

  /**
   * Fetch participant names for multiple channels
   * Used to transform DM and GROUP_DM channel names from comma-separated user IDs
   * to human-readable participant names (excluding the current user)
   * 
   * Returns a map of channelId -> array of participant names
   * 
   * @param channelIds - Array of channel IDs to fetch participants for
   * @param currentUserId - Current user ID to exclude from results
   * @returns Map of channelId to array of participant names
   */
  async getChannelParticipantNames(
    channelIds: string[],
    currentUserId: string
  ): Promise<Map<string, string[]>> {
    try {
      if (channelIds.length === 0) {
        return new Map();
      }

      // Use raw SQL since ChannelParticipant doesn't have a user relation in schema
      const participants = await this.db.$queryRaw<Array<{
        channelId: string;
        userName: string;
      }>>`
        SELECT 
          cp."channelId",
          u.name as "userName"
        FROM channel_participants cp
        INNER JOIN users u ON cp."userId" = u.id
        WHERE cp."channelId" = ANY(${channelIds})
          AND cp."userId" != ${currentUserId}
        ORDER BY cp."joinedAt" ASC
      `;

      // Group by channelId
      const participantMap = new Map<string, string[]>();
      
      for (const participant of participants) {
        const names = participantMap.get(participant.channelId) || [];
        names.push(participant.userName);
        participantMap.set(participant.channelId, names);
      }

      return participantMap;
    } catch (error: unknown) {
      this.logError('getChannelParticipantNames', error, {
        channelCount: channelIds.length,
        currentUserId
      });
      throw error;
    }
  }
}
