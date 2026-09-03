/**
 * User Groups Resource
 *
 * Teams, their membership, and the configuration that routes work to them.
 */

import { Resource } from './base.js';
import { userGroupsOperations } from '../registry/user-groups.js';
import { newIdMap } from '../core/ids.js';
import type {
  RotationInterval,
  UserAssignmentState,
  UserExpertiseMapping,
  UserGroup,
  UserGroupMember,
  UserWorkloadMapping,
} from '../types/index.js';

export class UserGroupsResource extends Resource {
  /**
   * List every user group in the workspace.
   *
   * @returns All groups, active and inactive.
   * @example
   * const groups = await sdk.userGroups.list();
   */
  list(): Promise<UserGroup[]> {
    return this.call(userGroupsOperations.list, undefined);
  }

  /**
   * Get several groups by id in one call.
   *
   * @param groupIds - Ids to fetch. Unknown ids are skipped.
   * @returns The groups that exist.
   * @example
   * const groups = await sdk.userGroups.getMany(['group-1', 'group-2']);
   */
  getMany(groupIds: string[]): Promise<UserGroup[]> {
    return this.call(userGroupsOperations.getMany, { groupIds });
  }

  /**
   * Get one group.
   *
   * @param userGroupId - Id of the group.
   * @returns The group, or `null` if it does not exist.
   * @example
   * const group = await sdk.userGroups.get('group-1');
   */
  get(userGroupId: string): Promise<UserGroup | null> {
    return this.call(userGroupsOperations.get, { userGroupId });
  }

  /**
   * Search groups by name.
   *
   * @param query - Text to match against group names.
   * @param options.limit - Maximum groups to return.
   * @returns Matching groups.
   * @example
   * const groups = await sdk.userGroups.search('platform', { limit: 10 });
   */
  search(query: string, options?: { limit?: number }): Promise<UserGroup[]> {
    return this.call(userGroupsOperations.search, { query, ...options });
  }

  /**
   * List a group's members.
   *
   * @param userGroupId - Id of the group.
   * @returns One membership row per member, with their responsibility and rotation position.
   * @example
   * const members = await sdk.userGroups.listMembers('group-1');
   */
  listMembers(userGroupId: string): Promise<UserGroupMember[]> {
    return this.call(userGroupsOperations.listMembers, { userGroupId });
  }

  /**
   * List members across several groups in one call.
   *
   * @param userGroupIds - Groups to read.
   * @returns Membership rows for every group named.
   * @example
   * const members = await sdk.userGroups.listMembersForGroups(['group-1', 'group-2']);
   */
  listMembersForGroups(userGroupIds: string[]): Promise<UserGroupMember[]> {
    return this.call(userGroupsOperations.listMembersForGroups, { userGroupIds });
  }

  /**
   * List the calling user's own group memberships.
   *
   * @returns The caller's membership rows.
   * @example
   * const mine = await sdk.userGroups.listMine();
   */
  listMine(): Promise<UserGroupMember[]> {
    return this.call(userGroupsOperations.listMine, undefined);
  }

  /**
   * Rename a group, or change members' roles and responsibilities.
   *
   * @param userGroupId - Id of the group to change.
   * @param data - Fields to change; omitted fields are left alone.
   * @param data.name - New display name.
   * @param data.alias - New short handle.
   * @param data.description - New description.
   * @param data.userRoleUpdates - New role id per user id.
   * @param data.userResponsibilityUpdates - New responsibility per user id.
   * @example
   * await sdk.userGroups.update('group-1', { name: 'Platform On-Call' });
   */
  update(
    userGroupId: string,
    data: {
      name?: string;
      alias?: string;
      description?: string;
      userRoleUpdates?: Record<string, string>;
      userResponsibilityUpdates?: Record<string, string>;
    }
  ): Promise<void> {
    return this.call(userGroupsOperations.update, { userGroupId, ...data });
  }

  /**
   * Delete a group.
   *
   * @param userGroupId - Id of the group to delete.
   * @example
   * await sdk.userGroups.delete('group-1');
   */
  delete(userGroupId: string): Promise<void> {
    return this.call(userGroupsOperations.delete, { userGroupId });
  }

  /**
   * Deactivate a group so it stops receiving assignments.
   *
   * The group and its membership survive; only routing stops.
   *
   * @param userGroupId - Id of the group to deactivate.
   * @example
   * await sdk.userGroups.deactivate('group-1');
   */
  deactivate(userGroupId: string): Promise<void> {
    return this.call(userGroupsOperations.deactivate, { userGroupId });
  }

  /**
   * Reactivate a group so it receives assignments again.
   *
   * @param userGroupId - Id of the group to reactivate.
   * @example
   * await sdk.userGroups.reactivate('group-1');
   */
  reactivate(userGroupId: string): Promise<void> {
    return this.call(userGroupsOperations.reactivate, { userGroupId });
  }

  /**
   * Add users to a group.
   *
   * @param userGroupId - Group to add them to.
   * @param userIds - Users to add.
   * @param options.roleIds - Role to give each user, positionally matching `userIds`.
   * @returns The new membership ids, keyed by user id.
   * @example
   * const { mappingIds } = await sdk.userGroups.addUsers('group-1', ['user-1']);
   */
  async addUsers(
    userGroupId: string,
    userIds: string[],
    options?: { roleIds?: string[] }
  ): Promise<{ mappingIds: Record<string, string> }> {
    const mappingIds = newIdMap(userIds);
    await this.call(userGroupsOperations.addUsers, {
      userGroupId,
      userIds,
      mappingIds,
      ...options,
    });
    return { mappingIds };
  }

