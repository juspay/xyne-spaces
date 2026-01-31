/**
 * Unified search query builder using UNION ALL approach
 * 
 * This file contains all entity-specific query building logic.
 * Each entity type has its own builder class to keep related code organized.
 * 
 * Benefits:
 * - Single database query instead of 5 separate queries
 * - Database-level pagination (correct LIMIT/OFFSET on combined results)
 * - Accurate total count using COUNT(*) OVER()
 * - Proper relevance scoring across all entity types
 * - Extensible for future filters and entity types
 * SCORING HELPER METHODS:
 * - buildSimilarityScore(): Trigram similarity for fuzzy matching
 * - buildFtsScore(): Full-text search with normalization
 * - combineScores(): Additive blending of score components
 */

import { GlobalSearchFilters, SearchableEntityType } from './types';
import { SEARCH_CONFIG } from './search.constants';
import { ChannelScopeType } from '@prisma/client';

export interface QueryResult {
  sql: string;
  params: any[];
  totalCount: boolean; // Whether COUNT(*) OVER() is included
}

/**
 * Structured return type for authorization fragment builders
 * Allows composing SQL fragments with proper parameter management
 */
interface QueryFragment {
  joins: string[];        // SQL JOIN clauses to add to the query
  whereClauses: string[]; // SQL WHERE conditions to add to the query
  params: any[];          // Parameter values to add to params array
  nextParamIndex: number; // Next available parameter index ($N)
}

// ===================================================================
// MAIN QUERY BUILDER
// ===================================================================

export class SearchQueryBuilder {
  private builders: Map<SearchableEntityType, BaseEntityBuilder>;
  
  constructor() {
    this.builders = new Map([
      ['users', new UserQueryBuilder()],
      ['messages', new MessageQueryBuilder()],
      ['channels', new ChannelQueryBuilder()],
      ['tickets', new TicketQueryBuilder()],
      ['attachments', new AttachmentQueryBuilder()],
    ]);
  }
  
  /**
   * Build unified search query with UNION ALL and database-level pagination
   * 
   * Returns a SQL query that:
   * 1. Creates CTEs for each entity type with standardized columns
   * 2. Combines them with UNION ALL
   * 3. Adds COUNT(*) OVER() for accurate total count
   * 4. Applies ORDER BY on relevance_score
   * 5. Applies LIMIT and OFFSET for pagination
   * 
   * @param filters - Search filters including query, entityTypes, pagination, etc.
   * @param userId - Current user ID for authorization checks
   * @returns QueryResult with SQL string and parameters array
   */
  buildUnifiedQuery(
    filters: GlobalSearchFilters,
    userId: string
  ): QueryResult {
    const entityTypes = filters.entityTypes || [
      'users', 'messages', 'channels', 'tickets', 'attachments'
    ];
    
    const cteQueries: string[] = []; 
    const params: any[] = [];
    let paramIndex = 0;
    const processedEntityTypes: SearchableEntityType[] = [];
    
    // Build CTE for each entity type
    for (const entityType of entityTypes) {
      const builder = this.builders.get(entityType);
      if (!builder) continue;
      
      const result = builder.buildCTE(filters, userId, paramIndex);
      cteQueries.push(result.cte);
      params.push(...result.params);
      paramIndex = result.nextParamIndex;
      processedEntityTypes.push(entityType);
    }
    
    if (cteQueries.length === 0) {
      throw new Error('No entity types selected for search');
    }
    
    // Build final query with UNION ALL and pagination
    const limit = filters.limit || SEARCH_CONFIG.limits.defaultPageSize;
    const offset = ((filters.page || 1) - 1) * limit;
    
    // Add pagination params
    paramIndex++;
    const limitParamIndex = paramIndex;
    params.push(limit);
    
    paramIndex++;
    const offsetParamIndex = paramIndex;
    params.push(offset);
    
    // Build UNION ALL of all CTEs
    const unionParts = processedEntityTypes.map(
      entityType => `SELECT * FROM entity_${entityType}`
    );
    
    const sql = `
      WITH ${cteQueries.join(',\n')},
      all_results AS (
        ${unionParts.join('\n        UNION ALL\n        ')}
      )
      SELECT
        *,
        COUNT(*) OVER()::numeric as total_count
      FROM all_results
      ORDER BY relevance_score DESC, created_at DESC
      LIMIT $${limitParamIndex} OFFSET $${offsetParamIndex}
    `;
    
    return { sql, params, totalCount: true };
  }
}

