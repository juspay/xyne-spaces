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
  type KanbanColumnType,
  type KanbanTicketFilters,
  type TicketActivityCursor,
  type TicketCursor,
  type TicketViewMode,
} from '../registry/tickets.js';
import { newId } from '../core/ids.js';
import { paginate, type Page, type PageOptions } from '../core/paginate.js';
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
  TicketPriority,
  TicketReferenceRelation,
  TicketStageRequest,
  TicketStatusV2,
  Workflow,
} from '../types/index.js';

export class TicketsResource extends Resource {
  /**
   * Create a ticket, allocating its key with the server-side sequence allocator.
   *
   * Files, when supplied, are uploaded in the same request.
   *
   * @param data - The ticket to create. `title`, `description` and `projectId`
   * are required; everything else is optional.
   * @returns The created ticket in full, including its key and stage.
   * @example
   * const ticket = await sdk.tickets.create({
   *   title: 'Checkout latency',
   *   description: 'p99 above 2s since 14:00',
   *   projectId: 'proj-1',
   * });
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
   * @param options.viewMode - Which scope to read.
   * @param options.projectId - Required for `project`.
   * @param options.boardId - Required for `board`.
   * @param options.userId - Required for `user-tickets`.
   * @param options.groupId - Required for `group-tickets`.
   * @param options.formEntityValueFieldIds - Custom fields to resolve per ticket.
   * @returns Tickets in that view.
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
   * `viewMode` is required and picks the scope exactly as in {@link list}.
   * `stageName` narrows to a single board column; omit it (or pass `''`) for
   * every stage. Filters belong in `filters` — see {@link KanbanTicketFilters}.
   *
   * @param options.start - Cursor from the last item of the previous page
   *
   * @example
   * const page = await sdk.tickets.listKanban({
   *   viewMode: 'board',
   *   boardId: 'board-1',
   *   limit: 100,
   *   filters: { priority: ['HIGH'] },
   * });
   */
  listKanban(options: {
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
  }): Promise<Ticket[]> {
    return this.call(ticketsOperations.listKanban, options);
  }

  /**
   * Tickets created in a channel between two epoch-ms timestamps, newest first.
   *
   * Both ends are inclusive, and `createdAtStart` must not be after
   * `createdAtEnd` — the server rejects the pair rather than returning nothing.
   *
   * @param options.channelId - Channel to read.
   * @param options.createdAtStart - Window start, epoch milliseconds, inclusive.
   * @param options.createdAtEnd - Window end, epoch milliseconds, inclusive.
   * @param options.isMember - ACL hint; leave unset unless you know otherwise.
   * @returns Tickets created in that window, newest first.
   * @example
   * const week = await sdk.tickets.listByChannelInWindow({
   *   channelId: 'channel-123',
   *   createdAtStart: Date.now() - 7 * 86_400_000,
   *   createdAtEnd: Date.now(),
   * });
   */
  listByChannelInWindow(options: {
    channelId: string;
    createdAtStart: number;
    createdAtEnd: number;
    isMember?: boolean;
  }): Promise<Ticket[]> {
    return this.call(ticketsOperations.listByChannelInWindow, options);
  }

  /**
   * Get one ticket, with its common relations resolved.
   *
   * @param ticketId - Id of the ticket.
   * @returns The ticket, or `null` if it does not exist or is not visible.
   * @example
   * const ticket = await sdk.tickets.get('ticket-1');
   */
  get(ticketId: string): Promise<Ticket | null> {
    return this.call(ticketsOperations.get, { ticketId });
  }

  /**
   * Get one ticket with every relation a detail view needs.
   *
   * The fullest read: project, board, tags, assignments, references and stage
   * data all resolved.
   *
   * @param ticketId - Id of the ticket.
   * @returns The ticket with its relations, or `null`.
   * @example
   * const ticket = await sdk.tickets.getDetails('ticket-1');
   */
  getDetails(ticketId: string): Promise<Ticket | null> {
    return this.call(ticketsOperations.getDetails, { ticketId });
  }

