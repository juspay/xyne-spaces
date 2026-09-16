import { BulkTicketMode } from '@xyne/shared';

/**
 * Types for bulk ticket creation.
 *
 * A user can, from a single request, create many tickets at once — either as a
 * flat list of independent tickets ("all-parents") or as a set of sub-tickets
 * hung under one parent ("parent-sub"). The heavy work is done off-request by a
 * Bull worker; this module holds the shared shapes for the request payload, the
 * enqueued job, and the per-item ticket description.
 */

export { BulkTicketMode };

/**
 * One ticket to create. `channelId`/`projectId`/`boardId` are carried per-item
 * so a batch can (in principle) span boards — every item is therefore
 * access-checked individually before it is created.
 */
export interface BulkTicketCreationInput {
  title: string;
  description?: string;
  channelId: string;
  projectId: string;
  boardId: string;
  assignedTo?: string;
  userGroupId?: string;
  priority?: string;
  statusV2?: string;
  eta?: Date;
  tags?: string[];
  ticketType?: string;
  stageName?: string;
  dynamicFields?: Record<string, string>;
  merchantId?: string;
  clientRowId?: string;
  createdBy: string;
  updatedBy: string;
}

/** Payload processed by the bulk-ticket worker. */
export interface BulkTicketCreationJobData {
  mode: BulkTicketMode;
  /** Authenticated human user id — never taken from the request body. */
  userId: string;
  /** Workspace of the authenticated user — the ceiling for per-item access. */
  parentWorkspaceId: string;
  /** Set for parent-sub mode when the parent already exists. */
  parentTicketId: string | null;
  /**
   * Parent to create before the batch, when parent-sub mode is starting a new
   * one. It is created by the worker rather than at enqueue time so that a
   * failed enqueue leaves nothing behind for the user to duplicate.
   */
  parent?: BulkTicketCreationInput;
  /** Tickets to create asynchronously. */
  subTickets: BulkTicketCreationInput[];
  /** Optional source message, the most specific failure-nudge anchor. */
  sourceMessageId?: string;
  /** Conversation the batch was started from; a fallback nudge anchor. */
  sourceConversationId?: string;
  /** Batch came from the tickets tab, which decides chat posting per channel. */
  fromTicketsTab?: boolean;
  /** Source type for nudge persistence. */
  sourceType?: string;
  /** Channel context. */
  channelId?: string;
  /** Project context. */
  projectId?: string;
}

/**
 * Backend → dashboard response for a successfully enqueued batch. The endpoint
 * answers 202 before any ticket exists, so per-ticket outcomes belong to the
 * worker, not to this response.
 */
export interface CreateBulkTicketResponse {
  /** Echoed back only when the caller supplied `existingParentTicketId`. */
  parentTicketId?: string;
  enqueuedSubTickets: number;
}
