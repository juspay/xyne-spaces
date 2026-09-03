/**
 * Tickets Operation Registry
 *
 * Work-tracking tickets and everything hanging off one: sub-tickets, tags,
 * references between tickets, stage-approval requests, and per-user mailbox
 * state. Support-desk tickets (the email surface) are a separate view of the
 * same table and live in `registry/support-tickets.ts`.
 */

import { api, firstOrNull, op } from './types.js';
import { appendArray, appendFiles, appendOptional } from '../core/form-data.js';
import type {
  CreateTicketInput,
  CreateTicketResponse,
  Email,
  MailboxState,
  MessageAttachment,
  ProjectTag,
  Rca,
  ReleaseAttribution,
  StageRequestStatus,
  SubTicket,
  SubTicketMapping,
  Ticket,
  TicketActivity,
  TicketAssignment,
  TicketExport,
  TicketFieldDefinition,
  TicketMailbox,
  TicketReferenceRelation,
  TicketPriority,
  TicketStageRequest,
  TicketStatusV2,
  Workflow,
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

/** Whether a kanban column is a workflow stage or a ticket status. */
export type KanbanColumnType = 'stage' | 'status';

/**
 * The kanban board's filter set.
 *
 * Mirrors `kanbanTicketPageV2FiltersSchema` in `apps/backend/src/zero/queries.ts`.
 * Ids are user, group, board, tag, and channel ids; `stages` and `ticketTypes` are
 * names.
 */
export interface KanbanTicketFilters {
  priority?: TicketPriority[];
  assignee?: string[];
  userGroups?: string[];
  createdBy?: string[];
  prReviewers?: string[];
  qaAssigned?: string[];
  dueDateStart?: number;
  dueDateEnd?: number;
  createdDateStart?: number;
  createdDateEnd?: number;
  boards?: string[];
  tags?: string[];
  assigned?: boolean;
  created?: boolean;
  stages?: string[];
  ticketTypes?: string[];
  sourceChannels?: string[];
  /** Role-scoped assignment filter: everyone assigned to `roleId` from `userIds`. */
  roleAssignments?: Array<{ roleId: string; userIds: string[] }>;
}

/** Page cursor for the cross-ticket activity feed, ordered by timestamp then id. */
export interface TicketActivityCursor {
  timestamp: number;
  id: string;
}

export const ticketsOperations = {
  // ----- Direct API operations -----

  /**
   * Create a ticket through the server-side sequence allocator and workflow.
   */
  create: api<CreateTicketInput, CreateTicketResponse>('POST', '/api/sdk/v1/tickets', {
    mapArgs: (args) => {
      const { files, ...fields } = args;
      if (!files || files.length === 0) return fields;

      const { tags, excludedChatAttachmentIds, draftAttachmentIds, ...scalarFields } = fields;

      const form = new FormData();
      for (const [key, value] of Object.entries(scalarFields)) {
        appendOptional(form, key, value);
      }
      appendArray(form, 'tags', tags);
      appendArray(form, 'excludedChatAttachmentIds', excludedChatAttachmentIds);
      appendArray(form, 'draftAttachmentIds', draftAttachmentIds);
      appendFiles(form, files);
      return form;
    },
    // Passed through rather than rebuilt field by field. The controller
    // returns a full ticket detail (see `createTicket` in ticketController),
    // and narrowing it here silently dropped `stageName` and `status` — the
    // two things a caller most wants back, since the server rather than the
    // caller decides them.
    mapResult: (raw) => raw as CreateTicketResponse,
  }),

  // ----- Reads -----

  /**
   * Tickets for a view. `viewMode` selects the scope and decides which of
   * `projectId` / `boardId` / `userId` / `groupId` is used.
   */
  list: op<{
      viewMode: TicketViewMode;
      projectId?: string;
      boardId?: string;
      userId?: string;
      groupId?: string;
      formEntityValueFieldIds?: string[];
    }, Ticket[]>('tickets.list', 'query'),

  /**
   * A page of tickets for the kanban board, with the board's filter set.
   *
   * V3 takes exactly the same arguments as V2 — the schema is literally
   * `kanbanTicketsPageV3ArgsSchema = kanbanTicketsPageV2ArgsSchema`. What changed
   * is the body: it reads the precomputed `isStageOverdue` column instead of
   * joining `stageEtaEntries`, so kanban rows no longer carry that relation.
   * Nothing read it off a kanban row; `list` (ticketsQueryV2) still relates it.
   *
   * `viewMode` and `stageName` are required by the query, not conveniences: the
   * query is written per board column, so it wants to know which scope and which
   * column. `stageName: ''` is the sentinel the product's own board navigation
   * uses to mean "every stage", and is the default here.
   *
   * Filters go inside `filters`. An earlier version of this entry accepted
   * `searchQuery` / `statusFilter` / `assignedToFilter` / `createdByFilter` /
   * `workflowTypeFilter`, which belong to the unrelated `workflowsPaginated`
   * query — zod stripped them silently, so those filters never did anything.
   */
  listKanban: op<{
      viewMode: TicketViewMode;
      stageName?: string;
      columnType?: KanbanColumnType;
      limit?: number;
      start?: TicketCursor | null;
      dir?: 'forward' | 'backward';
      projectId?: string;
      boardId?: string;
      userId?: string;
      groupId?: string;
      filters?: KanbanTicketFilters;
      formEntityValueFieldIds?: string[];
      showOverdueOnly?: boolean;
      overdueReferenceTime?: number;
      excludeFlowSteps?: boolean;
    }, Ticket[]>('tickets.listKanban', 'query'),

  /**
   * Tickets created in a channel inside a time window, newest first.
   *
   * Drives the desk support screen's topic explorer. The window is inclusive at
   * both ends and the server rejects `createdAtStart > createdAtEnd`.
   *
   * `isMember` is required by the schema but unread by the query body — it is an
   * ACL hint, and is supplied here so a caller does not have to know that.
   */
  listByChannelInWindow: op<{
      channelId: string;
      createdAtStart: number;
      createdAtEnd: number;
      isMember?: boolean;
    }, Ticket[]>('tickets.listByChannelInWindow', 'query'),

  /**
   * One ticket.
   */
  get: op<{ ticketId: string }, Ticket | null>('tickets.get', 'query'),

  /**
   * One ticket with its relations resolved for a detail view.
   */
  getDetails: op<{ ticketId: string }, Ticket | null>('tickets.getDetails', 'query'),

  /**
   * Look a ticket up by its human-readable key (e.g. `PLAT-1234`).
   */
  getByKey: op<{ xyneId: string; workspaceId: string }, Ticket | null>('tickets.getByKey', 'query'),

  /**
   * Several tickets by id.
   */
  getMany: op<{ ticketIds: string[] }, Ticket[]>('tickets.getMany', 'query'),

  /**
   * The bare ticket row, with no relations resolved.
   *
   * Cheaper than `get` when only the ticket's own columns are needed — `get`
   * additionally pulls project, tags, assignments, references, and stage data.
   */
  getRow: op<{ ticketId: string }, Ticket | null>('tickets.getRow', 'query'),

  /**
   * Free-text ticket search by title.
   */
  search: op<{ search?: string; limit?: number }, Ticket[]>('tickets.search', 'query'),

  /**
   * Tickets in a project.
   */
  listByProject: op<{ projectId: string }, Ticket[]>('tickets.listByProject', 'query'),

  /**
   * The current user's ticket exports, newest first (server caps at 100).
   */
  listExports: op<void, TicketExport[]>('tickets.listExports', 'query'),

  /**
   * A ticket's activity timeline.
   */
  listActivities: op<{ ticketId: string }, TicketActivity[]>('tickets.listActivities', 'query'),

  /**
   * Activities across several tickets at once, newest first, paginated.
   *
   * The batch counterpart to `listActivities`. `start` is nullable rather than
   * optional server-side, so it is always sent — as null on the first page.
   */
  listActivitiesForTickets: op<{ ticketIds: string[]; limit?: number; start?: TicketActivityCursor }, TicketActivity[]>('tickets.listActivitiesForTickets', 'query'),

  /**
   * Assignment history for a ticket.
   */
  listAssignments: op<{ ticketId: string }, TicketAssignment[]>('tickets.listAssignments', 'query'),

  /**
   * The workflow attached to a ticket, if any.
   */
  getWorkflow: op<{ ticketId: string }, Workflow | null>('tickets.getWorkflow', 'query', {
    mapResult: firstOrNull,
  }),

  /**
   * Files attached to a ticket.
   */
  listAttachments: op<{ ticketId: string }, MessageAttachment[]>('tickets.listAttachments', 'query'),

  /**
   * Emails on a ticket's conversation (desk tickets).
   */
  listEmails: op<{ conversationId: string }, Email[]>('tickets.listEmails', 'query'),

  /**
   * The current user's mailbox state for a ticket (inbox / archived, starred).
   *
   * The V2 query takes the ticket's `channelId` too, as a hint to Zero's ACL
   * layer, so callers must now pass it. `isMember` is supplied here.
   */
  getMailbox: op<{ ticketId: string; channelId: string }, TicketMailbox | null>(
    'tickets.getMailbox',
    'query',
    { mapResult: firstOrNull }
  ),

  /**
   * The RCA linked to a ticket.
   */
  getRca: op<{ ticketId: string }, Rca | null>('tickets.getRca', 'query'),

  /**
   * Release attributions for a ticket.
   */
  listReleaseAttributions: op<{ ticketId: string }, ReleaseAttribution[]>('tickets.listReleaseAttributions', 'query'),

  /**
   * Custom-field values set on a ticket.
   */
  listFieldValues: op<{ ticketId: string }, TicketFieldDefinition[]>('tickets.listFieldValues', 'query'),

  // ----- Sub-tickets -----

  /**
   * Sub-tickets of a ticket.
   */
  listSubTickets: op<{ ticketId: string }, SubTicket[]>('tickets.listSubTickets', 'query'),

  /**
   * Sub-tickets by id.
   */
  getSubTickets: op<{ subTicketIds: string[] }, SubTicket[]>('tickets.getSubTickets', 'query'),

  /**
   * Sub-ticket mappings for several parent tickets at once.
   *
   * Returns the mapping rows (each carrying its sub-ticket), not bare sub-tickets,
   * so a caller batching many parents can tell which parent each one belongs to.
   */
  listSubTicketMappings: op<{ ticketIds: string[] }, SubTicketMapping[]>('tickets.listSubTicketMappings', 'query'),

  /**
   * Create a sub-ticket. The row id and its mapping id are supplied by the
   * caller so the resource can return them.
   */
  createSubTicket: op<{
      subTicketId: string;
      mappingId: string;
      ticketId: string;
      title: string;
      description?: string;
      conversationId?: string;
    }, void>('tickets.createSubTicket', 'mutator'),

  /**
   * Update a sub-ticket.
   */
  updateSubTicket: op<{ subTicketId: string; assignedTo?: string; mappedTicketId?: string }, void>('tickets.updateSubTicket', 'mutator'),

  // ----- Writes -----

  /**
   * Update a ticket.
   *
   * This is the single broad update path — title, description, status, priority,
   * stage, assignee, ETA, and archive state all go through it.
   */
  update: op<{
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
    }, void>('tickets.update', 'mutator'),

  /**
   * Reassign a ticket.
   */
  assign: op<{ ticketId: string; assignedTo: string }, void>('tickets.assign', 'mutator'),

  /**
   * Archive a desk ticket.
   */
  archive: op<{ id: string }, void>('tickets.archive', 'mutator'),

  /**
   * Set the ETA for a ticket's current stage.
   */
  setStageEta: op<{ id: string; stageEta: number; ticketId?: string; stageId?: string }, void>('tickets.setStageEta', 'mutator'),

  // ----- Tags -----

  /**
   * Tags defined on a project, available to its tickets.
   */
  listProjectTags: op<{ projectId: string }, ProjectTag[]>('tickets.listProjectTags', 'query'),

  /**
   * Apply a tag to a ticket. The tag, project-tag, and mapping row ids are all
   * generated here.
   */
  addTag: op<{ ticketId: string; projectId: string; tagName: string }, void>('tickets.addTag', 'mutator'),

  /**
   * Remove a tag from a ticket.
   */
  // Both ids are required: the tag itself and the row linking it to the ticket.
  removeTag: op<{ tagId: string; mappingId: string }, void>('tickets.removeTag', 'mutator'),

  // ----- References between tickets -----

  /**
   * Link two tickets (blocks, relates-to, and so on).
   */
  addReference: op<{ sourceTicketId: string; targetTicketId: string; relationType: TicketReferenceRelation }, void>('tickets.addReference', 'mutator'),

  /**
   * Change how two linked tickets relate.
   */
  updateReference: op<{ id: string; relationType: TicketReferenceRelation }, void>('tickets.updateReference', 'mutator'),

  /**
   * Unlink two tickets.
   */
  removeReference: op<{ id: string }, void>('tickets.removeReference', 'mutator'),

  // ----- Stage approval requests -----

  /**
   * Approval requests raised for a ticket's stage moves.
   */
  listStageRequests: op<{ ticketId: string }, TicketStageRequest[]>('tickets.listStageRequests', 'query'),

  /**
   * Open approval requests sitting on a stage.
   */
  listOpenStageRequests: op<{ stageId: string }, TicketStageRequest[]>('tickets.listOpenStageRequests', 'query'),

  /**
   * Raise or decide a stage-approval request.
   *
   * `updatedBy` has to be supplied by the caller: the mutator records it as an
   * argument rather than deriving it from the session.
   */
  upsertStageRequest: op<{
      id: string;
      ticketId: string;
      stageId: string;
      status: StageRequestStatus;
      updatedBy: string;
      formId?: string;
      reviewedBy?: string;
      comment?: string;
    }, void>('tickets.upsertStageRequest', 'mutator'),

  /**
   * Clear a ticket's stage requests.
   */
  deleteStageRequests: op<{ ticketId: string }, void>('tickets.deleteStageRequests', 'mutator'),

  /**
   * Move a ticket to another stage on a non-linear board, running the board's
   * transition rules.
   */
  transitionStage: op<{ ticketId: string; toStageName: string; formValuesJson?: string }, void>('tickets.transitionStage', 'mutator'),

  // ----- Mailbox -----

  /**
   * Move a ticket between inbox and archive for the current user.
   */
  setMailboxState: op<{ id: string; ticketId: string; channelId: string; state: MailboxState }, void>('tickets.setMailboxState', 'mutator'),

  /**
   * Star or unstar a ticket for the current user.
   */
  setMailboxStarred: op<{ id: string; ticketId: string; channelId: string; starred: boolean }, void>('tickets.setMailboxStarred', 'mutator'),
  /**
   * Sub-tickets linked to a mapped ticket.
   */
  listSubTicketsByMapped: op<{ mappedTicketId: string }, SubTicket[]>('tickets.listSubTicketsByMapped', 'query'),

  /**
   * The single sub-ticket linked to a mapped ticket.
   */
  getSubTicketByMapped: op<{ mappedTicketId: string }, SubTicket | null>('tickets.getSubTicketByMapped', 'query'),
} as const;