  /**
   * Look up a ticket by its human-readable key.
   *
   * @param xyneId - Ticket key, e.g. `PLAT-1234`.
   * @param workspaceId - Workspace the key belongs to, from `sdk.users.me()`.
   * @returns The ticket, or `null` if the key is unknown.
   * @example
   * const ticket = await sdk.tickets.getByKey('PLAT-1234', 'workspace-1');
   */
  getByKey(xyneId: string, workspaceId: string): Promise<Ticket | null> {
    return this.call(ticketsOperations.getByKey, { xyneId, workspaceId });
  }

  /**
   * Get the bare ticket row, without resolving any relations.
   *
   * Cheaper than {@link get}, which also pulls project, tags, assignments,
   * references and stage data. Use this when only the ticket's own columns matter.
   *
   * @param ticketId - Id of the ticket.
   * @returns The ticket row, or `null`.
   * @example
   * const ticket = await sdk.tickets.getRow('ticket-1');
   */
  getRow(ticketId: string): Promise<Ticket | null> {
    return this.call(ticketsOperations.getRow, { ticketId });
  }

  /**
   * Get several tickets by id in one call.
   *
   * @param ticketIds - Ids to fetch. Unknown ids are skipped.
   * @returns The tickets that exist and are visible.
   * @example
   * const tickets = await sdk.tickets.getMany(['ticket-1', 'ticket-2']);
   */
  getMany(ticketIds: string[]): Promise<Ticket[]> {
    return this.call(ticketsOperations.getMany, { ticketIds });
  }

  /**
   * Search tickets by title.
   *
   * @param options.search - Text to match against titles.
   * @param options.limit - Maximum results.
   * @returns Matching tickets.
   * @example
   * const tickets = await sdk.tickets.search({ search: 'latency', limit: 20 });
   */
  search(options?: { search?: string; limit?: number }): Promise<Ticket[]> {
    return this.call(ticketsOperations.search, options ?? {});
  }

  /**
   * List tickets in a project, one page at a time.
   *
   * `ticketsByProjectV2` has no server-side cursor — a project with hundreds
   * of tickets returns all of them in one response — so this fetches that and
   * windows it. Defaults to the first 100, which is also the cap. For filtered, view-scoped listing
   * (by board, by assignee, by status) use {@link list} instead, which takes
   * those filters server-side.
   *
   * @param projectId - Project to read.
   * @param options.limit - Page size. Defaults to 100, which is also the maximum.
   * @param options.offset - Where the page starts.
   * @returns One page of the project's tickets.
   * @example
   * const page = await sdk.tickets.listByProject('proj-1', { limit: 50 });
   */
  async listByProject(projectId: string, options?: PageOptions): Promise<Page<Ticket>> {
    const all = await this.call(ticketsOperations.listByProject, { projectId });
    return paginate(all, options);
  }

  /**
   * List the caller's ticket exports, newest first. The server caps this at 100.
   *
   * @returns Their export requests and each one's status.
   * @example
   * const exports = await sdk.tickets.listExports();
   */
  listExports(): Promise<TicketExport[]> {
    return this.call(ticketsOperations.listExports, undefined);
  }

  /**
   * List one ticket's activity timeline, one page at a time.
   *
   * `ticketActivities` has no server-side cursor — a ticket's whole history
   * comes back in one response — so this fetches that and windows it.
   * Defaults to the first 100 (also the cap), newest first. For several tickets
   * at once, with a real server-side cursor, use {@link listActivitiesForTickets}.
   *
   * @param ticketId - Ticket whose history to read.
   * @param options.limit - Page size. Defaults to 100, which is also the maximum.
   * @param options.offset - Where the page starts.
   * @returns One page of activity entries, newest first.
   * @example
   * const page = await sdk.tickets.listActivities('ticket-1');
   */
  async listActivities(ticketId: string, options?: PageOptions): Promise<Page<TicketActivity>> {
    const all = await this.call(ticketsOperations.listActivities, { ticketId });
    return paginate(all, options);
  }

