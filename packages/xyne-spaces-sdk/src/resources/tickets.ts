/**
 * Tickets Resource
 *
 * Work-tracking tickets, sub-tickets, tags, cross-ticket references, stage
 * approvals, and per-user mailbox state.
 *
 * Support-desk tickets are the same underlying rows viewed through the email
 * surface; those live on `sdk.supportTickets`.
 */

import { Resource } from './base.js';
import {
  ticketsOperations,
  type TicketCursor,
  type TicketViewMode,
} from '../registry/tickets.js';
import { newId } from '../core/ids.js';
import type {
  CreateTicketInput,
  CreateTicketResponse,
  StageRequestStatus,
  SubTicket,
  Ticket,
  TicketPriority,
  TicketStageRequest,
  TicketStatusV2,
} from '../types/index.js';

export class TicketsResource extends Resource {
  /**
   * Create a ticket using the server-side sequence allocator. Files, when
   * supplied, are uploaded in the same request.
   */
  create(data: CreateTicketInput): Promise<CreateTicketResponse> {
    return this.call(ticketsOperations.create, data);
  }

  /**
   * List tickets for a view.
   *
   * `viewMode` decides the scope and which id is used: `project` reads
   * `projectId`, `board` reads `boardId`, `user-tickets` reads `userId`,
   * `group-tickets` reads `groupId`, and `my-tickets` needs none.
   *
   * @example
   * const tickets = await sdk.tickets.list({ viewMode: 'board', boardId: 'board-1' });
   */
  list(options: {
    viewMode: TicketViewMode;
    projectId?: string;
    boardId?: string;
    userId?: string;
    groupId?: string;
    formEntityValueFieldIds?: string[];
  }): Promise<Ticket[]> {
    return this.call(ticketsOperations.list, options);
  }

  /**
   * List a page of tickets for the kanban board.
   *
   * @param options.start - Cursor from the last item of the previous page
   */
  listKanban(options?: {
    limit?: number;
    start?: TicketCursor;
    searchQuery?: string;
    statusFilter?: string[];
    assignedToFilter?: string[];
    createdByFilter?: string[];
    workflowTypeFilter?: string[];
  }): Promise<Ticket[]> {
    return this.call(ticketsOperations.listKanban, options ?? {});
  }

  /** Get one ticket. */
  get(ticketId: string): Promise<Ticket | null> {
    return this.call(ticketsOperations.get, { ticketId });
  }

  /** Get one ticket with its relations resolved for a detail view. */
  getDetails(ticketId: string): Promise<Ticket | null> {
    return this.call(ticketsOperations.getDetails, { ticketId });
  }

  /**
   * Look up a ticket by its human-readable key.
   *
   * @example
   * const ticket = await sdk.tickets.getByKey('PLAT-1234', 'workspace-1');
   */
  getByKey(xyneId: string, workspaceId: string): Promise<Ticket | null> {
    return this.call(ticketsOperations.getByKey, { xyneId, workspaceId });
  }

  /** Get several tickets by id. */
  getMany(ticketIds: string[]): Promise<Ticket[]> {
    return this.call(ticketsOperations.getMany, { ticketIds });
  }

  /** Search tickets by title. */
  search(options?: { search?: string; limit?: number }): Promise<Ticket[]> {
    return this.call(ticketsOperations.search, options ?? {});
  }

  /** List tickets in a project. */
  listByProject(projectId: string): Promise<Ticket[]> {
    return this.call(ticketsOperations.listByProject, { projectId });
  }

  /** List a ticket's activity timeline. */
  listActivities(ticketId: string): Promise<unknown[]> {
    return this.call(ticketsOperations.listActivities, { ticketId });
  }

  /** List a ticket's assignment history. */
  listAssignments(ticketId: string): Promise<unknown[]> {
    return this.call(ticketsOperations.listAssignments, { ticketId });
  }

  /** Get the workflow attached to a ticket. */
  getWorkflow(ticketId: string): Promise<unknown> {
    return this.call(ticketsOperations.getWorkflow, { ticketId });
  }

  /** List files attached to a ticket. */
  listAttachments(ticketId: string): Promise<unknown[]> {
    return this.call(ticketsOperations.listAttachments, { ticketId });
  }

  /** List the emails on a desk ticket's conversation. */
  listEmails(conversationId: string): Promise<unknown[]> {
    return this.call(ticketsOperations.listEmails, { conversationId });
  }

  /** Get the current user's mailbox state for a ticket. */
  getMailbox(ticketId: string): Promise<unknown> {
    return this.call(ticketsOperations.getMailbox, { ticketId });
  }

  /** Get the RCA linked to a ticket. */
  getRca(ticketId: string): Promise<unknown> {
    return this.call(ticketsOperations.getRca, { ticketId });
  }

  /** List release attributions for a ticket. */
  listReleaseAttributions(ticketId: string): Promise<unknown[]> {
    return this.call(ticketsOperations.listReleaseAttributions, { ticketId });
  }

  /** List custom-field values set on a ticket. */
  listFieldValues(ticketId: string): Promise<unknown[]> {
    return this.call(ticketsOperations.listFieldValues, { ticketId });
  }

  /**
   * Update a ticket.
   *
   * All ticket edits go through this one operation — status, priority, stage,
   * assignee, ETA, archive state.
   *
   * @example
   * await sdk.tickets.update('ticket-1', { priority: 'HIGH', stageName: 'In Review' });
   */
  update(
    id: string,
    data: {
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
    }
  ): Promise<void> {
    return this.call(ticketsOperations.update, { id, ...data });
  }

  /** Reassign a ticket. */
  assign(ticketId: string, assignedTo: string): Promise<void> {
    return this.call(ticketsOperations.assign, { ticketId, assignedTo });
  }

