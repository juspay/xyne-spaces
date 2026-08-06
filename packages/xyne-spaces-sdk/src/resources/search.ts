/**
 * Search Resource
 *
 * Provides methods for searching across the workspace.
 * Search delegates to Vespa via direct API calls.
 */

import { Resource } from './base.js';
import { searchOperations } from '../registry/search.js';
import type { SearchResponse, SearchOptions } from '../types/index.js';

export class SearchResource extends Resource {
  /**
   * Search across messages, tickets, files, channels, calls, and users.
   *
   * @param options - Search options
   * @param options.q - Search query string
   * @param options.type - Filter by result type(s)
   * @param options.channelId - Filter to a specific channel
   * @param options.limit - Maximum results to return
   * @param options.offset - Offset for pagination
   * @param options.sortBy - Field to sort by
   * @param options.sortOrder - Sort order ('asc' or 'desc')
   * @returns Search results
   *
   * @example
   * // Simple text search
   * const results = await sdk.search.query({ q: 'project update' });
   *
   * @example
   * // Filter by type
   * const messages = await sdk.search.query({
   *   q: 'deployment',
   *   type: 'message',
   *   limit: 20
   * });
   *
   * @example
   * // Search within a channel
   * const channelResults = await sdk.search.query({
   *   q: 'bug',
   *   channelId: 'channel-123',
   *   type: ['message', 'ticket']
   * });
   */
  query(options: SearchOptions = {}): Promise<SearchResponse> {
    return this.call(searchOperations.query, options);
  }

  /**
   * Get the schema for a search index.
   * Useful for building advanced queries with field-specific filters.
   *
   * @param type - The index type to get schema for
   * @returns Schema definition for the index
   *
   * @example
   * const messageSchema = await sdk.search.getSchema('message');
   */
  getSchema(type: string): Promise<unknown> {
    return this.call(searchOperations.getSchema, { type });
  }
}
