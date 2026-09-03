/**
 * Boards Resource
 *
 * Boards, stages, stage transitions, and SLA policies.
 */

import { Resource } from './base.js';
import { boardsOperations, type StageInput } from '../registry/boards.js';
import { newId } from '../core/ids.js';
import type {
  Board,
  BoardComplexityScore,
  BoardSlaPolicy,
  ChannelBoardMapping,
  FlowPlan,
  FormContextMapping,
  SavedView,
  Stage,
  StageTransition,
  StageTransitionInput,
  TicketPriority,
} from '../types/index.js';

export class BoardsResource extends Resource {
  /**
   * List every board in the workspace.
   *
   * @returns All boards, without their stages.
   * @example
   * const boards = await sdk.boards.list();
   */
  list(): Promise<Board[]> {
    return this.call(boardsOperations.list, undefined);
  }

  /**
   * List the boards in a project.
   *
   * @param projectId - Project to read.
   * @returns Its boards.
   * @example
   * const boards = await sdk.boards.listByProject('proj-1');
   */
  listByProject(projectId: string): Promise<Board[]> {
    return this.call(boardsOperations.listByProject, { projectId });
  }

  /**
   * The boards surfaced in a channel.
   *
   * Rows are `channel_board_mappings`, each with its `board` joined — a channel
   * can map to more than one. Use {@link listByProject} when you have a project
   * rather than a channel.
   *
   * @param channelId - Channel to read.
   * @returns One mapping per board the channel shows, each with its board joined.
   * @example
   * const mappings = await sdk.boards.listByChannel('channel-1');
   */
  listByChannel(channelId: string): Promise<ChannelBoardMapping[]> {
    return this.call(boardsOperations.listByChannel, { channelId });
  }

  /**
   * List a project's boards with only the fields a picker needs.
   *
   * @param projectId - Project to read.
   * @returns Its boards, identifying fields only.
   * @example
   * const options = await sdk.boards.listByProjectLite('proj-1');
   */
  listByProjectLite(projectId: string): Promise<Board[]> {
    return this.call(boardsOperations.listByProjectLite, { projectId });
  }

  /**
   * Get several boards by id in one call.
   *
   * @param boardIds - Ids to fetch. Unknown ids are skipped.
   * @returns The boards that exist.
   * @example
   * const boards = await sdk.boards.getMany(['board-1', 'board-2']);
   */
  getMany(boardIds: string[]): Promise<Board[]> {
    return this.call(boardsOperations.getMany, { boardIds });
  }

  /**
   * Get one board, without its stages.
   *
   * @param boardId - Id of the board.
   * @returns The board, or `null` if it does not exist.
   * @example
   * const board = await sdk.boards.get('board-1');
   */
  get(boardId: string): Promise<Board | null> {
    return this.call(boardsOperations.get, { boardId });
  }

  /**
   * Get a board with its stages resolved.
   *
   * @param boardId - Id of the board.
   * @returns The board including its stages, or `null`.
   * @example
   * const board = await sdk.boards.getDetail('board-1');
   */
  getDetail(boardId: string): Promise<Board | null> {
    return this.call(boardsOperations.getDetail, { boardId });
  }

  /**
   * Get a board with its stages, transitions and approvers resolved.
   *
   * The fullest read; use it when rendering a non-linear board's configuration.
   *
   * @param boardId - Id of the board.
   * @returns The board with everything joined, or `null`.
   * @example
   * const board = await sdk.boards.getFullDetail('board-1');
   */
  getFullDetail(boardId: string): Promise<Board | null> {
    return this.call(boardsOperations.getFullDetail, { boardId });
  }

  /**
   * List a board's stages, in sequence order.
   *
   * @param boardId - Id of the board.
   * @returns Its stages, ordered as they appear.
   * @example
   * const stages = await sdk.boards.listStages('board-1');
   */
  listStages(boardId: string): Promise<Stage[]> {
    return this.call(boardsOperations.listStages, { boardId });
  }