// ===================================================================
// BASE ENTITY BUILDER (shared interface)
// ===================================================================

interface CTEResult {
  cte: string;
  params: any[];
  nextParamIndex: number;
}

abstract class BaseEntityBuilder {
  /**
   * Build a CTE (Common Table Expression) for this entity type
   * 
   * Each CTE must return these standardized columns:
   * - id: text (entity primary key)
   * - entity_type: text (users, messages, channels, tickets, attachments)
   * - title: text (main display text)
   * - subtitle: text (secondary display text)
   * - content: text (searchable content)
   * - context_json: text (JSON string with entity-specific context)
   * - avatar: text (optional avatar URL)
   * - relevance_score: numeric (0-1, calculated from similarity/fts)
   * - created_at: timestamp (for sorting)
   * 
   * @param filters - Search filters
   * @param userId - Current user ID for authorization
   * @param startParamIndex - Starting parameter index ($N)
   * @returns CTE string, parameters, and next param index
   */
  abstract buildCTE(
    filters: GlobalSearchFilters,
    userId: string,
    startParamIndex: number
  ): CTEResult;
  
  /**
   * Build WHERE clause with common filters (date range)
   * Can be extended with entity-specific clauses
   * 
   * @param filters - Search filters
   * @param paramIndex - Current parameter index
   * @param entitySpecificClauses - Additional WHERE clauses for this entity
   * @returns WHERE clause string, parameters, and next param index
   */
  protected buildWhereClause(
    filters: GlobalSearchFilters,
    paramIndex: number,
    entitySpecificClauses: string[] = []
  ): { clause: string; params: any[]; nextParamIndex: number } {
    const clauses = [...entitySpecificClauses];
    const params: any[] = [];
    let currentIndex = paramIndex;
    
    // Date range filter
    if (filters.dateRange?.from) {
      currentIndex++;
      clauses.push(`created_at >= $${currentIndex}`);
      params.push(new Date(filters.dateRange.from));
    }
    if (filters.dateRange?.to) {
      currentIndex++;
      clauses.push(`created_at <= $${currentIndex}`);
      params.push(new Date(filters.dateRange.to));
    }
    
    return {
      clause: clauses.length > 0 ? `AND ${clauses.join(' AND ')}` : '',
      params,
      nextParamIndex: currentIndex
    };
  }

  /**
   * EXTENSIBLE SCORING HELPER METHODS
   * 
   * These methods provide reusable building blocks for creating relevance scores.
   * Use these helpers to maintain consistency and make scoring logic easy to modify.
   * 
   * To add new scoring methods:
   * 1. Create a new protected method following the same pattern
   * 2. Return a SQL expression string with proper COALESCE handling
   * 3. Use the method in entity builders via combineScores()
   * 
   * Example:
   *   const scoreComponents = [
   *     this.buildSimilarityScore('column', '$1', 0.7),
   *     this.buildFtsScore('search_vector', '$1', 0.3),
   *   ];
   *   const relevanceScore = this.combineScores(scoreComponents);
   */

  /**
   * Build a trigram similarity score component
   * 
   * Uses PostgreSQL's SIMILARITY() function for fuzzy text matching.
   * Returns a normalized score in range [0, 1].
   * 
   * @param column - Column or expression to match against (e.g., 't.title')
   * @param queryParam - Parameter placeholder for query string (e.g., '$1')
   * @param weight - Weight multiplier for this component (0.0 - 1.0)
   * @returns SQL expression for weighted similarity score
   * 
   * @example
   * // Single field similarity
   * buildSimilarityScore('u.name', '$1', 0.8)
   * // Returns: (COALESCE(SIMILARITY(u.name, $1), 0) * 0.8)
   */
  protected buildSimilarityScore(
    column: string,
    queryParam: string,
    weight: number
  ): string {
    return `(COALESCE(SIMILARITY(${column}, ${queryParam}), 0) * ${weight})`;
  }