  /** Archive a desk ticket. */
  archive(id: string): Promise<void> {
    return this.call(ticketsOperations.archive, { id });
  }

  /** Set the ETA for a ticket's current stage. */
  setStageEta(
    id: string,
    stageEta: number,
    options?: { ticketId?: string; stageId?: string }
  ): Promise<void> {
    return this.call(ticketsOperations.setStageEta, { id, stageEta, ...options });
  }

  // ----- Sub-tickets -----

  /** List a ticket's sub-tickets. */
  listSubTickets(ticketId: string): Promise<SubTicket[]> {
    return this.call(ticketsOperations.listSubTickets, { ticketId });
  }

  /** Get sub-tickets by id. */
  getSubTickets(subTicketIds: string[]): Promise<SubTicket[]> {
    return this.call(ticketsOperations.getSubTickets, { subTicketIds });
  }

  /**
   * Create a sub-ticket.
   *
   * @returns The ids of the sub-ticket and of its mapping to the parent
   */
  async createSubTicket(data: {
    ticketId: string;
    title: string;
    description?: string;
    conversationId?: string;
  }): Promise<{ subTicketId: string; mappingId: string }> {
    const subTicketId = newId();
    const mappingId = newId();
    await this.call(ticketsOperations.createSubTicket, { subTicketId, mappingId, ...data });
    return { subTicketId, mappingId };
  }

  /** Update a sub-ticket. */
  updateSubTicket(
    subTicketId: string,
    data: { assignedTo?: string; mappedTicketId?: string }
  ): Promise<void> {
    return this.call(ticketsOperations.updateSubTicket, { subTicketId, ...data });
  }

  // ----- Tags -----

  /** List the tags defined on a project. */
  listProjectTags(projectId: string): Promise<unknown[]> {
    return this.call(ticketsOperations.listProjectTags, { projectId });
  }

  /** Apply a tag to a ticket, creating the project tag if it is new. */
  addTag(ticketId: string, projectId: string, tagName: string): Promise<void> {
    return this.call(ticketsOperations.addTag, { ticketId, projectId, tagName });
  }

  /** Remove a tag from a ticket. */
  removeTag(tagId: string): Promise<void> {
    return this.call(ticketsOperations.removeTag, { tagId });
  }

  // ----- References -----

  /**
   * Link two tickets.
   *
   * @param relationType - The relationship, e.g. `BLOCKS` or `RELATES_TO`
   */
  addReference(
    sourceTicketId: string,
    targetTicketId: string,
    relationType: string
  ): Promise<void> {
    return this.call(ticketsOperations.addReference, {
      sourceTicketId,
      targetTicketId,
      relationType,
    });
  }

  /** Change how two linked tickets relate. */
  updateReference(id: string, relationType: string): Promise<void> {
    return this.call(ticketsOperations.updateReference, { id, relationType });
  }

  /** Unlink two tickets. */
  removeReference(id: string): Promise<void> {
    return this.call(ticketsOperations.removeReference, { id });
  }

  // ----- Stage approvals -----

  /** List approval requests raised for a ticket. */
  listStageRequests(ticketId: string): Promise<TicketStageRequest[]> {
    return this.call(ticketsOperations.listStageRequests, { ticketId });
  }

  /** List open approval requests sitting on a stage. */
  listOpenStageRequests(stageId: string): Promise<TicketStageRequest[]> {
    return this.call(ticketsOperations.listOpenStageRequests, { stageId });
  }

  /**
   * Raise or decide a stage-approval request.
   *
   * `updatedBy` must be the acting user's id — the mutator takes it as an
   * argument rather than reading it from the session. Omit `id` to raise a new
   * request; pass an existing one to decide it.
   *
   * @returns The request id
   */
  async upsertStageRequest(data: {
    id?: string;
    ticketId: string;
    stageId: string;
    status: StageRequestStatus;
    updatedBy: string;
    formId?: string;
    reviewedBy?: string;
    comment?: string;
  }): Promise<{ id: string }> {
    const id = data.id ?? newId();
    await this.call(ticketsOperations.upsertStageRequest, { ...data, id });
    return { id };
  }

  /** Clear a ticket's stage requests. */
  deleteStageRequests(ticketId: string): Promise<void> {
    return this.call(ticketsOperations.deleteStageRequests, { ticketId });
  }

  /**
   * Move a ticket to another stage on a non-linear board.
   *
   * Runs the board's transition rules, which may require an approval or a form.
   */
  transitionStage(
    ticketId: string,
    toStageName: string,
    options?: { formValuesJson?: string }
  ): Promise<void> {
    return this.call(ticketsOperations.transitionStage, {
      ticketId,
      toStageName,
      ...options,
    });
  }

  // ----- Mailbox -----

  /** Move a ticket between inbox and archive for the current user. */
  setMailboxState(data: {
    id: string;
    ticketId: string;
    channelId: string;
    state: string;
  }): Promise<void> {
    return this.call(ticketsOperations.setMailboxState, data);
  }

  /** Star or unstar a ticket for the current user. */
  setMailboxStarred(data: {
    id: string;
    ticketId: string;
    channelId: string;
    starred: boolean;
  }): Promise<void> {
    return this.call(ticketsOperations.setMailboxStarred, data);
  }

  /** List sub-tickets linked to a mapped ticket. */
  listSubTicketsByMapped(mappedTicketId: string): Promise<SubTicket[]> {
    return this.call(ticketsOperations.listSubTicketsByMapped, { mappedTicketId });
  }

  /** Get the single sub-ticket linked to a mapped ticket. */
  getSubTicketByMapped(mappedTicketId: string): Promise<SubTicket | null> {
    return this.call(ticketsOperations.getSubTicketByMapped, { mappedTicketId });
  }
}