  /**
   * List stages across several boards in one call.
   *
   * @param boardIds - Boards to read.
   * @returns Stages for every board named.
   * @example
   * const stages = await sdk.boards.listStagesForBoards(['board-1', 'board-2']);
   */
  listStagesForBoards(boardIds: string[]): Promise<Stage[]> {
    return this.call(boardsOperations.listStagesForBoards, { boardIds });
  }

  /**
   * List stages for every board in a project.
   *
   * @param projectId - Project to read.
   * @param options.boardType - Restrict to boards of one type.
   * @returns Stages across the project's boards.
   * @example
   * const stages = await sdk.boards.listStagesByProject('proj-1');
   */
  listStagesByProject(projectId: string, options?: { boardType?: string }): Promise<Stage[]> {
    return this.call(boardsOperations.listStagesByProject, { projectId, ...options });
  }

  /**
   * List the permitted stage moves on a non-linear board.
   *
   * @param boardId - Id of the board.
   * @returns Its transitions, including approval and SLA behaviour.
   * @example
   * const transitions = await sdk.boards.listTransitions('board-1');
   */
  listTransitions(boardId: string): Promise<StageTransition[]> {
    return this.call(boardsOperations.listTransitions, { boardId });
  }

  /**
   * List stage transitions across several boards in one call.
   *
   * @param boardIds - Boards to read.
   * @returns Transitions for every board named.
   * @example
   * const transitions = await sdk.boards.listTransitionsForBoards(['board-1']);
   */
  listTransitionsForBoards(boardIds: string[]): Promise<StageTransition[]> {
    return this.call(boardsOperations.listTransitionsForBoards, { boardIds });
  }

  /**
   * List a board's SLA policies, one per priority.
   *
   * @param boardId - Id of the board.
   * @returns Its response and resolution targets.
   * @example
   * const policies = await sdk.boards.listSlaPolicies('board-1');
   */
  listSlaPolicies(boardId: string): Promise<BoardSlaPolicy[]> {
    return this.call(boardsOperations.listSlaPolicies, { boardId });
  }

  /**
   * List SLA policies across several boards in one call.
   *
   * @param boardIds - Boards to read.
   * @returns Policies for every board named.
   * @example
   * const policies = await sdk.boards.listSlaPoliciesForBoards(['board-1']);
   */
  listSlaPoliciesForBoards(boardIds: string[]): Promise<BoardSlaPolicy[]> {
    return this.call(boardsOperations.listSlaPoliciesForBoards, { boardIds });
  }

  /**
   * List the complexity weights a user group has assigned to boards.
   *
   * Used when routing work: a heavier board consumes more of a member's capacity.
   *
   * @param userGroupId - Group whose weights to read.
   * @returns One score per board the group works.
   * @example
   * const scores = await sdk.boards.listComplexityScores('group-1');
   */
  listComplexityScores(userGroupId: string): Promise<BoardComplexityScore[]> {
    return this.call(boardsOperations.listComplexityScores, { userGroupId });
  }

  /**
   * List the saved filter views defined on a board.
   *
   * @param boardId - Id of the board.
   * @returns Views scoped to that board.
   * @example
   * const views = await sdk.boards.listSavedViews('board-1');
   */
  listSavedViews(boardId: string): Promise<SavedView[]> {
    return this.call(boardsOperations.listSavedViews, { boardId });
  }

  /**
   * List which forms are bound to several boards.
   *
   * @param boardIds - Boards to read.
   * @returns Mappings bound to any of those boards.
   * @example
   * const mappings = await sdk.boards.listFormMappings(['board-1']);
   */
  listFormMappings(boardIds: string[]): Promise<FormContextMapping[]> {
    return this.call(boardsOperations.listFormMappings, { boardIds });
  }

  /**
   * Update a board.
   *
   * Passing `stages` replaces the entire stage list. Send every stage you want
   * to keep, each with its existing `id`; any stage you leave out is removed.
   * Read the current set with {@link listStages} first.
   *
   * @param boardId - Id of the board to change.
   * @param data - Fields to change; omitted fields are left alone.
   * @param data.name - New display name.
   * @param data.description - New description.
   * @param data.projectId - Move the board to another project.
   * @param data.boardType - New board type.
   * @param data.metadata - Board-specific settings, as JSON.
   * @param data.stages - The complete stage list to keep.
   * @example
   * await sdk.boards.update('board-1', { name: 'Platform' });
   */
  update(
    boardId: string,
    data: {
      name?: string;
      description?: string;
      projectId?: string;
      boardType?: string;
      metadata?: unknown;
      stages?: StageInput[];
    }
  ): Promise<void> {
    return this.call(boardsOperations.update, { boardId, ...data });
  }