  /**
   * Build a full-text search score component with normalization
   * 
   * Uses PostgreSQL's ts_rank_cd() for full-text search ranking.
   * Applies normalization to prevent document length bias.
   * 
   * @param searchVector - tsvector column or expression (e.g., 'ms."searchVector"')
   * @param queryParam - Parameter placeholder for query string (e.g., '$1')
   * @param weight - Weight multiplier for this component (0.0 - 1.0)
   * @param normalizationCode - PostgreSQL normalization code (default: from SEARCH_CONFIG)
   *   0 = no normalization
   *   1 = divide by (1 + log of document length) - RECOMMENDED
   *   2 = divide by document length
   *   4 = divide by harmonic mean of matches
   * @returns SQL expression for weighted FTS score
   * 
   * @example
   * // Basic FTS with default normalization
   * buildFtsScore('ms."searchVector"', '$1', 0.3)
   * 
   * // FTS with custom normalization
   * buildFtsScore('ms."searchVector"', '$1', 0.3, 2)
   * 
   * // FTS on generated tsvector
   * buildFtsScore(
   *   "to_tsvector('english', COALESCE(t.title, '') || ' ' || COALESCE(t.description, ''))",
   *   '$1',
   *   0.2
   * )
   */
  protected buildFtsScore(
    searchVector: string,
    queryParam: string,
    weight: number,
    normalizationCode: number = SEARCH_CONFIG.fts.normalizationCode
  ): string {
    const language = SEARCH_CONFIG.fts.language;
    return `(COALESCE(ts_rank_cd(${searchVector}, plainto_tsquery('${language}', ${queryParam}), ${normalizationCode}), 0) * ${weight})`;
  }

  /**
   * Combine multiple score components using additive blending
   * 
   * Joins score expressions with addition operator so all components
   * contribute to the final score. This is superior to GREATEST()
   * because it doesn't discard information from lower-scoring methods.
   * 
   * @param scores - Array of SQL score expressions (from helper methods)
   * @returns Combined SQL expression suitable for SELECT clause
   * 
   * @example
   * const scoreComponents = [
   *   this.buildSimilarityScore('t.title', '$1', 0.4),
   *   this.buildSimilarityScore('t.description', '$1', 0.3),
   *   this.buildFtsScore('t.search_vector', '$1', 0.3),
   * ];
   * const relevanceScore = this.combineScores(scoreComponents);
   * // Returns: "(COALESCE(...) * 0.4) +\n          (COALESCE(...) * 0.3) +\n          (COALESCE(...) * 0.3)"
   */
  protected combineScores(scores: string[]): string {
    return scores.join(' +\n          ');
  }