  /**
   * Activities across several tickets at once, newest first.
   *
   * The batch counterpart to {@link listActivities}. Page by passing the last
   * row's `{ timestamp, id }` back as `start`.
   *
   * @param options.ticketIds - Tickets whose history to read.
   * @param options.limit - Page size.
   * @param options.start - Cursor from the last row of the previous page.
   * @returns Activity entries across every ticket named, newest first.
   * @example
   * const page = await sdk.tickets.listActivitiesForTickets({
   *   ticketIds: ['t1', 't2'],
   *   limit: 50,
   * });
   */
  listActivitiesForTickets(options: {
    ticketIds: string[];
    limit?: number;
    start?: TicketActivityCursor;
  }): Promise<TicketActivity[]> {
    return this.call(ticketsOperations.listActivitiesForTickets, options);
  }

  /**
   * List a ticket's assignments, including past ones.
   *
   * @param ticketId - Id of the ticket.
   * @returns One row per assignment, with the assignee's responsibility.
   * @example
   * const assignments = await sdk.tickets.listAssignments('ticket-1');
   */
  listAssignments(ticketId: string): Promise<TicketAssignment[]> {
    return this.call(ticketsOperations.listAssignments, { ticketId });
  }

  /**
   * Get the automation run attached to a ticket.
   *
   * @param ticketId - Id of the ticket.
   * @returns The run, or `null` if none is attached.
   * @example
   * const workflow = await sdk.tickets.getWorkflow('ticket-1');
   */
  getWorkflow(ticketId: string): Promise<Workflow | null> {
    return this.call(ticketsOperations.getWorkflow, { ticketId });
  }

  /**
   * List files attached to a ticket.
   *
   * @param ticketId - Id of the ticket.
   * @returns Its attachments.
   * @example
   * const files = await sdk.tickets.listAttachments('ticket-1');
   */
  listAttachments(ticketId: string): Promise<MessageAttachment[]> {
    return this.call(ticketsOperations.listAttachments, { ticketId });
  }

  /**
   * List the emails on a desk ticket's thread.
   *
   * @param conversationId - The ticket's thread.
   * @returns Its emails, oldest first.
   * @example
   * const emails = await sdk.tickets.listEmails('conv-1');
   */
  listEmails(conversationId: string): Promise<Email[]> {
    return this.call(ticketsOperations.listEmails, { conversationId });
  }

  /**
   * Get the caller's mailbox state for a desk ticket.
   *
   * @param ticketId - Id of the ticket.
   * @param channelId - The ticket's channel, required as an ACL hint. Every
   * ticket read returns it.
   * @returns Their mailbox row, or `null` if the ticket is not in their mailbox.
   * @example
   * const mailbox = await sdk.tickets.getMailbox('ticket-1', 'channel-desk');
   */
  getMailbox(ticketId: string, channelId: string): Promise<TicketMailbox | null> {
    return this.call(ticketsOperations.getMailbox, { ticketId, channelId });
  }

  /**
   * Get the root-cause analysis linked to a ticket.
   *
   * @param ticketId - Id of the ticket.
   * @returns The RCA, or `null` if none is linked.
   * @example
   * const rca = await sdk.tickets.getRca('ticket-1');
   */
  getRca(ticketId: string): Promise<Rca | null> {
    return this.call(ticketsOperations.getRca, { ticketId });
  }

  /**
   * List the releases a ticket has been attributed to.
   *
   * @param ticketId - Id of the ticket.
   * @returns Its attributions, each with a confidence.
   * @example
   * const attributions = await sdk.tickets.listReleaseAttributions('ticket-1');
   */
  listReleaseAttributions(ticketId: string): Promise<ReleaseAttribution[]> {
    return this.call(ticketsOperations.listReleaseAttributions, { ticketId });
  }

  /**
   * List the custom-field values set on a ticket.
   *
   * @param ticketId - Id of the ticket.
   * @returns Its field values, each naming a merchant or gateway.
   * @example
   * const fields = await sdk.tickets.listFieldValues('ticket-1');
   */
  listFieldValues(ticketId: string): Promise<TicketFieldDefinition[]> {
    return this.call(ticketsOperations.listFieldValues, { ticketId });
  }