  /**
   * Delete a board and its stages.
   *
   * @param boardId - Id of the board.
   * @example
   * await sdk.boards.delete('board-1');
   */
  delete(boardId: string): Promise<void> {
    return this.call(boardsOperations.delete, { boardId });
  }

  /**
   * Create or update a board's SLA policy for one priority.
   *
   * Omit `id` to create; pass an existing id to update.
   *
   * @param data - The policy to write.
   * @param data.id - Existing policy to update. Omit to create.
   * @param data.boardId - Board the policy applies to.
   * @param data.priority - Ticket priority it covers.
   * @param data.responseHours - Hours allowed before a first response.
   * @param data.resolutionHours - Hours allowed before resolution.
   * @param data.businessHoursOnly - Run the clock only during the working day below.
   * @param data.timezone - IANA timezone the working day is measured in.
   * @param data.workdayStart - Hour the working day starts, 0-23.
   * @param data.workdayEnd - Hour the working day ends, 1-24.
   * @param data.isActive - Whether the policy is enforced.
   * @returns The policy id, generated when creating.
   * @example
   * const { id } = await sdk.boards.upsertSlaPolicy({
   *   boardId: 'board-1',
   *   priority: 'HIGH',
   *   responseHours: 2,
   *   resolutionHours: 24,
   *   businessHoursOnly: true,
   *   timezone: 'Asia/Kolkata',
   *   workdayStart: 9,
   *   workdayEnd: 18,
   *   isActive: true,
   * });
   */
  async upsertSlaPolicy(data: {
    id?: string;
    boardId: string;
    priority: TicketPriority;
    responseHours: number;
    resolutionHours: number;
    businessHoursOnly: boolean;
    timezone: string;
    workdayStart: number;
    workdayEnd: number;
    isActive: boolean;
  }): Promise<{ id: string }> {
    const id = data.id ?? newId();
    await this.call(boardsOperations.upsertSlaPolicy, { ...data, id });
    return { id };
  }

  /**
   * Remove an SLA policy.
   *
   * @param id - Id of the policy.
   * @example
   * await sdk.boards.deleteSlaPolicy('policy-1');
   */
  deleteSlaPolicy(id: string): Promise<void> {
    return this.call(boardsOperations.deleteSlaPolicy, { id });
  }

  /**
   * Replace a non-linear board's transition graph.
   *
   * A wholesale replacement, like `update`'s handling of stages: send every
   * transition you want to keep, each with its existing `id`. Read the current
   * set with {@link listTransitions} first.
   *
   * @param boardId - Board whose graph to replace.
   * @param transitions - The complete transition set.
   * @example
   * await sdk.boards.syncTransitions('board-1', [
   *   { id: 't1', fromStageId: null, toStageId: 'stage-1' },
   * ]);
   */
  syncTransitions(boardId: string, transitions: StageTransitionInput[]): Promise<void> {
    return this.call(boardsOperations.syncTransitions, { boardId, transitions });
  }

  /**
   * Replace a flow board's plan — its step nodes, groups, and decision routing.
   *
   * A whole-plan **replace**, not a patch: any node absent from `plan.nodes` is
   * removed, along with the routing that pointed at it. Read the current plan,
   * edit it, and write the whole thing back.
   *
   * @param boardId - Board whose plan to replace.
   * @param plan - The complete flow plan.
   * @example
   * await sdk.boards.updateFlowPlan('board-1', {
   *   version: 2,
   *   nodes: [{ id: 'n1', title: 'Review', parentIds: [], order: 0 }],
   *   updatedAt: Date.now(),
   * });
   */
  updateFlowPlan(boardId: string, plan: FlowPlan): Promise<void> {
    return this.call(boardsOperations.updateFlowPlan, { boardId, plan });
  }
}
