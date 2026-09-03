/**
 * User Groups Operation Registry
 *
 * Teams: their membership, and the assignment configuration that decides which
 * member gets the next ticket — on-call state, board weights, and expertise.
 */

import { op } from './types.js';
import type {
  RotationInterval,
  UserAssignmentState,
  UserExpertiseMapping,
  UserGroup,
  UserGroupMember,
  UserWorkloadMapping,
} from '../types/index.js';

export const userGroupsOperations = {
  // ----- Reads -----

  /**
   * Every user group.
   */
  list: op<void, UserGroup[]>('userGroups.list', 'query'),

  /**
   * Groups by id.
   */
  getMany: op<{ groupIds: string[] }, UserGroup[]>('userGroups.getMany', 'query'),

  /**
   * One group.
   */
  get: op<{ userGroupId: string }, UserGroup | null>('userGroups.get', 'query'),

  /**
   * Search groups by name.
   *
   * `limit` is required by the query and accepts null for no cap.
   */
  search: op<{ query: string; limit?: number }, UserGroup[]>('userGroups.search', 'query'),

  /**
   * Members of a group.
   */
  listMembers: op<{ userGroupId: string }, UserGroupMember[]>('userGroups.listMembers', 'query'),

  /**
   * Members across several groups.
   */
  listMembersForGroups: op<{ userGroupIds: string[] }, UserGroupMember[]>('userGroups.listMembersForGroups', 'query'),

  /**
   * The current user's group memberships.
   */
  listMine: op<void, UserGroupMember[]>('userGroups.listMine', 'query'),

  /**
   * On-call and availability state for a group's members.
   */
  listAssignmentStates: op<{ userGroupId: string }, UserAssignmentState[]>('userGroups.listAssignmentStates', 'query'),

  /**
   * Assignment states for several groups at once.
   */
  listAssignmentStatesForGroups: op<{ userGroupIds: string[] }, UserAssignmentState[]>('userGroups.listAssignmentStatesForGroups', 'query'),

  /**
   * Per-member workload weightings for a group.
   *
   * Feeds the same assignment routing as `listAssignmentStates`: availability says
   * who *can* take work, this says how much each of them is carrying.
   */
  listWorkloadMappings: op<{ userGroupId: string }, UserWorkloadMapping[]>('userGroups.listWorkloadMappings', 'query'),

  /**
   * One user's assignment state across their groups.
   */
  getAssignmentStateForUser: op<{ userId: string }, UserAssignmentState[]>('userGroups.getAssignmentStateForUser', 'query'),

  /**
   * Which members of a group have expertise on a board.
   */
  listExpertise: op<{ userGroupId: string; boardId: string }, UserExpertiseMapping[]>('userGroups.listExpertise', 'query'),

  // ----- Writes -----

  /**
   * Rename a group, or change members' roles and responsibilities.
   *
   * `userRoleUpdates` and `userResponsibilityUpdates` are maps keyed by user id.
   */
  update: op<{
      userGroupId: string;
      name?: string;
      alias?: string;
      description?: string;
      userRoleUpdates?: Record<string, string>;
      userResponsibilityUpdates?: Record<string, string>;
    }, void>('userGroups.update', 'mutator'),

  /**
   * Delete a group.
   */
  delete: op<{ userGroupId: string }, void>('userGroups.delete', 'mutator'),

  /**
   * Deactivate a group without deleting it — it stops receiving assignments.
   */
  deactivate: op<{ userGroupId: string }, void>('userGroups.deactivate', 'mutator'),

  /**
   * Reactivate a group.
   */
  reactivate: op<{ userGroupId: string }, void>('userGroups.reactivate', 'mutator'),

  /**
   * Add users to a group.
   */
  addUsers: op<{ userGroupId: string; userIds: string[]; mappingIds: Record<string, string>; roleIds?: string[] }, void>('userGroups.addUsers', 'mutator'),

  /**
   * Remove users from a group.
   */
  removeUsers: op<{ userGroupId: string; userIds: string[] }, void>('userGroups.removeUsers', 'mutator'),

  // ----- Assignment configuration -----

  /**
   * Update on-call state, board weights, and expertise for a group in one go.
   *
   * The shapes here are nested and interdependent, so they are passed through
   * rather than modelled: read the current configuration first and send it back
   * modified.
   */
  updateAssignmentConfig: op<{
      userGroupId: string;
      userStates: unknown;
      userMappings: unknown;
      boardWeight: unknown;
      expertiseMappings: unknown;
      stateIds?: unknown;
      complexityScoreId?: string;
      mappingIds?: unknown;
    }, void>('userGroups.updateAssignmentConfig', 'mutator'),

  /**
   * Turn automatic on-call rotation on or off for a group.
   */
  toggleAutoRotation: op<{
      userGroupId: string;
      autoRotationEnabled: boolean;
      rotationInterval?: RotationInterval;
      rotationStartDate?: number;
    }, void>('userGroups.toggleAutoRotation', 'mutator'),
} as const;
