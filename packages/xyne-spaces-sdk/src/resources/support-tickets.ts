/**
 * Support Tickets Resource
 *
 * The support-desk view of tickets: email-driven rows in a desk channel,
 * ordered by most recent email.
 *
 * Reads only. To change a support ticket — reassign, restage, archive — use
 * `sdk.tickets`, which operates on the same rows.
 */

import { Resource } from './base.js';
import {
  supportTicketsOperations,
  type SupportTicketCursor,
} from '../registry/support-tickets.js';
import type { Ticket, TicketPriority } from '../types/index.js';

export class SupportTicketsResource extends Resource {
  /**
   * List a page of desk tickets in a channel, most recent email first.
   *
   * @param channelId - The desk channel to read.
   * @param options - Paging window and filters.
   * @param options.limit - Page size.
   * @param options.start - Cursor from the previous page.
   * @param options.dir - Page forward or backward from the cursor.
   * @param options.assignedTo - Restrict to these assignee ids.
   * @param options.priority - Restrict to these priorities.
   * @param options.stageName - Restrict to these stages.
   * @param options.isMember - ACL hint; leave unset unless you know otherwise.
   * @returns One page of desk tickets.
   * @example
   * const tickets = await sdk.supportTickets.list('channel-desk', { limit: 25 });
   */
  list(
    channelId: string,
    options?: {
      limit?: number;
      start?: SupportTicketCursor;
      dir?: 'forward' | 'backward';
      assignedTo?: string[];
      priority?: TicketPriority[];
      stageName?: string[];
      isMember?: boolean;
    }
  ): Promise<Ticket[]> {
    return this.call(supportTicketsOperations.list, { channelId, ...options });
  }

  /**
   * List desk tickets matching the full filter set.
   *
   * Unpaginated — intended for the filtered sidebar views rather than for
   * walking a large inbox.
   *
   * @param channelId - The desk channel to read.
   * @param filters - Every filter the desk view supports; all optional.
   * @param filters.merchantMid - Restrict to one merchant.
   * @param filters.assignedTo - Restrict to these assignee ids.
   * @param filters.priority - Restrict to these priorities.
   * @param filters.stageName - Restrict to these stages.
   * @param filters.aiCategory - Restrict to these AI-assigned categories.
   * @param filters.hasAiDraft - Only tickets with, or without, a drafted reply.
   * @param filters.userGroups - Restrict to tickets owned by these groups.
   * @param filters.lastEmailAtStart - Earliest last-email time, epoch milliseconds.
   * @param filters.lastEmailAtEnd - Latest last-email time, epoch milliseconds.
   * @param filters.formEntityValueFieldIds - Custom fields to resolve on each row.
   * @param filters.isMember - ACL hint; leave unset unless you know otherwise.
   * @returns Every matching desk ticket.
   * @example
   * const urgent = await sdk.supportTickets.listFiltered('channel-desk', {
   *   priority: ['HIGH'],
   * });
   */
  listFiltered(
    channelId: string,
    filters?: {
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
      isMember?: boolean;
    }
  ): Promise<Ticket[]> {
    return this.call(supportTicketsOperations.listFiltered, { channelId, ...filters });
  }

  /**
   * Get one desk ticket row.
   *
   * @param id - Ticket id.
   * @param channelId - The desk channel it belongs to.
   * @param options.isMember - ACL hint; leave unset unless you know otherwise.
   * @returns The ticket, or `null` if it is not in that channel.
   * @example
   * const ticket = await sdk.supportTickets.get('ticket-1', 'channel-desk');
   */
  get(id: string, channelId: string, options?: { isMember?: boolean }): Promise<Ticket | null> {
    return this.call(supportTicketsOperations.get, { id, channelId, ...options });
  }

  /**
   * Get a desk ticket by its human-readable key.
   *
   * @param xyneId - Ticket key, e.g. `SETL-0002`.
   * @param workspaceId - Workspace the key belongs to, from `sdk.users.me()`.
   * @param channelId - The desk channel it belongs to.
   * @param options.isMember - ACL hint; leave unset unless you know otherwise.
   * @returns The ticket, or `null` if the key is unknown there.
   * @example
   * const me = await sdk.users.me();
   * const ticket = await sdk.supportTickets.getByKey('SETL-0002', me.workspaceId, 'channel-desk');
   */
  getByKey(
    xyneId: string,
    workspaceId: string,
    channelId: string,
    options?: { isMember?: boolean }
  ): Promise<Ticket | null> {
    return this.call(supportTicketsOperations.getByKey, {
      xyneId,
      workspaceId,
      channelId,
      ...options,
    });
  }

  /**
   * Get a desk ticket's full detail, by id or by key.
   *
   * Pass exactly one of `id` or `xyneId`.
   *
   * @param options - Which ticket to read, and where it lives.
   * @param options.workspaceId - Workspace, from `sdk.users.me()`.
   * @param options.channelId - The desk channel it belongs to.
   * @param options.id - Ticket id. Omit if passing `xyneId`.
   * @param options.xyneId - Ticket key. Omit if passing `id`.
   * @param options.isMember - ACL hint; leave unset unless you know otherwise.
   * @returns The ticket with its detail relations, or `null`.
   * @example
   * const me = await sdk.users.me();
   * const detail = await sdk.supportTickets.getDetail({
   *   workspaceId: me.workspaceId,
   *   channelId: 'channel-desk',
   *   xyneId: 'SETL-0002',
   * });
   */
  getDetail(options: {
    workspaceId: string;
    channelId: string;
    id?: string;
    xyneId?: string;
    isMember?: boolean;
  }): Promise<Ticket | null> {
    return this.call(supportTicketsOperations.getDetail, options);
  }

  /**
   * List desk tickets across every email channel the caller can see.
   *
   * @param options - Optional narrowing.
   * @param options.channelId - Restrict to one channel.
   * @param options.merchantMid - Restrict to one merchant.
   * @returns Matching desk tickets across those channels.
   * @example
   * const all = await sdk.supportTickets.listForEmailChannels();
   */
  listForEmailChannels(options?: {
    channelId?: string;
    merchantMid?: string;
  }): Promise<Ticket[]> {
    return this.call(supportTicketsOperations.listForEmailChannels, options);
  }
}
