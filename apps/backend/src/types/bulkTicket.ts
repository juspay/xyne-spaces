/**
 * Types for bulk ticket creation.
 *
 * A user can, from a single request, create many tickets at once — either as a
 * flat list of independent tickets ("all-parents") or as a set of sub-tickets
 * hung under one parent ("parent-sub"). The heavy work is done off-request by a
 * Bull worker; this module holds the shared shapes for the request payload, the
 * enqueued job, and the per-item ticket description.
 */

export enum BulkTicketMode {
  /** Every item becomes a sub-ticket of a single parent ticket. */
  PARENT_SUB = 'parent-sub',
  /** Every item becomes an independent (top-level) ticket. */
  ALL_PARENTS = 'all-parents',
}

/**
 * One ticket to create. `channelId`/`projectId`/`boardId` are carried per-item
 * so a batch can (in principle) span boards — every item is therefore
 * access-checked individually before it is created.
 */
export interface BulkTicketItemInput {
  title: string;
  description?: string;
  channelId: string;
  projectId: string;
  boardId: string;
  assignedTo?: string;
  priority?: string;
  statusV2?: string;
  /**
   * Stable client-supplied row id. Used as the idempotency key so a re-run of a
   * stalled/retried job does not create the same ticket twice.
   */
  clientRowId?: string;
}

/** Payload processed by the bulk-ticket worker. */
export interface BulkTicketCreationJobData {
  mode: BulkTicketMode;
  /** Authenticated human user id — never taken from the request body. */
  createdBy: string;
  /** Workspace of the authenticated user — the ceiling for per-item access. */
  workspaceId: string;
  /** Set for parent-sub mode: the parent every item is mapped under. */
  parentTicketId?: string;
  /** Tickets to create asynchronously. */
  items: BulkTicketItemInput[];
  /** Optional source thread, for a completion summary. */
  sourceConversationId?: string;
  /** Idempotency namespace for this batch. */
  jobKey: string;
}