  /**
   * Build channel authorization fragment for channel-based entities
   * 
   * Centralizes the common pattern of validating user access to channels
   * through the channel_participants table. Returns structured SQL fragments
   * that can be composed into entity-specific queries.
   * 
   * This follows the same pattern as scoring helpers (buildSimilarityScore, etc.)
   * by providing reusable building blocks for query construction.
   * 
   * @param userId - User ID to check access for
   * @param startParamIndex - Current parameter index in the query
   * @param options - Configuration for authorization strategy
   * @param options.strategy - How to validate channel access:
   *   - 'STRICT': User MUST be a channel participant (INNER JOIN)
   *                Used by: Messages, Tickets, Attachments
   *   - 'PUBLIC_OR_MEMBER': Channel is PUBLIC or user is a member (LEFT JOIN + WHERE)
   *                         Used by: Default Channels
   *   - 'EXISTS_CHECK': User membership via EXISTS subquery (no JOIN)
   *                     Used by: Group DM Channels
   * @param options.channelAlias - Table alias for channels table (default: 'c')
   * @param options.participantAlias - Table alias for channel_participants (default: 'cp')
   * @returns QueryFragment with SQL parts, params, and next index
   * 
   * @example
   * // Messages, Tickets, Attachments (STRICT)
   * const authFragment = this.buildChannelAuthorizationFragment(userId, paramIndex, {
   *   strategy: 'STRICT'
   * });
   * params.push(...authFragment.params);
   * paramIndex = authFragment.nextParamIndex;
   * // Then in SQL: ${authFragment.joins[0]}
   * 
   * @example
   * // Default Channels (PUBLIC_OR_MEMBER)
   * const authFragment = this.buildChannelAuthorizationFragment(userId, paramIndex, {
   *   strategy: 'PUBLIC_OR_MEMBER'
   * });
   * params.push(...authFragment.params);
   * paramIndex = authFragment.nextParamIndex;
   * // Then in SQL: ${authFragment.joins[0]} ... AND ${authFragment.whereClauses[0]}
   */
  protected buildChannelAuthorizationFragment(
    userId: string,
    startParamIndex: number,
    options: {
      strategy: 'STRICT' | 'PUBLIC_OR_MEMBER' | 'EXISTS_CHECK';
      channelAlias?: string;
      participantAlias?: string;
    }
  ): QueryFragment {
    const channelAlias = options.channelAlias || 'c';
    const participantAlias = options.participantAlias || 'cp';
    const params: any[] = [];
    let paramIndex = startParamIndex;
    
    // Add userId as a parameter
    paramIndex++;
    params.push(userId);
    const userIdParam = paramIndex;
    
    // Build different authorization patterns based on strategy
    switch (options.strategy) {
      case 'STRICT':
        // User MUST be a channel participant (INNER JOIN)
        // Used by: Messages, Tickets, Attachments
        return {
          joins: [
            `INNER JOIN channel_participants ${participantAlias} ON ${channelAlias}.id = ${participantAlias}."channelId" AND ${participantAlias}."userId" = $${userIdParam}`
          ],
          whereClauses: [],
          params,
          nextParamIndex: paramIndex
        };
        
      case 'PUBLIC_OR_MEMBER':
        // Channel must be PUBLIC or user must be a member (LEFT JOIN + WHERE)
        // Used by: Default Channels
        return {
          joins: [
            `LEFT JOIN channel_participants ${participantAlias} ON ${channelAlias}.id = ${participantAlias}."channelId" AND ${participantAlias}."userId" = $${userIdParam}`
          ],
          whereClauses: [
            `(${channelAlias}.visibility = 'PUBLIC' OR ${participantAlias}."userId" IS NOT NULL)`
          ],
          params,
          nextParamIndex: paramIndex
        };
        
      case 'EXISTS_CHECK':
        // User membership via EXISTS subquery (no JOIN)
        // Used by: Group DM Channels
        return {
          joins: [],
          whereClauses: [
            `EXISTS (
            SELECT 1 FROM channel_participants ${participantAlias}2 
            WHERE ${participantAlias}2."channelId" = ${channelAlias}.id 
              AND ${participantAlias}2."userId" = $${userIdParam}
          )`
          ],
          params,
          nextParamIndex: paramIndex
        };
        
      default:
        throw new Error(`Unknown authorization strategy: ${options.strategy}`);
    }
  }
}

// ===================================================================
// ENTITY-SPECIFIC BUILDERS
// ===================================================================

class UserQueryBuilder extends BaseEntityBuilder {
  buildCTE(
    filters: GlobalSearchFilters,
    _userId: string,
    startParamIndex: number
  ): CTEResult {
    const params: any[] = [];
    let paramIndex = startParamIndex;
    
    // Add query parameter
    paramIndex++;
    params.push(filters.query);
    const queryParamIndex = paramIndex;
    
    // Add minSimilarity
    paramIndex++;
    params.push(SEARCH_CONFIG.thresholds.userMinSimilarity);
    const minSimilarityIndex = paramIndex;
    
    // Build WHERE clause with filters
    const whereResult = this.buildWhereClause(
      filters,
      paramIndex
    );
    params.push(...whereResult.params);
    paramIndex = whereResult.nextParamIndex;
    
    const nameWeight = SEARCH_CONFIG.ranking.users.fields.nameWeight;
    const emailWeight = SEARCH_CONFIG.ranking.users.fields.emailWeight;
    
    // Build relevance score using extensible helpers
    const scoreComponents = [
      this.buildSimilarityScore('u.name', `$${queryParamIndex}`, nameWeight),
      this.buildSimilarityScore('u.email', `$${queryParamIndex}`, emailWeight),
    ];
    const relevanceScore = this.combineScores(scoreComponents);
    
    const cte = `
      entity_users AS (
        SELECT
          u.id::text as id,
          'users'::text as entity_type,
          u.name as title,
          u.email as subtitle,
          u.name as content,
          NULL::text as context_json,
          u.picture as avatar,
          ${relevanceScore} as relevance_score,
          u."createdAt" as created_at
        FROM users u
        WHERE (
          SIMILARITY(u.name, $${queryParamIndex}) > $${minSimilarityIndex}
          OR SIMILARITY(u.email, $${queryParamIndex}) > $${minSimilarityIndex}
        )
        ${whereResult.clause}
      )
    `;
    
    return { cte, params, nextParamIndex: paramIndex };
  }
}

