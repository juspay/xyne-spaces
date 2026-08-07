/**
 * Tickets Operation Registry
 *
 * Work-tracking tickets and everything hanging off one: sub-tickets, tags,
 * references between tickets, stage-approval requests, and per-user mailbox
 * state. Support-desk tickets (the email surface) are a separate view of the
 * same table and live in `registry/support-tickets.ts`.
 */

import { query, mutator } from './types.js';
import { newId, now } from '../core/ids.js';
import type {
  StageRequestStatus,
  SubTicket,
  Ticket,
  TicketPriority,
  TicketStageRequest,
  TicketStatusV2,
} from '../types/index.js';

/** How a ticket list is scoped. Determines which of the id filters apply. */
export type TicketViewMode =
  | 'project'
  | 'board'
  | 'my-tickets'
  | 'user-tickets'
  | 'group-tickets';

/** Page cursor for the kanban listing. */
export interface TicketCursor {
  id: string;
  createdAt: number;
}

export const ticketsOperations = {
  // ----- Reads -----

  /**
   * Tickets for a view. `viewMode` selects the scope and decides which of
   * `projectId` / `boardId` / `userId` / `groupId` is used.
   * Maps to: Zero query 'ticketsQueryV2'
   */
  list: query<
    {
      viewMode: TicketViewMode;
      projectId?: string;
      boardId?: string;
      userId?: string;
      groupId?: string;
      formEntityValueFieldIds?: string[];
    },
    Ticket[]
  >('ticketsQueryV2'),

  /**
   * A page of tickets for the kanban board, with the board's filter set.
   * Maps to: Zero query 'kanbanTicketsPageV2'
   */
  listKanban: query<
    {
      limit?: number;
      start?: TicketCursor;
      searchQuery?: string;
      statusFilter?: string[];
      assignedToFilter?: string[];
      createdByFilter?: string[];
      workflowTypeFilter?: string[];
    },
    Ticket[]
  >('kanbanTicketsPageV2', {
    mapArgs: (args) => ({
      limit: args.limit ?? 50,
      start: args.start ?? null,
      ...(args.searchQuery ? { searchQuery: args.searchQuery } : {}),
      ...(args.statusFilter ? { statusFilter: args.statusFilter } : {}),
      ...(args.assignedToFilter ? { assignedToFilter: args.assignedToFilter } : {}),
      ...(args.createdByFilter ? { createdByFilter: args.createdByFilter } : {}),
      ...(args.workflowTypeFilter ? { workflowTypeFilter: args.workflowTypeFilter } : {}),
    }),
  }),

  /**
   * One ticket.
   * Maps to: Zero query 'ticketByIdV2'
   */
  get: query<{ ticketId: string }, Ticket | null>('ticketByIdV2'),

  /**
   * One ticket with its relations resolved for a detail view.
   * Maps to: Zero query 'ticketDetailsByIdV2'
   */
  getDetails: query<{ ticketId: string }, Ticket | null>('ticketDetailsByIdV2'),

  /**
   * Look a ticket up by its human-readable key (e.g. `PLAT-1234`).
   * Maps to: Zero query 'ticketByXyneIdV3'
   */
  getByKey: query<{ xyneId: string; workspaceId: string }, Ticket | null>(
    'ticketByXyneIdV3'
  ),

  /**
   * Several tickets by id.
   * Maps to: Zero query 'ticketsByIds'
   */
  getMany: query<{ ticketIds: string[] }, Ticket[]>('ticketsByIds'),

  /**
   * Free-text ticket search by title.
   * Maps to: Zero query 'ticketsSearch'
   */
  search: query<{ search?: string; limit?: number }, Ticket[]>('ticketsSearch'),

  /**
   * Tickets in a project.
   * Maps to: Zero query 'ticketsByProjectV2'
   */
  listByProject: query<{ projectId: string }, Ticket[]>('ticketsByProjectV2'),

  /**
   * A ticket's activity timeline.
   * Maps to: Zero query 'ticketActivities'
   */
  listActivities: query<{ ticketId: string }, unknown[]>('ticketActivities'),

  /**
   * Assignment history for a ticket.
   * Maps to: Zero query 'ticketAssignmentsByTicketId'
   */
  listAssignments: query<{ ticketId: string }, unknown[]>('ticketAssignmentsByTicketId'),

  /**
   * The workflow attached to a ticket, if any.
   * Maps to: Zero query 'getWorkflowForTicket'
   */
  getWorkflow: query<{ ticketId: string }, unknown>('getWorkflowForTicket'),

  /**
   * Files attached to a ticket.
   * Maps to: Zero query 'attachmentsByTicket'
   */
  listAttachments: query<{ ticketId: string }, unknown[]>('attachmentsByTicket'),

  /**
   * Emails on a ticket's conversation (desk tickets).
   * Maps to: Zero query 'getEmailsForTicket'
   */
  listEmails: query<{ conversationId: string }, unknown[]>('getEmailsForTicket'),

  /**
   * The current user's mailbox state for a ticket (inbox / archived, starred).
   * Maps to: Zero query 'myTicketMailbox'
   */
  getMailbox: query<{ ticketId: string }, unknown>('myTicketMailbox'),

  /**
   * The RCA linked to a ticket.
   * Maps to: Zero query 'rcaByTicketId'
   */
  getRca: query<{ ticketId: string }, unknown>('rcaByTicketId'),

  /**
   * Release attributions for a ticket.
   * Maps to: Zero query 'releaseAttributionsByTicketId'
   */
  listReleaseAttributions: query<{ ticketId: string }, unknown[]>(
    'releaseAttributionsByTicketId'
  ),

  /**
   * Custom-field values set on a ticket.
   * Maps to: Zero query 'getTicketEntityMappingsByTicketId'
   */
  listFieldValues: query<{ ticketId: string }, unknown[]>(
    'getTicketEntityMappingsByTicketId'
  ),

  // ----- Sub-tickets -----

  /**
   * Sub-tickets of a ticket.
   * Maps to: Zero query 'subTicketsForTicket'
   */
  listSubTickets: query<{ ticketId: string }, SubTicket[]>('subTicketsForTicket'),

  /**
   * Sub-tickets by id.
   * Maps to: Zero query 'subTicketsByIds'
   */
  getSubTickets: query<{ subTicketIds: string[] }, SubTicket[]>('subTicketsByIds'),

  /**
   * Create a sub-ticket. The row id and its mapping id are supplied by the
   * caller so the resource can return them.
   * Maps to: Zero mutator 'subTicket.create'
   */
  createSubTicket: mutator<
    {
      subTicketId: string;
      mappingId: string;
      ticketId: string;
      title: string;
      description?: string;
      conversationId?: string;
    },
    void
  >('subTicket.create', {
    mapArgs: (args) => ({
      subTicketId: args.subTicketId,
      mappingId: args.mappingId,
      ticketId: args.ticketId,
      title: args.title,
      ...(args.description ? { description: args.description } : {}),
      ...(args.conversationId ? { conversationId: args.conversationId } : {}),
      timestamp: now(),
    }),
  }),

  /**
   * Update a sub-ticket.
   * Maps to: Zero mutator 'subTicket.update'
   */
  updateSubTicket: mutator<
    { subTicketId: string; assignedTo?: string; mappedTicketId?: string },
    void
  >('subTicket.update', {
    mapArgs: (args) => ({ ...args, timestamp: now() }),
  }),

  // ----- Writes -----

  /**
   * Update a ticket.
   *
   * This is the single broad update path — title, description, status, priority,
   * stage, assignee, ETA, and archive state all go through it.
   * Maps to: Zero mutator 'ticket.update'
   */
  update: mutator<
    {
      id: string;
      title?: string;
      description?: string;
      statusV2?: TicketStatusV2;
      priority?: TicketPriority;
      stageName?: string;
      assignedTo?: string;
      ticketType?: string;
      userGroupId?: string;
      boardId?: string;
      eta?: number;
      isArchived?: boolean;
      kanbanPosition?: string;
      metadata?: unknown;
    },
    void
  >('ticket.update', {
    mapArgs: (args) => ({ ...args, updatedAt: now() }),
  }),

  /**
   * Reassign a ticket.
   * Maps to: Zero mutator 'ticket.updateAssignment'
   */
  assign: mutator<{ ticketId: string; assignedTo: string }, void>(
    'ticket.updateAssignment',
    {
      mapArgs: (args) => ({
        ticketId: args.ticketId,
        assignedTo: args.assignedTo,
        timestamp: now(),
      }),
    }
  ),

  /**
   * Archive a desk ticket.
   * Maps to: Zero mutator 'ticket.archiveDeskTicket'
   */
  archive: mutator<{ id: string }, void>('ticket.archiveDeskTicket', {
    mapArgs: (args) => ({ id: args.id, updatedAt: now() }),
  }),

  /**
   * Set the ETA for a ticket's current stage.
   * Maps to: Zero mutator 'ticketStageEta.update'
   */
  setStageEta: mutator<
    { id: string; stageEta: number; ticketId?: string; stageId?: string },
    void
  >('ticketStageEta.update', {
    mapArgs: (args) => ({ ...args, updatedAt: now() }),
  }),

  // ----- Tags -----

  /**
   * Tags defined on a project, available to its tickets.
   * Maps to: Zero query 'projectTagsByProjectId'
   */
  listProjectTags: query<{ projectId: string }, unknown[]>('projectTagsByProjectId'),

  /**
   * Apply a tag to a ticket. The tag, project-tag, and mapping row ids are all
   * generated here.
   * Maps to: Zero mutator 'ticketTagV2.create'
   */
  addTag: mutator<{ ticketId: string; projectId: string; tagName: string }, void>(
    'ticketTagV2.create',
    {
      mapArgs: (args) => ({
        ticketId: args.ticketId,
        projectId: args.projectId,
        tagName: args.tagName,
        tagId: newId(),
        projectTagId: newId(),
        mappingId: newId(),
      }),
    }
  ),

  /**
   * Remove a tag from a ticket.
   * Maps to: Zero mutator 'ticketTagV2.delete'
   */
  removeTag: mutator<{ tagId: string }, void>('ticketTagV2.delete'),

  // ----- References between tickets -----

  /**
   * Link two tickets (blocks, relates-to, and so on).
   * Maps to: Zero mutator 'ticketReference.create'
   */
  addReference: mutator<
    { sourceTicketId: string; targetTicketId: string; relationType: string },
    void
  >('ticketReference.create', {
    mapArgs: (args) => ({
      sourceTicketId: args.sourceTicketId,
      targetTicketId: args.targetTicketId,
      relationType: args.relationType,
      referenceId: newId(),
      timestamp: now(),
    }),
  }),

  /**
   * Change how two linked tickets relate.
   * Maps to: Zero mutator 'ticketReference.updateRelationType'
   */
  updateReference: mutator<{ id: string; relationType: string }, void>(
    'ticketReference.updateRelationType',
    {
      mapArgs: (args) => ({ id: args.id, relationType: args.relationType, timestamp: now() }),
    }
  ),

  /**
   * Unlink two tickets.
   * Maps to: Zero mutator 'ticketReference.delete'
   */
  removeReference: mutator<{ id: string }, void>('ticketReference.delete'),

  // ----- Stage approval requests -----

  /**
   * Approval requests raised for a ticket's stage moves.
   * Maps to: Zero query 'getTicketStageRequests'
   */
  listStageRequests: query<{ ticketId: string }, TicketStageRequest[]>(
    'getTicketStageRequests'
  ),

  /**
   * Open approval requests sitting on a stage.
   * Maps to: Zero query 'getOpenTicketStageRequestsByStageId'
   */
  listOpenStageRequests: query<{ stageId: string }, TicketStageRequest[]>(
    'getOpenTicketStageRequestsByStageId'
  ),

  /**
   * Raise or decide a stage-approval request.
   *
   * `updatedBy` has to be supplied by the caller: the mutator records it as an
   * argument rather than deriving it from the session.
   * Maps to: Zero mutator 'ticketStageRequest.upsert'
   */
  upsertStageRequest: mutator<
    {
      id: string;
      ticketId: string;
      stageId: string;
      status: StageRequestStatus;
      updatedBy: string;
      formId?: string;
      reviewedBy?: string;
      comment?: string;
    },
    void
  >('ticketStageRequest.upsert', {
    mapArgs: (args) => ({ ...args, updatedAt: now() }),
  }),

  /**
   * Clear a ticket's stage requests.
   * Maps to: Zero mutator 'ticketStageRequest.deleteByTicketId'
   */
  deleteStageRequests: mutator<{ ticketId: string }, void>(
    'ticketStageRequest.deleteByTicketId'
  ),

  /**
   * Move a ticket to another stage on a non-linear board, running the board's
   * transition rules.
   * Maps to: Zero mutator 'nonLinear.transition'
   */
  transitionStage: mutator<
    { ticketId: string; toStageName: string; formValuesJson?: string },
    void
  >('nonLinear.transition', {
    mapArgs: (args) => ({
      ticketId: args.ticketId,
      toStageName: args.toStageName,
      ...(args.formValuesJson ? { formValuesJson: args.formValuesJson } : {}),
      now: now(),
    }),
  }),

  // ----- Mailbox -----

  /**
   * Move a ticket between inbox and archive for the current user.
   * Maps to: Zero mutator 'ticketMailbox.setState'
   */
  setMailboxState: mutator<
    { id: string; ticketId: string; channelId: string; state: string },
    void
  >('ticketMailbox.setState', {
    mapArgs: (args) => ({ ...args, timestamp: now() }),
  }),

  /**
   * Star or unstar a ticket for the current user.
   * Maps to: Zero mutator 'ticketMailbox.setStarred'
   */
  setMailboxStarred: mutator<
    { id: string; ticketId: string; channelId: string; starred: boolean },
    void
  >('ticketMailbox.setStarred', {
    mapArgs: (args) => ({ ...args, timestamp: now() }),
  }),
  /**
   * Sub-tickets linked to a mapped ticket.
   * Maps to: Zero query 'subTicketsByMappedTicketId'
   */
  listSubTicketsByMapped: query<{ mappedTicketId: string }, SubTicket[]>(
    'subTicketsByMappedTicketId'
  ),

  /**
   * The single sub-ticket linked to a mapped ticket.
   * Maps to: Zero query 'subTicketByMappedTicketId'
   */
  getSubTicketByMapped: query<{ mappedTicketId: string }, SubTicket | null>(
    'subTicketByMappedTicketId'
  ),
} as const;
