/**
 * Bulk ticket creation types shared between the backend and dashboard.
 *
 * A single request can create many tickets at once — either as independent
 * top-level tickets or as sub-tickets under one parent. The heavy lifting runs
 * off-request in a background worker; these shapes are used by the API and by
 * the dashboard UI that calls it.
 */

export enum BulkTicketMode {
  /** Every item becomes a sub-ticket of a single parent ticket. */
  PARENT_SUB = 'parent-sub',
  /** Every item becomes an independent (top-level) ticket. */
  ALL_PARENTS = 'all-parents',
}

/**
 * One ticket to create in a bulk batch. `channelId`/`projectId`/`boardId` are
 * carried per-item so that every row can be access-checked individually.
 */
export interface BulkTicketItemInput {
  title: string;
  description?: string;
  channelId?: string;
  projectId?: string;
  boardId?: string;
  assignedTo?: string;
  userGroupId?: string;
  priority?: string;
  statusV2?: string;
  eta?: string | Date;
  tags?: string[];
  ticketType?: string;
  stageName?: string;
  dynamicFields?: Record<string, string>;
  merchantId?: string;
  clientRowId?: string;
}

/** Dashboard → backend payload for POST /api/tickets/bulk-from-message. */
export interface CreateBulkTicketRequest {
  mode?: BulkTicketMode;
  /** Parent ticket details when mode is PARENT_SUB. */
  parent?: BulkTicketItemInput;
  /** Alias used by some UIs; treated the same as subTickets. */
  tickets?: BulkTicketItemInput[];
  /** Child tickets to create. */
  subTickets?: BulkTicketItemInput[];
  /** Re-use an existing ticket as the parent instead of creating one. */
  existingParentTicketId?: string;
  /** Optional source conversation for a completion summary. */
  sourceConversationId?: string;
  /** Optional source message for failure nudge tracking. */
  sourceMessageId?: string;
  /** Top-level fields for all-parents mode (from table draft rows). */
  projectId?: string;
  channelId?: string;
  boardId?: string;
}

/** Backend → dashboard response for a successfully enqueued batch. */
export interface CreateBulkTicketResponse {
  parentTicketId?: string;
  enqueuedSubTickets: number;
  failedSubTickets?: number;
  failedTitles?: string[];
}

/** Existing parent ticket reference (for retry flows). */
export interface ExistingParentTicket {
  id: string;
  xyneId?: string;
  conversationId: string;
}