class MessageQueryBuilder extends BaseEntityBuilder {
  buildCTE(
    filters: GlobalSearchFilters,
    userId: string,
    startParamIndex: number
  ): CTEResult {
    const params: any[] = [];
    let paramIndex = startParamIndex;
    
    // Base parameters
    paramIndex++;
    params.push(filters.query);
    const queryParam = paramIndex;
    
    paramIndex++;
    params.push(SEARCH_CONFIG.thresholds.minSimilarity);
    const minSimilarity = paramIndex;
    
    // Build channel authorization fragment
    const authFragment = this.buildChannelAuthorizationFragment(
      userId,
      paramIndex,
      { strategy: 'STRICT' }
    );
    params.push(...authFragment.params);
    paramIndex = authFragment.nextParamIndex;
    
    // Message-specific filters
    const entityClauses: string[] = [];
    
    if (filters.channelIds && filters.channelIds.length > 0) {
      const placeholders = filters.channelIds.map(() => {
        paramIndex++;
        return `$${paramIndex}`;
      }).join(', ');
      params.push(...filters.channelIds);
      entityClauses.push(`conv."channelId" IN (${placeholders})`)
    }
    
    if (filters.userIds && filters.userIds.length > 0) {
      const placeholders = filters.userIds.map(() => {
        paramIndex++;
        return `$${paramIndex}`;
      }).join(', ');
      params.push(...filters.userIds);
      entityClauses.push(`m."senderId" IN (${placeholders})`);
    }
    
    const whereResult = this.buildWhereClause(filters, paramIndex, entityClauses);
    params.push(...whereResult.params);
    paramIndex = whereResult.nextParamIndex;
    
    const similarityWeight = SEARCH_CONFIG.ranking.messages.similarityWeight;
    const ftsWeight = SEARCH_CONFIG.ranking.messages.ftsWeight;
    
    // Build relevance score using extensible helpers
    const scoreComponents = [
      this.buildSimilarityScore('ms."plaintextContent"', `$${queryParam}`, similarityWeight),
      this.buildFtsScore('ms."searchVector"', `$${queryParam}`, ftsWeight),
    ];
    const relevanceScore = this.combineScores(scoreComponents);
    
    const cte = `
      entity_messages AS (
        SELECT
          m."messageId"::text as id,
          'messages'::text as entity_type,
          'Message in #' || c.name as title,
          'By ' || COALESCE(u.name, 'Unknown') as subtitle,
          m.content,
          jsonb_build_object(
            'channelId', c.id,
            'channelTitle', c.name,
            'scopeType', c."scopeType",
            'conversationId', m."conversationId",
            'messageId', m."messageId",
            'senderId', m."senderId",
            'senderName', COALESCE(u.name, 'Unknown'),
            'replyCount', conv."replyCount"
          )::text as context_json,
          NULL::text as avatar,
          ${relevanceScore} as relevance_score,
          m."createdAt" as created_at
        FROM message_search ms
        INNER JOIN messages m ON ms."messageId" = m."messageId"
        INNER JOIN conversations conv ON m."conversationId" = conv."conversationId"
        INNER JOIN channels c ON conv."channelId" = c.id
        ${authFragment.joins[0]}
        LEFT JOIN users u ON m."senderId" = u.id
        WHERE (
          SIMILARITY(ms."plaintextContent", $${queryParam}) > $${minSimilarity}
          OR ts_rank_cd(ms."searchVector", plainto_tsquery('english', $${queryParam})) > 0
        )
        ${whereResult.clause}
      )
    `;
    
    return { cte, params, nextParamIndex: paramIndex };
  }
}

class ChannelQueryBuilder extends BaseEntityBuilder {
  buildCTE(
    filters: GlobalSearchFilters,
    userId: string,
    startParamIndex: number
  ): CTEResult {
    const params: any[] = [];
    let paramIndex = startParamIndex;
    
    // Build queries for different channel types
    const queryParts: string[] = [];
    
    // 1. DEFAULT channels query
    const defaultChannelResult = this.buildDefaultChannelQuery(
      filters,
      userId,
      paramIndex
    );
    queryParts.push(defaultChannelResult.query);
    params.push(...defaultChannelResult.params);
    paramIndex = defaultChannelResult.nextParamIndex;
    
    // 2. GROUP_DM channels query
    const groupDmResult = this.buildGroupDmChannelQuery(
      filters,
      userId,
      paramIndex
    );
    queryParts.push(groupDmResult.query);
    params.push(...groupDmResult.params);
    paramIndex = groupDmResult.nextParamIndex;
    
    // Combine with UNION
    const cte = `
      entity_channels AS (
        ${queryParts.join('\n        UNION\n        ')}
      )
    `;
    
    return { cte, params, nextParamIndex: paramIndex };
  }
  
