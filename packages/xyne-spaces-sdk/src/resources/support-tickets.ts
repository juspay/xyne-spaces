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
   * List a page of desk tickets in a channel.
   *
   * @param options.dir - Page forward or backward from the cursor
   *
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

  /** Get one desk ticket row. */
  get(id: string, channelId: string, options?: { isMember?: boolean }): Promise<Ticket | null> {
    return this.call(supportTicketsOperations.get, { id, channelId, ...options });
  }

  /** Get a desk ticket by its human-readable key. */
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

  /** List desk tickets across the user's email channels. */
  listForEmailChannels(options?: {
    channelId?: string;
    merchantMid?: string;
  }): Promise<Ticket[]> {
    return this.call(supportTicketsOperations.listForEmailChannels, options);
  }
}
