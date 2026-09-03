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

import { op } from './types.js';
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
   */
  list: op<{
      channelId: string;
      limit?: number;
      start?: SupportTicketCursor;
      dir?: 'forward' | 'backward';
      assignedTo?: string[];
      priority?: TicketPriority[];
      stageName?: string[];
      isMember?: boolean;
    }, Ticket[]>('supportTickets.list', 'query'),

  /**
   * Desk tickets matching the full filter set, unpaginated.
   *
   * Supports the filters the desk sidebar exposes, including AI categorisation
   * and whether a draft reply is waiting.
   */
  listFiltered: op<{
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
    }, Ticket[]>('supportTickets.listFiltered', 'query'),

  /**
   * One desk ticket row, with the relations the list view renders.
   */
  get: op<{ id: string; channelId: string; isMember?: boolean }, Ticket | null>('supportTickets.get', 'query'),

  /**
   * A desk ticket by its human-readable key.
   */
  getByKey: op<{ xyneId: string; workspaceId: string; channelId: string; isMember?: boolean }, Ticket | null>('supportTickets.getByKey', 'query'),

  /**
   * A desk ticket's full detail, by id or by key.
   *
   * V2 takes the same arguments but resolves fewer relations than V1 — it drops
   * the caller-scoped `emailDrafts` / `emailReads` and the `conversation`. Neither
   * was part of this method's declared `Ticket` result, so the typed surface is
   * unchanged; read email state through `sdk.email` instead.
   */
  getDetail: op<{
      workspaceId: string;
      channelId: string;
      id?: string;
      xyneId?: string;
      isMember?: boolean;
    }, Ticket | null>('supportTickets.getDetail', 'query'),

  /**
   * Desk tickets across the user's email channels.
   */
  listForEmailChannels: op<{ channelId?: string; merchantMid?: string } | undefined, Ticket[]>('supportTickets.listForEmailChannels', 'query'),
} as const;