  /**
   * Build query for DEFAULT channels (searchable by channel name)
   */
  private buildDefaultChannelQuery(
    filters: GlobalSearchFilters,
    userId: string,
    startParamIndex: number
  ): { query: string; params: any[]; nextParamIndex: number } {
    const params: any[] = [];
    let paramIndex = startParamIndex;
    
    paramIndex++;
    params.push(filters.query);
    const queryParam = paramIndex;
    
    paramIndex++;
    params.push(SEARCH_CONFIG.thresholds.minSimilarity);
    const minSimilarity = paramIndex;
    
    paramIndex++;
    params.push(ChannelScopeType.DM);
    const excludedDmType = paramIndex;
    
    paramIndex++;
    params.push(ChannelScopeType.GROUP_DM);
    const excludedGroupDmType = paramIndex;
    
    paramIndex++;
    params.push(userId);
    const userIdParam = paramIndex;
    
    const whereResult = this.buildWhereClause(filters, paramIndex);
    params.push(...whereResult.params);
    paramIndex = whereResult.nextParamIndex;
    
    const query = `
        SELECT
          c.id::text as id,
          'channels'::text as entity_type,
          c.name as title,
          COALESCE(participant_counts.count, 0)::text || ' members • ' || c.visibility as subtitle,
          COALESCE(c.description, c.name) as content,
          jsonb_build_object(
            'channelId', c.id,
            'scopeType', c."scopeType"
          )::text as context_json,
          NULL::text as avatar,
          SIMILARITY(c.name, $${queryParam}) as relevance_score,
          c."createdAt" as created_at
        FROM channels c
        LEFT JOIN (
          SELECT
            "channelId",
            COUNT(*) as count
          FROM channel_participants
          GROUP BY "channelId"
        ) participant_counts ON c.id = participant_counts."channelId"
        LEFT JOIN channel_participants cp ON c.id = cp."channelId" AND cp."userId" = $${userIdParam}
        WHERE SIMILARITY(c.name, $${queryParam}) > $${minSimilarity}
          AND c."scopeType"::text != $${excludedDmType}
          AND c."scopeType"::text != $${excludedGroupDmType}
          AND (c.visibility = 'PUBLIC' OR cp."userId" IS NOT NULL)
        ${whereResult.clause}`;
    
    return { query, params, nextParamIndex: paramIndex };
  }
  
  /**
   * Build query for GROUP_DM channels (searchable by participant names)
   */
  private buildGroupDmChannelQuery(
    filters: GlobalSearchFilters,
    userId: string,
    startParamIndex: number
  ): { query: string; params: any[]; nextParamIndex: number } {
    const params: any[] = [];
    let paramIndex = startParamIndex;
    
    paramIndex++;
    params.push(filters.query);
    const queryParam = paramIndex;
    
    paramIndex++;
    params.push(SEARCH_CONFIG.thresholds.minSimilarity);
    const minSimilarity = paramIndex;
    
    paramIndex++;
    params.push(ChannelScopeType.GROUP_DM);
    const groupDmType = paramIndex;
    
    paramIndex++;
    params.push(userId);
    const userIdParam = paramIndex;
    
    const whereResult = this.buildWhereClause(filters, paramIndex);
    params.push(...whereResult.params);
    paramIndex = whereResult.nextParamIndex;
    
    const query = `
        SELECT DISTINCT
          c.id::text as id,
          'channels'::text as entity_type,
          c.name as title,
          COALESCE(participant_counts.count, 0)::text || ' members' as subtitle,
          c.name as content,
          jsonb_build_object(
            'channelId', c.id,
            'scopeType', c."scopeType"
          )::text as context_json,
          NULL::text as avatar,
          MAX(SIMILARITY(u.name, $${queryParam})) as relevance_score,
          c."createdAt" as created_at
        FROM channels c
        INNER JOIN channel_participants cp ON c.id = cp."channelId"
        INNER JOIN users u ON cp."userId" = u.id
        LEFT JOIN (
          SELECT
            "channelId",
            COUNT(*) as count
          FROM channel_participants
          GROUP BY "channelId"
        ) participant_counts ON c.id = participant_counts."channelId"
        WHERE c."scopeType"::text = $${groupDmType}
          AND cp."userId" != $${userIdParam}
          AND SIMILARITY(u.name, $${queryParam}) > $${minSimilarity}
          AND EXISTS (
            SELECT 1 FROM channel_participants cp2 
            WHERE cp2."channelId" = c.id AND cp2."userId" = $${userIdParam}
          )
        ${whereResult.clause}
        GROUP BY c.id, c.name, c."scopeType", c."createdAt", participant_counts.count`;
    
    return { query, params, nextParamIndex: paramIndex };
  }
}

