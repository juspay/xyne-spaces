/**
 * Boards Operation Registry
 *
 * Boards, their stages, stage transitions, and SLA policies.
 *
 * Tickets reference a stage by `stageName`, not by stage id, so stage renames
 * are meaningful operations rather than cosmetic ones.
 */

import { op } from './types.js';
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
  TicketStatusV2,
} from '../types/index.js';

/** A stage as accepted by {@link boardsOperations.update}, which replaces the whole stage list. */
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
   */
  list: op<void, Board[]>('boards.list', 'query'),

  /**
   * Boards in a project.
   */
  listByProject: op<{ projectId: string }, Board[]>('boards.listByProject', 'query'),

  /**
   * Boards in a project, id and name only — for pickers.
   */
  listByProjectLite: op<{ projectId: string }, Board[]>('boards.listByProjectLite', 'query'),

  /**
   * Boards by id.
   */
  getMany: op<{ boardIds: string[] }, Board[]>('boards.getMany', 'query'),

  /**
   * One board.
   */
  get: op<{ boardId: string }, Board | null>('boards.get', 'query'),

  /**
   * One board with its stages.
   */
  getDetail: op<{ boardId: string }, Board | null>('boards.getDetail', 'query'),

  /**
   * One board with stages, transitions, and approvers resolved.
   */
  getFullDetail: op<{ boardId: string }, Board | null>('boards.getFullDetail', 'query'),

  /**
   * Stages of a board, in sequence order.
   */
  listStages: op<{ boardId: string }, Stage[]>('boards.listStages', 'query'),

  /**
   * Stages across several boards.
   */
  listStagesForBoards: op<{ boardIds: string[] }, Stage[]>('boards.listStagesForBoards', 'query'),

  /**
   * Stages for every board in a project, optionally of one board type.
   */
  listStagesByProject: op<{ projectId: string; boardType?: string }, Stage[]>('boards.listStagesByProject', 'query'),

  /**
   * The boards mapped to a channel, with each board joined in.
   *
   * Reads `channel_board_mappings`, not `boards`, so a row is the mapping and
   * the board hangs off its `board` relation. A channel can surface more than
   * one board; ordering is by when the mapping was made.
   */
  listByChannel: op<{ channelId: string }, ChannelBoardMapping[]>('boards.listByChannel', 'query'),

  /**
   * Allowed stage transitions on a non-linear board.
   */
  listTransitions: op<{ boardId: string }, StageTransition[]>('boards.listTransitions', 'query'),

  /**
   * Stage transitions across several boards.
   */
  listTransitionsForBoards: op<{ boardIds: string[] }, StageTransition[]>('boards.listTransitionsForBoards', 'query'),

  /**
   * SLA policies on a board, one per priority.
   */
  listSlaPolicies: op<{ boardId: string }, BoardSlaPolicy[]>('boards.listSlaPolicies', 'query'),

  /**
   * SLA policies across several boards.
   */
  listSlaPoliciesForBoards: op<{ boardIds: string[] }, BoardSlaPolicy[]>('boards.listSlaPoliciesForBoards', 'query'),

  /**
   * Complexity scores a user group has assigned to boards.
   */
  listComplexityScores: op<{ userGroupId: string }, BoardComplexityScore[]>('boards.listComplexityScores', 'query'),

  /**
   * Saved filter views on a board.
   */
  listSavedViews: op<{ boardId: string }, SavedView[]>('boards.listSavedViews', 'query'),

  /**
   * Form mappings for several boards.
   */
  listFormMappings: op<{ boardIds: string[] }, FormContextMapping[]>('boards.listFormMappings', 'query'),

  // ----- Writes -----

  /**
   * Update a board.
   *
   * When `stages` is supplied it replaces the board's stage list wholesale, so
   * send the complete set — including stages you are not changing, with their
   * existing ids — or they will be removed.
   */
  update: op<{
      boardId: string;
      name?: string;
      description?: string;
      projectId?: string;
      boardType?: string;
      metadata?: unknown;
      stages?: StageInput[];
    }, void>('boards.update', 'mutator'),

  /**
   * Delete a board.
   */
  delete: op<{ boardId: string }, void>('boards.delete', 'mutator'),

  /**
   * Create or update a board's SLA policy for one priority.
   */
  upsertSlaPolicy: op<{
      id: string;
      boardId: string;
      priority: TicketPriority;
      responseHours: number;
      resolutionHours: number;
      businessHoursOnly: boolean;
      timezone: string;
      workdayStart: number;
      workdayEnd: number;
      isActive: boolean;
    }, void>('boards.upsertSlaPolicy', 'mutator'),

  /**
   * Remove an SLA policy.
   */
  deleteSlaPolicy: op<{ id: string }, void>('boards.deleteSlaPolicy', 'mutator'),

  /**
   * Replace a non-linear board's transition graph.
   */
  syncTransitions: op<{ boardId: string; transitions: StageTransitionInput[] }, void>('boards.syncTransitions', 'mutator'),

  /**
   * Replace a flow board's plan — its nodes, groups, and decision routing.
   *
   * A whole-plan replace, not a patch: anything absent from `plan.nodes` is
   * removed. Read the current plan first and edit it.
   */
  updateFlowPlan: op<{ boardId: string; plan: FlowPlan }, void>('boards.updateFlowPlan', 'mutator'),
} as const;
