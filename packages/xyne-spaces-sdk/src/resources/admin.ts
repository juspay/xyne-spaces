/**
 * Admin Resource
 *
 * Workspace and organization administration.
 *
 * These operations change who can access what. The server enforces the required
 * role independently — an under-privileged token is rejected, not narrowed.
 */

import { Resource } from './base.js';
import { adminOperations, type AppCursor, type RoleCursor } from '../registry/admin.js';
import { newId, newIdMap } from '../core/ids.js';

export class AdminResource extends Resource {
  // ----- Workspace -----

  /** Get a workspace. */
  getWorkspace(workspaceId: string): Promise<unknown> {
    return this.call(adminOperations.getWorkspace, { workspaceId });
  }

  /** Update a workspace's name or settings. */
  updateWorkspace(workspaceId: string, updates: unknown): Promise<void> {
    return this.call(adminOperations.updateWorkspace, { workspaceId, updates });
  }

  /** List the organizations attached to a workspace. */
  listWorkspaceOrgs(workspaceId: string): Promise<unknown[]> {
    return this.call(adminOperations.listWorkspaceOrgs, { workspaceId });
  }

  /** List every active organization, for attaching to a workspace. */
  listAvailableOrgs(): Promise<unknown[]> {
    return this.call(adminOperations.listAvailableOrgs, undefined);
  }

  // ----- Organizations -----

  /**
   * Create an organization, attach it to a workspace, and seed its first member.
   *
   * @returns The ids created: the org, its workspace attachment, and the member
   */
  async createOrg(data: {
    orgName: string;
    workspaceId: string;
    orgDescription?: string;
  }): Promise<{ orgId: string; workspaceOrgId: string; memberId: string }> {
    const orgId = newId();
    const workspaceOrgId = newId();
    const memberId = newId();
    await this.call(adminOperations.createOrg, {
      orgId,
      workspaceOrgId,
      memberId,
      ...data,
    });
    return { orgId, workspaceOrgId, memberId };
  }

  /**
   * Attach an existing organization to a workspace.
   *
   * @returns The id of the attachment row
   */
  async addOrgToWorkspace(workspaceId: string, orgId: string): Promise<{ id: string }> {
    const id = newId();
    await this.call(adminOperations.addOrgToWorkspace, { id, workspaceId, orgId });
    return { id };
  }

  /** Detach an organization from a workspace. */
  removeOrgFromWorkspace(workspaceId: string, orgId: string): Promise<void> {
    return this.call(adminOperations.removeOrgFromWorkspace, { workspaceId, orgId });
  }

  // ----- Org members -----

  /** List an organization's members. */
  listOrgMembers(orgId: string): Promise<unknown[]> {
    return this.call(adminOperations.listOrgMembers, { orgId });
  }

  /** Get one org member. */
  getOrgMember(memberId: string): Promise<unknown> {
    return this.call(adminOperations.getOrgMember, { memberId });
  }

  /**
   * Add someone to an organization by email.
   *
   * @returns The new member id
   */
  async addOrgMember(data: {
    orgId: string;
    email: string;
    role: string;
  }): Promise<{ memberId: string }> {
    const memberId = newId();
    await this.call(adminOperations.addOrgMember, { memberId, ...data });
    return { memberId };
  }

  /** Change an org member's role. */
  updateOrgMemberRole(
    memberId: string,
    role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER'
  ): Promise<void> {
    return this.call(adminOperations.updateOrgMemberRole, { memberId, role });
  }

  /**
   * Remove someone from an organization.
   *
   * A soft delete: the member is stamped as having left and drops out of active
   * queries, but their history is preserved.
   */
  removeOrgMember(memberId: string): Promise<void> {
    return this.call(adminOperations.removeOrgMember, { memberId });
  }

  // ----- Workspace users -----

  /** Change a user's workspace role. */
  updateUserRole(workspaceId: string, userId: string, updates: unknown): Promise<void> {
    return this.call(adminOperations.updateUserRole, { workspaceId, userId, updates });
  }