class TicketQueryBuilder extends BaseEntityBuilder {
  buildCTE(
    filters: GlobalSearchFilters,
    userId: string,
    startParamIndex: number
  ): CTEResult {
    const params: any[] = [];
    let paramIndex = startParamIndex;
    
    paramIndex++;
    params.push(filters.query);
    const queryParam = paramIndex;
    
    paramIndex++;
    params.push(SEARCH_CONFIG.thresholds.minSimilarity);
    const minSimilarity = paramIndex;
    
    // Build channel authorization fragment
    const authFragment = this.buildChannelAuthorizationFragment(
      userId,
      paramIndex,
      { strategy: 'STRICT' }
    );
    params.push(...authFragment.params);
    paramIndex = authFragment.nextParamIndex;
    
    // Tickets must have conversationId
    const entityClauses = ['t."conversationId" IS NOT NULL'];
    const userIds = filters.userIds || [];
    if (userIds.length > 0) {
      const placeholders = userIds.map(() => {
        paramIndex++;
        return `$${paramIndex}`;
      }).join(', ');
      params.push(...userIds);
      entityClauses.push(`t."createdBy" IN (${placeholders})`);
    }
    
    const whereResult = this.buildWhereClause(filters, paramIndex, entityClauses);
    params.push(...whereResult.params);
    paramIndex = whereResult.nextParamIndex;
    
    const titleWeight = SEARCH_CONFIG.ranking.tickets.fields.titleWeight;
    const descWeight = SEARCH_CONFIG.ranking.tickets.fields.descriptionWeight;
    const idWeight = SEARCH_CONFIG.ranking.tickets.fields.humanReadableIdWeight;
    const ftsWeight = SEARCH_CONFIG.ranking.tickets.fields.ftsWeight;
    
    // Build relevance score using extensible helpers
    const scoreComponents = [
      this.buildSimilarityScore('t.title', `$${queryParam}`, titleWeight),
      this.buildSimilarityScore('t.description', `$${queryParam}`, descWeight),
      this.buildSimilarityScore('t."xyneId"', `$${queryParam}`, idWeight),
      this.buildFtsScore(
        "to_tsvector('english', COALESCE(t.title, '') || ' ' || COALESCE(t.description, ''))",
        `$${queryParam}`,
        ftsWeight
      ),
    ];
    const relevanceScore = this.combineScores(scoreComponents);
    
    const cte = `
      entity_tickets AS (
        SELECT
          t.id::text as id,
          'tickets'::text as entity_type,
          t."xyneId" || ': ' || t.title as title,
          t.status || ' • ' || t."stageName" ||
            COALESCE(' • Assigned to ' || assigned_user.name, '') ||
            COALESCE(' • Created by ' || created_user.name, '') as subtitle,
          COALESCE(t.title || ' ' || t.description, t.title) as content,
          jsonb_build_object(
            'ticketId', t.id,
            'conversationId', t."conversationId",
            'ticketStatus', t.status,
            'channelId', conv."channelId"
          )::text as context_json,
          NULL::text as avatar,
          ${relevanceScore} as relevance_score,
          t."createdAt" as created_at
        FROM tickets t
        LEFT JOIN conversations conv ON t."conversationId" = conv."conversationId"
        LEFT JOIN channels c ON conv."channelId" = c.id
        ${authFragment.joins[0]}
        LEFT JOIN users assigned_user ON t."assignedTo" = assigned_user.id
        LEFT JOIN users created_user ON t."createdBy" = created_user.id
        WHERE (
          SIMILARITY(t.title, $${queryParam}) > $${minSimilarity}
          OR SIMILARITY(t.description, $${queryParam}) > $${minSimilarity}
          OR SIMILARITY(t."xyneId", $${queryParam}) > $${minSimilarity}
          OR ts_rank_cd(
            to_tsvector('english', COALESCE(t.title, '') || ' ' || COALESCE(t.description, '')),
            plainto_tsquery('english', $${queryParam})
          ) > 0
        )
        ${whereResult.clause}
      )
    `;
    
    return { cte, params, nextParamIndex: paramIndex };
  }
}

