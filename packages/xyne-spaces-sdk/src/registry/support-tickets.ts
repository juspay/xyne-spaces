/**
 * Support Tickets Operation Registry
 *
 * The support-desk view of tickets: rows that arrive over email into a desk
 * channel, ordered by last email rather than creation, and filtered by desk
 * concepts (assignee, priority, stage, AI category, draft state).
 *
 * These are the same underlying ticket rows as `registry/tickets.ts` — the
 * queries differ in ordering, filters, and which relations they resolve. Writes
 * go through the ticket operations.
 *
 * `isMember` is an ACL fast-path hint rather than a filter; see the note in
 * `registry/conversations.ts`.
 */

import { query } from './types.js';
import type { Ticket, TicketPriority } from '../types/index.js';

/** Page cursor for the desk list, which is ordered by last email. */
export interface SupportTicketCursor {
  id: string;
  lastEmailAt: number;
}

export const supportTicketsOperations = {
  /**
   * A page of desk tickets in a channel.
   *
   * Paging is bidirectional: `dir` walks forward or backward from the cursor.
   * Maps to: Zero query 'supportTicketsPageV4'
   */
  list: query<
    {
      channelId: string;
      limit?: number;
      start?: SupportTicketCursor;
      dir?: 'forward' | 'backward';
      assignedTo?: string[];
      priority?: TicketPriority[];
      stageName?: string[];
      isMember?: boolean;
    },
    Ticket[]
  >('supportTicketsPageV4', {
    mapArgs: (args) => ({
      channelId: args.channelId,
      isMember: args.isMember ?? true,
      limit: args.limit ?? 50,
      start: args.start ?? null,
      dir: args.dir ?? 'forward',
      ...(args.assignedTo ? { assignedTo: args.assignedTo } : {}),
      ...(args.priority ? { priority: args.priority } : {}),
      ...(args.stageName ? { stageName: args.stageName } : {}),
    }),
  }),

  /**
   * Desk tickets matching the full filter set, unpaginated.
   *
   * Supports the filters the desk sidebar exposes, including AI categorisation
   * and whether a draft reply is waiting.
   * Maps to: Zero query 'supportTicketsFilteredV3'
   */
  listFiltered: query<
    {
      channelId: string;
      isMember?: boolean;
      merchantMid?: string;
      assignedTo?: string[];
      priority?: TicketPriority[];
      stageName?: string[];
      aiCategory?: string[];
      hasAiDraft?: boolean;
      userGroups?: string[];
      lastEmailAtStart?: number;
      lastEmailAtEnd?: number;
      formEntityValueFieldIds?: string[];
    },
    Ticket[]
  >('supportTicketsFilteredV3', {
    mapArgs: (args) => ({
      ...args,
      isMember: args.isMember ?? true,
      // Required by the query even when empty.
      dynamicFieldFilters: [],
    }),
  }),

  /**
   * One desk ticket row, with the relations the list view renders.
   * Maps to: Zero query 'supportTicketRowV3'
   */
  get: query<{ id: string; channelId: string; isMember?: boolean }, Ticket | null>(
    'supportTicketRowV3',
    {
      mapArgs: (args) => ({
        id: args.id,
        channelId: args.channelId,
        isMember: args.isMember ?? true,
      }),
    }
  ),

  /**
   * A desk ticket by its human-readable key.
   * Maps to: Zero query 'supportTicketByXyneIdV4'
   */
  getByKey: query<
    { xyneId: string; workspaceId: string; channelId: string; isMember?: boolean },
    Ticket | null
  >('supportTicketByXyneIdV4', {
    mapArgs: (args) => ({
      xyneId: args.xyneId,
      workspaceId: args.workspaceId,
      channelId: args.channelId,
      isMember: args.isMember ?? true,
    }),
  }),

  /**
   * A desk ticket's full detail, by id or by key.
   * Maps to: Zero query 'supportTicketDetail'
   */
  getDetail: query<
    {
      workspaceId: string;
      channelId: string;
      id?: string;
      xyneId?: string;
      isMember?: boolean;
    },
    Ticket | null
  >('supportTicketDetail', {
    mapArgs: (args) => ({
      workspaceId: args.workspaceId,
      channelId: args.channelId,
      ...(args.id ? { id: args.id } : {}),
      ...(args.xyneId ? { xyneId: args.xyneId } : {}),
      isMember: args.isMember ?? true,
    }),
  }),

  /**
   * Desk tickets across the user's email channels.
   * Maps to: Zero query 'ticketsForEmailChannelsV2'
   */
  listForEmailChannels: query<
    { channelId?: string; merchantMid?: string } | undefined,
    Ticket[]
  >('ticketsForEmailChannelsV2', {
    mapArgs: (args) => ({ ...(args ?? {}) }),
  }),
} as const;