  /** Remove a user from a workspace. */
  removeUser(workspaceId: string, userId: string): Promise<void> {
    return this.call(adminOperations.removeUser, { workspaceId, userId });
  }

  // ----- Invitations -----

  /** List outstanding invitations. */
  listInvitations(): Promise<unknown[]> {
    return this.call(adminOperations.listInvitations, undefined);
  }

  /** Revoke an invitation. */
  revokeInvitation(invitationId: string): Promise<void> {
    return this.call(adminOperations.revokeInvitation, { invitationId });
  }

  // ----- Roles -----

  /** List the workspace's roles. */
  listRoles(options?: { limit?: number; start?: RoleCursor }): Promise<unknown[]> {
    return this.call(adminOperations.listRoles, options ?? {});
  }

  /** Get one role. */
  getRole(id: string): Promise<unknown> {
    return this.call(adminOperations.getRole, { id });
  }

  /**
   * Create a role.
   *
   * @returns The new role id
   */
  async createRole(data: { name: string; description?: string }): Promise<{ id: string }> {
    const id = newId();
    await this.call(adminOperations.createRole, { id, ...data });
    return { id };
  }

  /** Rename a role or change its description. */
  updateRole(id: string, data: { name?: string; description?: string }): Promise<void> {
    return this.call(adminOperations.updateRole, { id, ...data });
  }

  /**
   * Assign users to a role.
   *
   * @returns The mapping ids created, keyed by user id — keep them to remove the
   * assignments later, since removal is by mapping id rather than user id.
   */
  async addRoleMembers(
    roleId: string,
    userIds: string[]
  ): Promise<{ mappingIds: Record<string, string> }> {
    const mappingIds = newIdMap(userIds);
    await this.call(adminOperations.addRoleMembers, { roleId, userIds, mappingIds });
    return { mappingIds };
  }

  /** Remove role assignments by mapping id. */
  removeRoleMembers(mappingIds: string[]): Promise<void> {
    return this.call(adminOperations.removeRoleMembers, { mappingIds });
  }

  // ----- Resource access -----

  /** List the resources that access can be granted on. */
  listResources(): Promise<unknown[]> {
    return this.call(adminOperations.listResources, undefined);
  }

  /** List a user's resource-level grants. */
  listUserAccess(userId: string): Promise<unknown[]> {
    return this.call(adminOperations.listUserAccess, { userId });
  }

  /** Grant access to resources, as a batch. */
  grantAccess(grants: unknown[]): Promise<void> {
    return this.call(adminOperations.grantAccess, { grants });
  }

  /** Change existing grants, as a batch. */
  updateAccess(updates: unknown[]): Promise<void> {
    return this.call(adminOperations.updateAccess, { updates });
  }

  /** Revoke grants by id. */
  revokeAccess(ids: string[]): Promise<void> {
    return this.call(adminOperations.revokeAccess, { ids });
  }

  // ----- Apps -----

  /** List apps installed in the workspace. */
  listInstalledApps(options?: { limit?: number; start?: AppCursor }): Promise<unknown[]> {
    return this.call(adminOperations.listInstalledApps, options ?? {});
  }

  /** List apps published by the organization. */
  listOrgApps(options?: { limit?: number; start?: AppCursor }): Promise<unknown[]> {
    return this.call(adminOperations.listOrgApps, options ?? {});
  }

  /** List apps available to install. */
  listMarketplaceApps(options?: { limit?: number; start?: AppCursor }): Promise<unknown[]> {
    return this.call(adminOperations.listMarketplaceApps, options ?? {});
  }

  /** Update an app's name, description, or webhook URL. */
  updateApp(
    appId: string,
    data: { name?: string; description?: string; webhookUrl?: string }
  ): Promise<void> {
    return this.call(adminOperations.updateApp, { appId, ...data });
  }
}