  /**
   * Remove users from a group.
   *
   * @param userGroupId - Group to remove them from.
   * @param userIds - Users to remove.
   * @example
   * await sdk.userGroups.removeUsers('group-1', ['user-1']);
   */
  removeUsers(userGroupId: string, userIds: string[]): Promise<void> {
    return this.call(userGroupsOperations.removeUsers, { userGroupId, userIds });
  }

  // ----- Assignment routing -----

  /**
   * List on-call and availability state for a group's members.
   *
   * @param userGroupId - Id of the group.
   * @returns One state row per member, saying who is on call and taking work.
   * @example
   * const states = await sdk.userGroups.listAssignmentStates('group-1');
   */
  listAssignmentStates(userGroupId: string): Promise<UserAssignmentState[]> {
    return this.call(userGroupsOperations.listAssignmentStates, { userGroupId });
  }
  /**
   * Assignment states for several groups at once.
   *
   * The batch form of {@link listAssignmentStates}; one round trip instead of one
   * per group when rendering a roster.
   *
   * @param userGroupIds - Groups to read.
   * @returns State rows across every group named.
   * @example
   * const states = await sdk.userGroups.listAssignmentStatesForGroups(['group-1']);
   */
  listAssignmentStatesForGroups(userGroupIds: string[]): Promise<UserAssignmentState[]> {
    return this.call(userGroupsOperations.listAssignmentStatesForGroups, { userGroupIds });
  }


  /**
   * List per-member workload weightings for a group.
   *
   * Pairs with `listAssignmentStates`: that says who is available, this says how
   * much work each of them already holds.
   *
   * @param userGroupId - Id of the group.
   * @returns Per-member, per-board counts of active and total assignments.
   * @example
   * const workload = await sdk.userGroups.listWorkloadMappings('group-1');
   */
  listWorkloadMappings(userGroupId: string): Promise<UserWorkloadMapping[]> {
    return this.call(userGroupsOperations.listWorkloadMappings, { userGroupId });
  }

  /**
   * Get one user's assignment state across every group they belong to.
   *
   * @param userId - Id of the user.
   * @returns One state row per group the user is in.
   * @example
   * const states = await sdk.userGroups.getAssignmentStateForUser('user-1');
   */
  getAssignmentStateForUser(userId: string): Promise<UserAssignmentState[]> {
    return this.call(userGroupsOperations.getAssignmentStateForUser, { userId });
  }

  /**
   * List which members of a group have expertise on a board.
   *
   * @param userGroupId - Id of the group.
   * @param boardId - Board the expertise applies to.
   * @returns One row per member, with their share and ticket cap for that board.
   * @example
   * const expertise = await sdk.userGroups.listExpertise('group-1', 'board-1');
   */
  listExpertise(userGroupId: string, boardId: string): Promise<UserExpertiseMapping[]> {
    return this.call(userGroupsOperations.listExpertise, { userGroupId, boardId });
  }

  /**
   * Update a group's assignment configuration — on-call state, board weights,
   * and expertise — in one call.
   *
   * The nested shapes are passed through rather than modelled, because they are
   * interdependent. Read the current configuration with `listAssignmentStates`
   * and `listExpertise` first, then send it back modified.
   *
   * @param data - The whole configuration for one group.
   * @param data.userGroupId - Group being configured.
   * @param data.userStates - On-call and availability per member.
   * @param data.userMappings - Membership rows, including rotation positions.
   * @param data.boardWeight - How work is split across boards.
   * @param data.expertiseMappings - Per-member expertise per board.
   * @param data.stateIds - Ids of existing state rows being updated.
   * @param data.complexityScoreId - Complexity score this configuration uses.
   * @param data.mappingIds - Ids of existing membership rows being updated.
   * @example
   * await sdk.userGroups.updateAssignmentConfig({
   *   userGroupId: 'group-1',
   *   userStates,
   *   userMappings,
   *   boardWeight,
   *   expertiseMappings,
   * });
   */
  updateAssignmentConfig(data: {
    userGroupId: string;
    userStates: unknown;
    userMappings: unknown;
    boardWeight: unknown;
    expertiseMappings: unknown;
    stateIds?: unknown;
    complexityScoreId?: string;
    mappingIds?: unknown;
  }): Promise<void> {
    return this.call(userGroupsOperations.updateAssignmentConfig, data);
  }

  /**
   * Turn automatic on-call rotation on or off.
   *
   * @param userGroupId - Group whose rotation to change.
   * @param autoRotationEnabled - Whether the rotation should advance on its own.
   * @param options.rotationInterval - How often it advances: `'WEEKLY'`, `'BIWEEKLY'` or `'MONTHLY'`.
   * @param options.rotationStartDate - When the first rotation begins, epoch milliseconds.
   * @example
   * await sdk.userGroups.toggleAutoRotation('group-1', true, {
   *   rotationInterval: 'WEEKLY',
   *   rotationStartDate: Date.now(),
   * });
   */
  toggleAutoRotation(
    userGroupId: string,
    autoRotationEnabled: boolean,
    options?: { rotationInterval?: RotationInterval; rotationStartDate?: number }
  ): Promise<void> {
    return this.call(userGroupsOperations.toggleAutoRotation, {
      userGroupId,
      autoRotationEnabled,
      ...options,
    });
  }
}