  /**
   * Update a ticket.
   *
   * All ticket edits go through this one operation — status, priority, stage,
   * assignee, ETA, archive state.
   *
   * @param id - Id of the ticket.
   * @param data - Fields to change; omitted fields are left alone.
   * @param data.title - New title.
   * @param data.description - New description.
   * @param data.statusV2 - New status.
   * @param data.priority - New priority.
   * @param data.stageName - Stage to move it to.
   * @param data.assignedTo - User id of the new assignee.
   * @param data.ticketType - New ticket type.
   * @param data.userGroupId - Group that owns it.
   * @param data.boardId - Move it to another board.
   * @param data.eta - Due date, epoch milliseconds.
   * @param data.isArchived - Archive or restore it.
   * @param data.kanbanPosition - Sort key within its kanban column.
   * @param data.metadata - Ticket-specific extra data.
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

  /**
   * Reassign a ticket.
   *
   * @param ticketId - Id of the ticket.
   * @param assignedTo - User id of the new assignee.
   * @example
   * await sdk.tickets.assign('ticket-1', 'user-1');
   */
  assign(ticketId: string, assignedTo: string): Promise<void> {
    return this.call(ticketsOperations.assign, { ticketId, assignedTo });
  }

  /**
   * Archive a ticket, hiding it from the default listings.
   *
   * @param id - Id of the ticket.
   * @example
   * await sdk.tickets.archive('ticket-1');
   */
  archive(id: string): Promise<void> {
    return this.call(ticketsOperations.archive, { id });
  }

  /**
   * Set the due date for a ticket's current stage.
   *
   * @param id - Id of the stage-ETA row.
   * @param stageEta - When the stage is due, epoch milliseconds.
   * @param options.ticketId - Ticket the ETA belongs to.
   * @param options.stageId - Stage the ETA applies to.
   * @example
   * await sdk.tickets.setStageEta('eta-1', Date.now() + 86_400_000, { ticketId: 'ticket-1' });
   */
  setStageEta(
    id: string,
    stageEta: number,
    options?: { ticketId?: string; stageId?: string }
  ): Promise<void> {
    return this.call(ticketsOperations.setStageEta, { id, stageEta, ...options });
  }

  // ----- Sub-tickets -----

  /**
   * List a ticket's sub-tickets.
   *
   * @param ticketId - Parent ticket.
   * @returns Its sub-tickets.
   * @example
   * const subs = await sdk.tickets.listSubTickets('ticket-1');
   */
  listSubTickets(ticketId: string): Promise<SubTicket[]> {
    return this.call(ticketsOperations.listSubTickets, { ticketId });
  }

  /**
   * Sub-ticket mappings for several parent tickets at once.
   *
   * Returns the mapping rows, each carrying its sub-ticket — so when batching
   * many parents you can still tell which parent each sub-ticket belongs to.
   * Use {@link listSubTickets} for a single parent.
   *
   * @param ticketIds - Parent tickets to read.
   * @returns One mapping per parent-to-sub-ticket link.
   * @example
   * const mappings = await sdk.tickets.listSubTicketMappings(['t1', 't2']);
   */
  listSubTicketMappings(ticketIds: string[]): Promise<SubTicketMapping[]> {
    return this.call(ticketsOperations.listSubTicketMappings, { ticketIds });
  }

  /**
   * Get several sub-tickets by id.
   *
   * @param subTicketIds - Ids to fetch. Unknown ids are skipped.
   * @returns The sub-tickets that exist.
   * @example
   * const subs = await sdk.tickets.getSubTickets(['sub-1', 'sub-2']);
   */
  getSubTickets(subTicketIds: string[]): Promise<SubTicket[]> {
    return this.call(ticketsOperations.getSubTickets, { subTicketIds });
  }