class AttachmentQueryBuilder extends BaseEntityBuilder {
  buildCTE(
    filters: GlobalSearchFilters,
    userId: string,
    startParamIndex: number
  ): CTEResult {
    const params: any[] = [];
    let paramIndex = startParamIndex;
    
    paramIndex++;
    params.push(filters.query);
    const queryParam = paramIndex;
    
    paramIndex++;
    params.push(SEARCH_CONFIG.thresholds.minSimilarity);
    const minSimilarity = paramIndex;
    
    // Build channel authorization fragment
    const authFragment = this.buildChannelAuthorizationFragment(
      userId,
      paramIndex,
      { strategy: 'STRICT' }
    );
    params.push(...authFragment.params);
    paramIndex = authFragment.nextParamIndex;
    
    // Attachment-specific filters
    const entityClauses: string[] = [];
    
   const channelIds = filters.channelIds || [];
    if (channelIds.length > 0) {
      const placeholders = channelIds.map(() => {
        paramIndex++;
        return `$${paramIndex}`;
      }).join(', ');
      params.push(...channelIds);
      entityClauses.push(`conv."channelId" IN (${placeholders})`);
    }
    
   
    const userIds = filters.userIds || [];
    if (userIds.length > 0) {
      const placeholders = userIds.map(() => {
        paramIndex++;
        return `$${paramIndex}`;
      }).join(', ');
      params.push(...userIds);
      entityClauses.push(`ma."uploadedByUserId" IN (${placeholders})`);
    }
    
    const whereResult = this.buildWhereClause(filters, paramIndex, entityClauses);
    params.push(...whereResult.params);
    paramIndex = whereResult.nextParamIndex;
    
    const fileNameWeight = SEARCH_CONFIG.ranking.attachments.fields.fileNameWeight;
    const mimeTypeWeight = SEARCH_CONFIG.ranking.attachments.fields.mimeTypeWeight;
    const ftsWeight = SEARCH_CONFIG.ranking.attachments.fields.ftsWeight;
    
    // Build relevance score using extensible helpers
    const scoreComponents = [
      this.buildSimilarityScore('ma."originalFilename"', `$${queryParam}`, fileNameWeight),
      this.buildSimilarityScore('ma.mimetype', `$${queryParam}`, mimeTypeWeight),
      this.buildFtsScore(
        "to_tsvector('english', ma.\"originalFilename\")",
        `$${queryParam}`,
        ftsWeight
      ),
    ];
    const relevanceScore = this.combineScores(scoreComponents);
    
    const cte = `
      entity_attachments AS (
        SELECT
          ma.id::text as id,
          'attachments'::text as entity_type,
          ma."originalFilename" as title,
          ma.mimetype || ' • ' || ROUND(ma.size / 1024) || ' KB • #' || c.name ||
            COALESCE(' • Uploaded by ' || u.name, '') as subtitle,
          ma."originalFilename" as content,
          jsonb_build_object(
            'attachmentId', ma.id,
            'messageId', ma."entityId",
            'conversationId', ma."conversationId",
            'channelId', c.id,
            'channelTitle', c.name,
            'fileName', ma."originalFilename",
            'mimeType', ma.mimetype
          )::text as context_json,
          NULL::text as avatar,
          ${relevanceScore} as relevance_score,
          ma."createdAt" as created_at
        FROM message_attachments ma
        INNER JOIN conversations conv ON ma."conversationId" = conv."conversationId"
        INNER JOIN channels c ON conv."channelId" = c.id
        ${authFragment.joins[0]}
        LEFT JOIN users u ON ma."uploadedByUserId" = u.id
        WHERE (
          SIMILARITY(ma."originalFilename", $${queryParam}) > $${minSimilarity}
          OR SIMILARITY(ma.mimetype, $${queryParam}) > $${minSimilarity}
          OR ts_rank_cd(
            to_tsvector('english', ma."originalFilename"),
            plainto_tsquery('english', $${queryParam})
          ) > 0
        )
        ${whereResult.clause}
      )
    `;
    
    return { cte, params, nextParamIndex: paramIndex };
  }
}
