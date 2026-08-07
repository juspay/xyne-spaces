/**
 * User Groups Operation Registry
 *
 * Teams: their membership, and the assignment configuration that decides which
 * member gets the next ticket — on-call state, board weights, and expertise.
 */

import { query, mutator } from './types.js';
import { now } from '../core/ids.js';

export const userGroupsOperations = {
  // ----- Reads -----

  /**
   * Every user group.
   * Maps to: Zero query 'getAllUserGroups'
   */
  list: query<void, unknown[]>('getAllUserGroups'),

  /**
   * Groups by id.
   * Maps to: Zero query 'getUserGroupsByIds'
   */
  getMany: query<{ groupIds: string[] }, unknown[]>('getUserGroupsByIds'),

  /**
   * One group.
   * Maps to: Zero query 'getUserGroupById'
   */
  get: query<{ userGroupId: string }, unknown>('getUserGroupById'),

  /**
   * Search groups by name.
   *
   * `limit` is required by the query and accepts null for no cap.
   * Maps to: Zero query 'searchUserGroups'
   */
  search: query<{ query: string; limit?: number }, unknown[]>('searchUserGroups', {
    mapArgs: (args) => ({ query: args.query, limit: args.limit ?? null }),
  }),

  /**
   * Members of a group.
   * Maps to: Zero query 'getUserGroupMembers'
   */
  listMembers: query<{ userGroupId: string }, unknown[]>('getUserGroupMembers'),

  /**
   * Members across several groups.
   * Maps to: Zero query 'getUserGroupMembersByGroupIds'
   */
  listMembersForGroups: query<{ userGroupIds: string[] }, unknown[]>(
    'getUserGroupMembersByGroupIds'
  ),

  /**
   * The current user's group memberships.
   * Maps to: Zero query 'getUserGroupMappingsByUserId'
   */
  listMine: query<void, unknown[]>('getUserGroupMappingsByUserId'),

  /**
   * On-call and availability state for a group's members.
   * Maps to: Zero query 'getUserAssignmentStates'
   */
  listAssignmentStates: query<{ userGroupId: string }, unknown[]>(
    'getUserAssignmentStates'
  ),

  /**
   * One user's assignment state across their groups.
   * Maps to: Zero query 'getUserAssignmentStatesByUserId'
   */
  getAssignmentStateForUser: query<{ userId: string }, unknown[]>(
    'getUserAssignmentStatesByUserId'
  ),

  /**
   * Which members of a group have expertise on a board.
   * Maps to: Zero query 'getUserExpertiseMappings'
   */
  listExpertise: query<{ userGroupId: string; boardId: string }, unknown[]>(
    'getUserExpertiseMappings'
  ),

  // ----- Writes -----

  /**
   * Rename a group, or change members' roles and responsibilities.
   *
   * `userRoleUpdates` and `userResponsibilityUpdates` are maps keyed by user id.
   * Maps to: Zero mutator 'userGroup.update'
   */
  update: mutator<
    {
      userGroupId: string;
      name?: string;
      alias?: string;
      description?: string;
      userRoleUpdates?: Record<string, string>;
      userResponsibilityUpdates?: Record<string, string>;
    },
    void
  >('userGroup.update', {
    mapArgs: (args) => ({ ...args, timestamp: now() }),
  }),

  /**
   * Delete a group.
   * Maps to: Zero mutator 'userGroup.delete'
   */
  delete: mutator<{ userGroupId: string }, void>('userGroup.delete'),

  /**
   * Deactivate a group without deleting it — it stops receiving assignments.
   * Maps to: Zero mutator 'userGroup.deactivate'
   */
  deactivate: mutator<{ userGroupId: string }, void>('userGroup.deactivate'),

  /**
   * Reactivate a group.
   * Maps to: Zero mutator 'userGroup.reactivate'
   */
  reactivate: mutator<{ userGroupId: string }, void>('userGroup.reactivate'),

  /**
   * Add users to a group.
   * Maps to: Zero mutator 'userGroup.addUsers'
   */
  addUsers: mutator<
    { userGroupId: string; userIds: string[]; mappingIds: Record<string, string>; roleIds?: string[] },
    void
  >('userGroup.addUsers', {
    mapArgs: (args) => ({ ...args, timestamp: now() }),
  }),

  /**
   * Remove users from a group.
   * Maps to: Zero mutator 'userGroup.removeUsers'
   */
  removeUsers: mutator<{ userGroupId: string; userIds: string[] }, void>(
    'userGroup.removeUsers'
  ),

  // ----- Assignment configuration -----

  /**
   * Update on-call state, board weights, and expertise for a group in one go.
   *
   * The shapes here are nested and interdependent, so they are passed through
   * rather than modelled: read the current configuration first and send it back
   * modified.
   * Maps to: Zero mutator 'assignmentConfig.batchUpdate'
   */
  updateAssignmentConfig: mutator<
    {
      userGroupId: string;
      userStates: unknown;
      userMappings: unknown;
      boardWeight: unknown;
      expertiseMappings: unknown;
      stateIds?: unknown;
      complexityScoreId?: string;
      mappingIds?: unknown;
    },
    void
  >('assignmentConfig.batchUpdate', {
    mapArgs: (args) => ({ ...args, timestamp: now() }),
  }),

  /**
   * Turn automatic on-call rotation on or off for a group.
   * Maps to: Zero mutator 'assignmentConfig.toggleGroupAutoRotation'
   */
  toggleAutoRotation: mutator<
    {
      userGroupId: string;
      autoRotationEnabled: boolean;
      rotationInterval?: number;
      rotationStartDate?: number;
    },
    void
  >('assignmentConfig.toggleGroupAutoRotation', {
    mapArgs: (args) => ({ ...args, timestamp: now() }),
  }),
} as const;