  /**
   * Create a sub-ticket under a parent.
   *
   * @param data.ticketId - Parent ticket.
   * @param data.title - Display title.
   * @param data.description - What the sub-ticket covers.
   * @param data.conversationId - Thread it came from.
   * @returns The ids of the sub-ticket and of its mapping to the parent.
   * @example
   * const { subTicketId } = await sdk.tickets.createSubTicket({
   *   ticketId: 'ticket-1',
   *   title: 'Add latency alert',
   * });
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

  /**
   * Update a sub-ticket.
   *
   * @param subTicketId - Id of the sub-ticket.
   * @param data.assignedTo - User id of the new assignee.
   * @param data.mappedTicketId - Ticket it is linked to.
   * @example
   * await sdk.tickets.updateSubTicket('sub-1', { assignedTo: 'user-1' });
   */
  updateSubTicket(
    subTicketId: string,
    data: { assignedTo?: string; mappedTicketId?: string }
  ): Promise<void> {
    return this.call(ticketsOperations.updateSubTicket, { subTicketId, ...data });
  }

  // ----- Tags -----

  /**
   * List the tags defined on a project.
   *
   * @param projectId - Project to read.
   * @returns Its tags.
   * @example
   * const tags = await sdk.tickets.listProjectTags('proj-1');
   */
  listProjectTags(projectId: string): Promise<ProjectTag[]> {
    return this.call(ticketsOperations.listProjectTags, { projectId });
  }

  /**
   * Apply a tag to a ticket, creating the project tag if it is new.
   *
   * @param ticketId - Ticket to tag.
   * @param projectId - Project the tag belongs to.
   * @param tagName - The tag's name.
   * @example
   * await sdk.tickets.addTag('ticket-1', 'proj-1', 'payments');
   */
  addTag(ticketId: string, projectId: string, tagName: string): Promise<void> {
    return this.call(ticketsOperations.addTag, { ticketId, projectId, tagName });
  }

  /**
   * Remove a tag from a ticket.
   *
   * Needs both ids: the tag and the row linking it to this ticket. Read the
   * mapping id from the ticket's `tagMappings`.
   *
   * @param tagId - The project tag.
   * @param mappingId - The row linking that tag to this ticket.
   * @example
   * await sdk.tickets.removeTag('tag-1', 'mapping-1');
   */
  removeTag(tagId: string, mappingId: string): Promise<void> {
    return this.call(ticketsOperations.removeTag, { tagId, mappingId });
  }

  // ----- References -----

  /**
   * Link two tickets.
   *
   * @param sourceTicketId - Ticket the link is from.
   * @param targetTicketId - Ticket the link is to.
   * @param relationType - How they relate.
   * @example
   * await sdk.tickets.addReference('ticket-1', 'ticket-2', 'DUPLICATE_CONFIRMED');
   */
  addReference(
    sourceTicketId: string,
    targetTicketId: string,
    relationType: TicketReferenceRelation
  ): Promise<void> {
    return this.call(ticketsOperations.addReference, {
      sourceTicketId,
      targetTicketId,
      relationType,
    });
  }

  /**
   * Change how two linked tickets relate.
   *
   * @param id - Id of the reference.
   * @param relationType - The new relationship.
   * @example
   * await sdk.tickets.updateReference('ref-1', 'LINKED');
   */
  updateReference(id: string, relationType: TicketReferenceRelation): Promise<void> {
    return this.call(ticketsOperations.updateReference, { id, relationType });
  }

  /**
   * Unlink two tickets.
   *
   * @param id - Id of the reference.
   * @example
   * await sdk.tickets.removeReference('ref-1');
   */
  removeReference(id: string): Promise<void> {
    return this.call(ticketsOperations.removeReference, { id });
  }

  // ----- Stage approvals -----

  /**
   * List the stage-approval requests raised for a ticket.
   *
   * @param ticketId - Id of the ticket.
   * @returns Its requests, decided and outstanding.
   * @example
   * const requests = await sdk.tickets.listStageRequests('ticket-1');
   */
  listStageRequests(ticketId: string): Promise<TicketStageRequest[]> {
    return this.call(ticketsOperations.listStageRequests, { ticketId });
  }

