import { BulkTicketMode } from '@xyne/shared';

/**
 * Types for bulk ticket creation.
 *
 * A user can, from a single request, create many tickets at once — either as a
 * flat list of independent tickets ("all-parents") or as a set of sub-tickets
 * hung under one parent ("parent-sub"). The batch is written set-based and
 * synchronously; this module holds the shared shapes for the request payload
 * and the response.
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
  ticketType?: string;
  stageName?: string;
  merchantId?: string;
  clientRowId?: string;
  createdBy: string;
  updatedBy: string;
}

export type { CreateBulkTicketResponse } from '@xyne/shared';
export { MAX_BULK_TICKETS } from '@xyne/shared';
