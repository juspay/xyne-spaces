/**
 * Search Operation Registry
 *
 * Maps SDK search methods to backend operations.
 * Search uses direct API endpoints (not Zero queries) since it delegates to Vespa.
 */

import { api } from './types.js';
import type { SearchResponse, SearchOptions } from '../types/index.js';

/**
 * Search operations registry.
 *
 * Search operations use direct API calls since they delegate to Vespa,
 * not Zero queries.
 */
export const searchOperations = {
  /**
   * Search across messages, tickets, files, channels, calls, and users.
   * Maps to: GET /api/v1/search
   */
  query: api<SearchOptions, SearchResponse>('GET', '/api/v1/search', {
    mapArgs: (args) => ({
      q: args.q,
      type: Array.isArray(args.type) ? args.type.join(',') : args.type,
      channelId: args.channelId,
      limit: args.limit,
      offset: args.offset,
      sortBy: args.sortBy,
      sortOrder: args.sortOrder,
    }),
  }),

  /**
   * Get search schema for building advanced queries.
   * Maps to: GET /api/v1/search/schema
   */
  getSchema: api<{ type: string }, unknown>('GET', '/api/v1/search/schema'),
} as const;