  /**
   * List the approval requests still waiting on a stage.
   *
   * @param stageId - Stage to read.
   * @returns Outstanding requests for that stage.
   * @example
   * const pending = await sdk.tickets.listOpenStageRequests('stage-1');
   */
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
   * @param data.id - Existing request to decide. Omit to raise a new one.
   * @param data.ticketId - Ticket the request is about.
   * @param data.stageId - Stage being moved into.
   * @param data.status - Where the request stands.
   * @param data.updatedBy - Acting user's id, from `sdk.users.me()`.
   * @param data.formId - Form completed as part of the request.
   * @param data.reviewedBy - Who decided it.
   * @param data.comment - Note recorded with the decision.
   * @returns The request id, generated when raising a new one.
   * @example
   * const me = await sdk.users.me();
   * const { id } = await sdk.tickets.upsertStageRequest({
   *   ticketId: 'ticket-1',
   *   stageId: 'stage-1',
   *   status: 'SUBMITTED',
   *   updatedBy: me.id,
   * });
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

  /**
   * Clear every stage-approval request on a ticket.
   *
   * @param ticketId - Id of the ticket.
   * @example
   * await sdk.tickets.deleteStageRequests('ticket-1');
   */
  deleteStageRequests(ticketId: string): Promise<void> {
    return this.call(ticketsOperations.deleteStageRequests, { ticketId });
  }

  /**
   * Move a ticket to another stage on a non-linear board.
   *
   * Runs the board's transition rules, which may require an approval or a form.
   *
   * @param ticketId - Ticket to move.
   * @param toStageName - Stage to move it into.
   * @param options.formValuesJson - Serialised form values, when the transition
   * requires a form.
   * @example
   * await sdk.tickets.transitionStage('ticket-1', 'In Review');
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

  /**
   * Move a desk ticket between inbox, archive and spam for the caller.
   *
   * @param data.id - Id of the mailbox row.
   * @param data.ticketId - Ticket being moved.
   * @param data.channelId - Desk channel it belongs to.
   * @param data.state - Where it should sit.
   * @example
   * await sdk.tickets.setMailboxState({
   *   id: 'mailbox-1',
   *   ticketId: 'ticket-1',
   *   channelId: 'channel-desk',
   *   state: 'ARCHIVED',
   * });
   */
  setMailboxState(data: {
    id: string;
    ticketId: string;
    channelId: string;
    state: MailboxState;
  }): Promise<void> {
    return this.call(ticketsOperations.setMailboxState, data);
  }

  /**
   * Star or unstar a desk ticket for the caller.
   *
   * @param data.id - Id of the mailbox row.
   * @param data.ticketId - Ticket being starred.
   * @param data.channelId - Desk channel it belongs to.
   * @param data.starred - Whether it is starred.
   * @example
   * await sdk.tickets.setMailboxStarred({
   *   id: 'mailbox-1',
   *   ticketId: 'ticket-1',
   *   channelId: 'channel-desk',
   *   starred: true,
   * });
   */
  setMailboxStarred(data: {
    id: string;
    ticketId: string;
    channelId: string;
    starred: boolean;
  }): Promise<void> {
    return this.call(ticketsOperations.setMailboxStarred, data);
  }

  /**
   * List the sub-tickets linked to a mapped ticket.
   *
   * @param mappedTicketId - The ticket the sub-tickets are mapped to.
   * @returns Its linked sub-tickets.
   * @example
   * const subs = await sdk.tickets.listSubTicketsByMapped('ticket-1');
   */
  listSubTicketsByMapped(mappedTicketId: string): Promise<SubTicket[]> {
    return this.call(ticketsOperations.listSubTicketsByMapped, { mappedTicketId });
  }

  /**
   * Get the single sub-ticket linked to a mapped ticket.
   *
   * @param mappedTicketId - The ticket the sub-ticket is mapped to.
   * @returns The sub-ticket, or `null` if there is none.
   * @example
   * const sub = await sdk.tickets.getSubTicketByMapped('ticket-1');
   */
  getSubTicketByMapped(mappedTicketId: string): Promise<SubTicket | null> {
    return this.call(ticketsOperations.getSubTicketByMapped, { mappedTicketId });
  }
}
