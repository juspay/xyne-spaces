/**
 * Boards Operation Registry
 *
 * Boards, their stages, stage transitions, and SLA policies.
 *
 * Tickets reference a stage by `stageName`, not by stage id, so stage renames
 * are meaningful operations rather than cosmetic ones.
 */

import { query, mutator } from './types.js';
import { now } from '../core/ids.js';
import type { Board, FlowPlan, Stage, TicketPriority, TicketStatusV2 } from '../types/index.js';

/** A stage as accepted by `board.update`, which replaces the whole stage list. */
export interface StageInput {
  /** Omit to create a new stage; pass an existing id to update it. */
  id?: string;
  name: string;
  sequenceNumber: number;
  eta?: number;
  defaultTicketStatusV2?: TicketStatusV2;
  formId?: string;
  requestApprovalOnEntry?: boolean;
  approverIds?: string[];
  approvers?: Array<{ approverId: string; approverType: 'USER' | 'ROLE' }>;
}

export const boardsOperations = {
  // ----- Reads -----

  /**
   * Every board in the workspace.
   * Maps to: Zero query 'getAllBoards'
   */
  list: query<void, Board[]>('getAllBoards'),

  /**
   * Boards in a project.
   * Maps to: Zero query 'boardsByProject'
   */
  listByProject: query<{ projectId: string }, Board[]>('boardsByProject'),

  /**
   * Boards in a project, id and name only — for pickers.
   * Maps to: Zero query 'boardsListByProject'
   */
  listByProjectLite: query<{ projectId: string }, Board[]>('boardsListByProject'),

  /**
   * Boards by id.
   * Maps to: Zero query 'boardsByIds'
   */
  getMany: query<{ boardIds: string[] }, Board[]>('boardsByIds'),

  /**
   * One board.
   * Maps to: Zero query 'getBoardById'
   */
  get: query<{ boardId: string }, Board | null>('getBoardById'),

  /**
   * One board with its stages.
   * Maps to: Zero query 'boardDetailById'
   */
  getDetail: query<{ boardId: string }, Board | null>('boardDetailById'),

  /**
   * One board with stages, transitions, and approvers resolved.
   * Maps to: Zero query 'boardFullDetailById'
   */
  getFullDetail: query<{ boardId: string }, Board | null>('boardFullDetailById'),

  /**
   * Stages of a board, in sequence order.
   * Maps to: Zero query 'stagesByBoard'
   */
  listStages: query<{ boardId: string }, Stage[]>('stagesByBoard'),

  /**
   * Stages across several boards.
   * Maps to: Zero query 'getStagesByBoardIds'
   */
  listStagesForBoards: query<{ boardIds: string[] }, Stage[]>('getStagesByBoardIds'),

  /**
   * Stages for every board in a project, optionally of one board type.
   * Maps to: Zero query 'stagesByBoards'
   */
  listStagesByProject: query<{ projectId: string; boardType?: string }, Stage[]>(
    'stagesByBoards'
  ),

  /**
   * The boards mapped to a channel, with each board joined in.
   * Maps to: Zero query 'boardsByChannel'
   *
   * Reads `channel_board_mappings`, not `boards`, so a row is the mapping and
   * the board hangs off its `board` relation. A channel can surface more than
   * one board; ordering is by when the mapping was made.
   */
  listByChannel: query<{ channelId: string }, unknown[]>('boardsByChannel'),

  /**
   * Allowed stage transitions on a non-linear board.
   * Maps to: Zero query 'getStageTransitionsByBoardId'
   */
  listTransitions: query<{ boardId: string }, unknown[]>('getStageTransitionsByBoardId'),

  /**
   * Stage transitions across several boards.
   * Maps to: Zero query 'getStageTransitionsByBoardIds'
   */
  listTransitionsForBoards: query<{ boardIds: string[] }, unknown[]>(
    'getStageTransitionsByBoardIds'
  ),

  /**
   * SLA policies on a board, one per priority.
   * Maps to: Zero query 'getBoardSlaPolicies'
   */
  listSlaPolicies: query<{ boardId: string }, unknown[]>('getBoardSlaPolicies'),

  /**
   * SLA policies across several boards.
   * Maps to: Zero query 'getBoardSlaPoliciesByBoardIds'
   */
  listSlaPoliciesForBoards: query<{ boardIds: string[] }, unknown[]>(
    'getBoardSlaPoliciesByBoardIds'
  ),

  /**
   * Complexity scores a user group has assigned to boards.
   * Maps to: Zero query 'getBoardComplexityScores'
   */
  listComplexityScores: query<{ userGroupId: string }, unknown[]>(
    'getBoardComplexityScores'
  ),

  /**
   * Saved filter views on a board.
   * Maps to: Zero query 'savedConfigsByBoard'
   */
  listSavedViews: query<{ boardId: string }, unknown[]>('savedConfigsByBoard'),

  /**
   * Form mappings for several boards.
   * Maps to: Zero query 'getFormMappingsByBoardIds'
   */
  listFormMappings: query<{ boardIds: string[] }, unknown[]>('getFormMappingsByBoardIds'),

  // ----- Writes -----

  /**
   * Update a board.
   *
   * When `stages` is supplied it replaces the board's stage list wholesale, so
   * send the complete set — including stages you are not changing, with their
   * existing ids — or they will be removed.
   * Maps to: Zero mutator 'board.update'
   */
  update: mutator<
    {
      boardId: string;
      name?: string;
      description?: string;
      projectId?: string;
      boardType?: string;
      metadata?: unknown;
      stages?: StageInput[];
    },
    void
  >('board.update', {
    mapArgs: (args) => ({ ...args, timestamp: now() }),
  }),

  /**
   * Delete a board.
   * Maps to: Zero mutator 'board.delete'
   */
  delete: mutator<{ boardId: string }, void>('board.delete'),

  /**
   * Create or update a board's SLA policy for one priority.
   * Maps to: Zero mutator 'boardSlaPolicy.upsert'
   */
  upsertSlaPolicy: mutator<
    {
      id: string;
      boardId: string;
      priority: TicketPriority;
      responseHours: number;
      resolutionHours: number;
      businessHoursOnly: boolean;
      timezone: string;
      workdayStart: string;
      workdayEnd: string;
      isActive: boolean;
    },
    void
  >('boardSlaPolicy.upsert'),

  /**
   * Remove an SLA policy.
   * Maps to: Zero mutator 'boardSlaPolicy.delete'
   */
  deleteSlaPolicy: mutator<{ id: string }, void>('boardSlaPolicy.delete'),

  /**
   * Replace a non-linear board's transition graph.
   * Maps to: Zero mutator 'nonLinear.syncTransitions'
   */
  syncTransitions: mutator<
    { boardId: string; transitions: unknown[] },
    void
  >('nonLinear.syncTransitions', {
    // This mutator names its clock argument `now`, unlike the `timestamp` used
    // elsewhere in the catalog.
    mapArgs: (args) => ({
      boardId: args.boardId,
      transitions: args.transitions,
      now: now(),
    }),
  }),

  /**
   * Replace a flow board's plan — its nodes, groups, and decision routing.
   * Maps to: Zero mutator 'board.updateFlowPlan'
   *
   * A whole-plan replace, not a patch: anything absent from `plan.nodes` is
   * removed. Read the current plan first and edit it.
   */
  updateFlowPlan: mutator<{ boardId: string; plan: FlowPlan }, void>(
    'board.updateFlowPlan',
    {
      mapArgs: (args) => ({
        boardId: args.boardId,
        plan: args.plan,
        timestamp: now(),
      }),
    }
  ),
} as const;
