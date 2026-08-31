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
  /** Set for parent-sub mode: the parent every item is mapped under. */
  parentTicketId: string | null;
  /** Tickets to create asynchronously. */
  subTickets: BulkTicketCreationInput[];
  /** Optional source message, for failure nudge tracking. */
  sourceMessageId?: string;
  /** Source type for nudge persistence. */
  sourceType?: string;
  /** Channel context. */
  channelId?: string;
  /** Project context. */
  projectId?: string;
}

/** Failure record for partial batch failures. */
export interface BulkTicketCreationFailure {
  clientRowId: string;
  title: string;
  error?: string;
}

/** Backend → dashboard response for a successfully enqueued batch. */
export interface CreateBulkTicketResponse {
  parentTicketId?: string;
  enqueuedSubTickets: number;
  failedSubTickets?: number;
  failedTitles?: string[];
  failures?: BulkTicketCreationFailure[];
}
