/**
 * Search Resource
 *
 * Full-text and filtered search across the workspace: messages, tickets, files,
 * channels, calls, and users.
 *
 * Results are grouped by default. Pass `groupBy: ''` when you want one flat
 * ranked list. Unknown query parameters are rejected rather than ignored, so a
 * filter that is not documented here will fail the request.
 */

import { Resource } from './base.js';
import { searchOperations } from '../registry/search.js';
import type { SearchOptions, SearchResponse, SearchSchemaName } from '../types/index.js';

export class SearchResource extends Resource {
  /**
   * Search across messages, tickets, files, channels, calls, and users.
   *
   * @param options - What to search for and how to narrow it.
   * @param options.q - Free text. Omit it to search by filters alone.
   * @param options.type - Restrict to result types. Plural, e.g. `'messages'`.
   * @param options.apps - Restrict to apps: `chat`, `ticket`, `user`, `file`.
   * @param options.limit - Maximum results to return.
   * @param options.offset - Where to start, for paging.
   * @param options.orderBy - `'newest'`, `'oldest'`, or relevance by default.
   * @param options.groupBy - Pass `''` for one flat ranked list instead of buckets.
   * @param options.in - Restrict to these channels.
   * @param options.from - Restrict to messages sent by these users.
   * @returns Grouped results by default; a flat `results` array when `groupBy` is `''`.
   *
   * @example
   * const results = await sdk.search.query({ q: 'project update' });
   *
   * @example
   * // One flat ranked list of the newest matching messages
   * const messages = await sdk.search.query({
   *   q: 'deployment',
   *   type: 'messages',
   *   orderBy: 'newest',
   *   groupBy: '',
   *   limit: 20,
   * });
   *
   * @example
   * // Narrow to a channel
   * const inChannel = await sdk.search.query({
   *   q: 'bug',
   *   in: 'channel-123',
   *   type: ['messages', 'tickets'],
   * });
   */
  query(options: SearchOptions = {}): Promise<SearchResponse> {
    return this.call(searchOperations.query, options);
  }

  /**
   * Get the raw field schema for one search index.
   *
   * Use it to discover which fields an index supports before building a
   * field-specific query.
   *
   * @param schema - Index to describe, e.g. `'chat_message'` or `'ticket'`.
   * @returns The index definition as text, in Vespa's schema format.
   * @example
   * const definition = await sdk.search.getSchema('chat_message');
   */
  getSchema(schema: SearchSchemaName): Promise<string> {
    return this.call(searchOperations.getSchema, { schema });
  }
}
