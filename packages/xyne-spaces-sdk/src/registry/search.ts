/**
 * Search Operation Registry
 *
 * Maps SDK search methods to backend operations.
 * Search uses direct API endpoints (not Zero queries) since it delegates to Vespa.
 */

import { api } from './types.js';
import type { SearchResponse, SearchOptions } from '../types/index.js';

/** The contract takes comma-separated lists for multi-value filters. */
function csv(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value.join(',') : value;
}

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
    // Every key here must exist in the server's searchQuerySchema: unknown query
    // parameters are rejected, not ignored. `undefined` values are dropped by the
    // HTTP layer, so listing them all is safe.
    mapArgs: (args) => ({
      q: args.q,
      type: csv(args.type),
      apps: csv(args.apps),
      subApp: args.subApp,

      limit: args.limit,
      offset: args.offset,
      orderBy: args.orderBy,
      groupBy: args.groupBy,

      from: csv(args.from),
      withUser: csv(args.withUser),
      fromEmail: csv(args.fromEmail),
      toEmail: csv(args.toEmail),
      // `channelId` is the deprecated alias; the server only knows `in`.
      in: csv(args.in) ?? args.channelId,
      mentions: csv(args.mentions),
      channelMentions: csv(args.channelMentions),

      projectId: csv(args.projectId),
      status: csv(args.status),
      ticketId: csv(args.ticketId),
      priority: args.priority,
      board: args.board,
      tags: args.tags,
      stage: args.stage,
      assignee: args.assignee,

      before: args.before,
      after: args.after,
      on: args.on,
      range: args.range,
      created: args.created,

      callStatus: args.callStatus,
      callType: args.callType,
      callStartsAt: args.callStartsAt,
      callEndsAt: args.callEndsAt,

      includeBotMessages: args.includeBotMessages,
      onlyMyChannels: args.onlyMyChannels,
    }),
  }),

  /**
   * Get search schema for building advanced queries.
   * Maps to: GET /api/v1/search/schema
   */
  getSchema: api<{ type: string }, unknown>('GET', '/api/v1/search/schema'),
} as const;
