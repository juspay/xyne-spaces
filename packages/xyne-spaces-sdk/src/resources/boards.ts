/**
 * Boards Resource
 *
 * Boards, stages, stage transitions, and SLA policies.
 */

import { Resource } from './base.js';
import { boardsOperations, type StageInput } from '../registry/boards.js';
import { newId } from '../core/ids.js';
import type { Board, Stage, TicketPriority } from '../types/index.js';

export class BoardsResource extends Resource {
  /** List every board in the workspace. */
  list(): Promise<Board[]> {
    return this.call(boardsOperations.list, undefined);
  }

  /** List the boards in a project. */
  listByProject(projectId: string): Promise<Board[]> {
    return this.call(boardsOperations.listByProject, { projectId });
  }

  /** List a project's boards with only the fields a picker needs. */
  listByProjectLite(projectId: string): Promise<Board[]> {
    return this.call(boardsOperations.listByProjectLite, { projectId });
  }

  /** Get several boards by id. */
  getMany(boardIds: string[]): Promise<Board[]> {
    return this.call(boardsOperations.getMany, { boardIds });
  }

  /** Get one board. */
  get(boardId: string): Promise<Board | null> {
    return this.call(boardsOperations.get, { boardId });
  }

  /** Get a board with its stages. */
  getDetail(boardId: string): Promise<Board | null> {
    return this.call(boardsOperations.getDetail, { boardId });
  }

  /** Get a board with stages, transitions, and approvers resolved. */
  getFullDetail(boardId: string): Promise<Board | null> {
    return this.call(boardsOperations.getFullDetail, { boardId });
  }

  /**
   * List a board's stages, in sequence order.
   *
   * @example
   * const stages = await sdk.boards.listStages('board-1');
   */
  listStages(boardId: string): Promise<Stage[]> {
    return this.call(boardsOperations.listStages, { boardId });
  }

  /** List stages across several boards. */
  listStagesForBoards(boardIds: string[]): Promise<Stage[]> {
    return this.call(boardsOperations.listStagesForBoards, { boardIds });
  }

  /** List stages for every board in a project. */
  listStagesByProject(projectId: string, options?: { boardType?: string }): Promise<Stage[]> {
    return this.call(boardsOperations.listStagesByProject, { projectId, ...options });
  }

  /** List the allowed stage transitions on a non-linear board. */
  listTransitions(boardId: string): Promise<unknown[]> {
    return this.call(boardsOperations.listTransitions, { boardId });
  }

  /** List stage transitions across several boards. */
  listTransitionsForBoards(boardIds: string[]): Promise<unknown[]> {
    return this.call(boardsOperations.listTransitionsForBoards, { boardIds });
  }

  /** List a board's SLA policies. */
  listSlaPolicies(boardId: string): Promise<unknown[]> {
    return this.call(boardsOperations.listSlaPolicies, { boardId });
  }

  /** List SLA policies across several boards. */
  listSlaPoliciesForBoards(boardIds: string[]): Promise<unknown[]> {
    return this.call(boardsOperations.listSlaPoliciesForBoards, { boardIds });
  }

  /** List the complexity scores a user group has assigned to boards. */
  listComplexityScores(userGroupId: string): Promise<unknown[]> {
    return this.call(boardsOperations.listComplexityScores, { userGroupId });
  }

  /** List saved filter views on a board. */
  listSavedViews(boardId: string): Promise<unknown[]> {
    return this.call(boardsOperations.listSavedViews, { boardId });
  }

  /** List form mappings for several boards. */
  listFormMappings(boardIds: string[]): Promise<unknown[]> {
    return this.call(boardsOperations.listFormMappings, { boardIds });
  }

  /**
   * Update a board.
   *
   * Passing `stages` replaces the entire stage list. Send every stage you want
   * to keep, each with its existing `id`; any stage you leave out is removed.
   * Read the current set with `listStages` first.
   *
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

  /** Delete a board. */
  delete(boardId: string): Promise<void> {
    return this.call(boardsOperations.delete, { boardId });
  }

  /**
   * Create or update a board's SLA policy for one priority.
   *
   * Omit `id` to create; pass an existing id to update.
   *
   * @returns The policy id
   */
  async upsertSlaPolicy(data: {
    id?: string;
    boardId: string;
    priority: TicketPriority;
    responseHours: number;
    resolutionHours: number;
    businessHoursOnly: boolean;
    timezone: string;
    workdayStart: string;
    workdayEnd: string;
    isActive: boolean;
  }): Promise<{ id: string }> {
    const id = data.id ?? newId();
    await this.call(boardsOperations.upsertSlaPolicy, { ...data, id });
    return { id };
  }

  /** Remove an SLA policy. */
  deleteSlaPolicy(id: string): Promise<void> {
    return this.call(boardsOperations.deleteSlaPolicy, { id });
  }

  /**
   * Replace a non-linear board's transition graph.
   *
   * Like `update`'s stage handling, this is a wholesale replacement.
   */
  syncTransitions(boardId: string, transitions: unknown[]): Promise<void> {
    return this.call(boardsOperations.syncTransitions, { boardId, transitions });
  }
}
