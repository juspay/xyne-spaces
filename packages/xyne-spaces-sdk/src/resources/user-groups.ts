/**
 * User Groups Resource
 *
 * Teams, their membership, and the configuration that routes work to them.
 */

import { Resource } from './base.js';
import { userGroupsOperations } from '../registry/user-groups.js';
import { newIdMap } from '../core/ids.js';

export class UserGroupsResource extends Resource {
  /**
   * List every user group.
   *
   * @example
   * const groups = await sdk.userGroups.list();
   */
  list(): Promise<unknown[]> {
    return this.call(userGroupsOperations.list, undefined);
  }

  /** Get several groups by id. */
  getMany(groupIds: string[]): Promise<unknown[]> {
    return this.call(userGroupsOperations.getMany, { groupIds });
  }

  /** Get one group. */
  get(userGroupId: string): Promise<unknown> {
    return this.call(userGroupsOperations.get, { userGroupId });
  }

  /** Search groups by name. */
  search(query: string, options?: { limit?: number }): Promise<unknown[]> {
    return this.call(userGroupsOperations.search, { query, ...options });
  }

  /** List a group's members. */
  listMembers(userGroupId: string): Promise<unknown[]> {
    return this.call(userGroupsOperations.listMembers, { userGroupId });
  }

  /** List members across several groups. */
  listMembersForGroups(userGroupIds: string[]): Promise<unknown[]> {
    return this.call(userGroupsOperations.listMembersForGroups, { userGroupIds });
  }

  /** List the current user's group memberships. */
  listMine(): Promise<unknown[]> {
    return this.call(userGroupsOperations.listMine, undefined);
  }

  /**
   * Rename a group, or change members' roles and responsibilities.
   *
   * `userRoleUpdates` and `userResponsibilityUpdates` are keyed by user id.
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

  /** Delete a group. */
  delete(userGroupId: string): Promise<void> {
    return this.call(userGroupsOperations.delete, { userGroupId });
  }

  /** Deactivate a group so it stops receiving assignments. */
  deactivate(userGroupId: string): Promise<void> {
    return this.call(userGroupsOperations.deactivate, { userGroupId });
  }

  /** Reactivate a group. */
  reactivate(userGroupId: string): Promise<void> {
    return this.call(userGroupsOperations.reactivate, { userGroupId });
  }

  /**
   * Add users to a group.
   *
   * @returns The membership mapping ids, keyed by user id
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

  /** Remove users from a group. */
  removeUsers(userGroupId: string, userIds: string[]): Promise<void> {
    return this.call(userGroupsOperations.removeUsers, { userGroupId, userIds });
  }

  // ----- Assignment routing -----

  /** List on-call and availability state for a group's members. */
  listAssignmentStates(userGroupId: string): Promise<unknown[]> {
    return this.call(userGroupsOperations.listAssignmentStates, { userGroupId });
  }

  /**
   * List per-member workload weightings for a group.
   *
   * Pairs with `listAssignmentStates`: that says who is available, this says how
   * much work each of them already holds.
   *
   * @example
   * const workload = await sdk.userGroups.listWorkloadMappings('group-1');
   */
  listWorkloadMappings(userGroupId: string): Promise<unknown[]> {
    return this.call(userGroupsOperations.listWorkloadMappings, { userGroupId });
  }

  /** Get one user's assignment state across their groups. */
  getAssignmentStateForUser(userId: string): Promise<unknown[]> {
    return this.call(userGroupsOperations.getAssignmentStateForUser, { userId });
  }

  /** List which members of a group have expertise on a board. */
  listExpertise(userGroupId: string, boardId: string): Promise<unknown[]> {
    return this.call(userGroupsOperations.listExpertise, { userGroupId, boardId });
  }

  /**
   * Update a group's assignment configuration — on-call state, board weights,
   * and expertise — in one call.
   *
   * The nested shapes are passed through rather than modelled, because they are
   * interdependent. Read the current configuration with `listAssignmentStates`
   * and `listExpertise` first, then send it back modified.
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
   * @param options.rotationInterval - How often to rotate, in milliseconds
   */
  toggleAutoRotation(
    userGroupId: string,
    autoRotationEnabled: boolean,
    options?: { rotationInterval?: number; rotationStartDate?: number }
  ): Promise<void> {
    return this.call(userGroupsOperations.toggleAutoRotation, {
      userGroupId,
      autoRotationEnabled,
      ...options,
    });
  }
}
