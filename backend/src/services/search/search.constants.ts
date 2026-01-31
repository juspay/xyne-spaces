/**
 * Centralized search configuration constants
 *
 * This file contains all tunable parameters for the search functionality.
 * Modify these values to adjust search behavior without changing code.
 */

export const SEARCH_CONFIG = {
  // Query validation limits
  limits: {
    /**
     * Maximum number of results to fetch from database per entity type
     * This limits the candidate pool before permission filtering and pagination
     */
    searchCutoff: 50,

    /**
     * Minimum length of search query (characters)
     */
    minQueryLength: 2,

    /**
     * Maximum length of search query (characters)
     */
    maxQueryLength: 500,

    /**
     * Default number of results per page
     */
    defaultPageSize: 20,

    /**
     * Maximum number of results per page allowed
     */
    maxPageSize: 100,
  },

  // Ranking weights for each entity type
  // Keys match SearchableEntityType: 'users' | 'messages' | 'channels' | 'tickets' | 'attachments'
  ranking: {
    /**
     * User ranking weights
     * Users only use trigram similarity (no FTS)
     */
    users: {
      similarityWeight: 1.0,
      // Field-specific weights for user similarity calculation in SQL
      fields: {
        nameWeight: 0.7,
        emailWeight: 0.3,
      },
    },

    /**
     * Message ranking weights
     * - similarityWeight: Trigram similarity (fuzzy matching)
     * - ftsWeight: Full-text search ranking (exact word matching)
     */
    messages: {
      similarityWeight: 0.7,
      ftsWeight: 0.3,
    },

    /**
     * Channel ranking weights
     * Channels only use trigram similarity (no FTS)
     */
    channels: {
      similarityWeight: 1.0,
    },

    /**
     * Ticket ranking weights
     * Tickets use multiple field similarities (title, description, humanReadableId)
     * - similarityWeight: Combined trigram similarity across fields
     * - ftsWeight: Full-text search ranking
     */
    tickets: {
      similarityWeight: 1.0,  // Base similarity already combines multiple fields
      ftsWeight: 0.2,
      // Field-specific weights for ticket similarity calculation in SQL
      fields: {
        titleWeight: 0.4,
        descriptionWeight: 0.3,
        humanReadableIdWeight: 0.1,
        ftsWeight: 0.2,
      },
    },

    /**
     * Attachment ranking weights
     * - similarityWeight: Primarily filename matching
     * - ftsWeight: Full-text search on filename
     */
    attachments: {
      similarityWeight: 0.8,
      ftsWeight: 0.2,
      // Field-specific weights for attachment similarity calculation in SQL
      fields: {
        fileNameWeight: 0.7,
        mimeTypeWeight: 0.1,
        ftsWeight: 0.2,
      },
    },
  },

  // Recency boost configuration
  recency: {
    /**
     * Boost for items less than 1 day old
     */
    oneDay: 0.1,

    /**
     * Boost for items less than 1 week old
     */
    oneWeek: 0.05,

    /**
     * Boost for items less than 1 month old
     */
    oneMonth: 0.02,
  },

  // Search behavior flags
  behavior: {
    /**
     * Whether to apply recency boost to search results
     */
    enableRecencyBoost: true,

    /**
     * Whether to filter results by user permissions
     */
    enablePermissionFiltering: true,

    /**
     * Default search type when not specified
     * - 'trigram': Fuzzy matching only
     * - 'fts': Full-text search only
     * - 'both': Combine both methods (recommended)
     */
    defaultSearchType: 'both' as 'trigram' | 'fts' | 'both',
  },

  // Similarity thresholds
  thresholds: {
    /**
     * Minimum similarity score to consider a match (0.0 - 1.0)
     * Used in WHERE clauses to filter out poor matches
     */
    minSimilarity: 0.1,
    // Tuned down from 0.3 to 0.15 to include more results for user-related queries, even if they are partial matches.
    userMinSimilarity: 0.15,
  },

  // Full-text search configuration
  fts: {
    /**
     * PostgreSQL ts_rank_cd normalization code
     * Controls how FTS scores are normalized to prevent document length bias
     * 
     * Available options:
     * - 0: No normalization (default PostgreSQL behavior)
     * - 1: Divide by (1 + log of document length) - RECOMMENDED
     * - 2: Divide by document length
     * - 4: Divide by harmonic mean of matches
     * - Combine flags: e.g., 1|2|4 = 7 for all normalizations
     * 
     * Normalization code 1 is recommended as it provides good balance
     * between relevance and document length normalization.
     */
    normalizationCode: 1,

    /**
     * Language configuration for FTS
     * Used in to_tsvector() and plainto_tsquery() functions
     */
    language: 'english' as const,
  },
};
