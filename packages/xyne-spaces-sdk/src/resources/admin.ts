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
import type {
  AccessResource,
  App,
  InstalledApp,
  Invitation,
  OrgMember,
  OrgRole,
  Organization,
  ResourceAccess,
  ResourceAccessGrant,
  ResourceAccessUpdate,
  Role,
  Workspace,
  WorkspaceOrganization,
  WorkspaceUpdate,
  WorkspaceUserUpdate,
} from '../types/index.js';

export class AdminResource extends Resource {
  // ----- Workspace -----

  /**
   * Get a workspace.
   *
   * @param workspaceId - Id of the workspace.
   * @returns The workspace, or `null` if it does not exist.
   * @example
   * const me = await sdk.users.me();
   * const workspace = await sdk.admin.getWorkspace(me.workspaceId);
   */
  getWorkspace(workspaceId: string): Promise<Workspace | null> {
    return this.call(adminOperations.getWorkspace, { workspaceId });
  }

  /**
   * Rename a workspace or change its description.
   *
   * @param workspaceId - Id of the workspace.
   * @param updates - Fields to change; omitted fields are left alone.
   * @example
   * await sdk.admin.updateWorkspace('workspace-1', { name: 'Platform' });
   */
  updateWorkspace(workspaceId: string, updates: WorkspaceUpdate): Promise<void> {
    return this.call(adminOperations.updateWorkspace, { workspaceId, updates });
  }

  /**
   * List the organisations attached to a workspace.
   *
   * @param workspaceId - Id of the workspace.
   * @returns One attachment per organisation, with its role.
   * @example
   * const orgs = await sdk.admin.listWorkspaceOrgs('workspace-1');
   */
  listWorkspaceOrgs(workspaceId: string): Promise<WorkspaceOrganization[]> {
    return this.call(adminOperations.listWorkspaceOrgs, { workspaceId });
  }

  /**
   * List every active organisation, for attaching to a workspace.
   *
   * @returns Organisations that can be attached.
   * @example
   * const orgs = await sdk.admin.listAvailableOrgs();
   */
  listAvailableOrgs(): Promise<Organization[]> {
    return this.call(adminOperations.listAvailableOrgs, undefined);
  }

  // ----- Organizations -----

  /**
   * Create an organisation, attach it to a workspace, and seed its first member.
   *
   * @param data.orgName - Display name for the organisation.
   * @param data.workspaceId - Workspace to attach it to.
   * @param data.orgDescription - Optional description.
   * @returns The three ids created: the organisation, its workspace attachment,
   * and the seeded member.
   * @example
   * const { orgId } = await sdk.admin.createOrg({
   *   orgName: 'Payments',
   *   workspaceId: 'workspace-1',
   * });
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
   * Attach an existing organisation to a workspace.
   *
   * @param workspaceId - Workspace to attach it to.
   * @param orgId - Organisation to attach.
   * @returns The id of the attachment.
   * @example
   * const { id } = await sdk.admin.addOrgToWorkspace('workspace-1', 'org-1');
   */
  async addOrgToWorkspace(workspaceId: string, orgId: string): Promise<{ id: string }> {
    const id = newId();
    await this.call(adminOperations.addOrgToWorkspace, { id, workspaceId, orgId });
    return { id };
  }

  /**
   * Detach an organisation from a workspace.
   *
   * @param workspaceId - Workspace to detach from.
   * @param orgId - Organisation to detach.
   * @example
   * await sdk.admin.removeOrgFromWorkspace('workspace-1', 'org-1');
   */
  removeOrgFromWorkspace(workspaceId: string, orgId: string): Promise<void> {
    return this.call(adminOperations.removeOrgFromWorkspace, { workspaceId, orgId });
  }

  // ----- Org members -----

  /**
   * List an organisation's members.
   *
   * @param orgId - Id of the organisation.
   * @returns Its members, including those who have left.
   * @example
   * const members = await sdk.admin.listOrgMembers('org-1');
   */
  listOrgMembers(orgId: string): Promise<OrgMember[]> {
    return this.call(adminOperations.listOrgMembers, { orgId });
  }

  /**
   * Get one organisation member.
   *
   * @param memberId - The member id, which follows a person across workspaces.
   * @returns The membership, or `null` if it does not exist.
   * @example
   * const member = await sdk.admin.getOrgMember('member-1');
   */
  getOrgMember(memberId: string): Promise<OrgMember | null> {
    return this.call(adminOperations.getOrgMember, { memberId });
  }

  /**
   * Add someone to an organisation by email.
   *
   * If they were a member before and left, their membership is reactivated
   * rather than duplicated.
   *
   * @param data.orgId - Organisation to add them to.
   * @param data.email - Their email address.
   * @param data.role - Role to give them.
   * @returns The new member id.
   * @example
   * const { memberId } = await sdk.admin.addOrgMember({
   *   orgId: 'org-1',
   *   email: 'someone@example.com',
   *   role: 'MEMBER',
   * });
   */
  async addOrgMember(data: {
    orgId: string;
    email: string;
    role: OrgRole;
  }): Promise<{ memberId: string }> {
    const memberId = newId();
    await this.call(adminOperations.addOrgMember, { memberId, ...data });
    return { memberId };
  }

  /**
   * Change an organisation member's role.
   *
   * @param memberId - The member to change.
   * @param role - Their new role. Only these four can be set this way.
   * @example
   * await sdk.admin.updateOrgMemberRole('member-1', 'ADMIN');
   */
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
   *
   * @param memberId - The member to remove.
   * @example
   * await sdk.admin.removeOrgMember('member-1');
   */
  removeOrgMember(memberId: string): Promise<void> {
    return this.call(adminOperations.removeOrgMember, { memberId });
  }

  // ----- Workspace users -----

  /**
   * Change a user's role within a workspace.
   *
   * @param workspaceId - Workspace the role applies in.
   * @param userId - User to change.
   * @param updates - The new role. Only `ADMIN` and `MEMBER` can be set here.
   * @example
   * await sdk.admin.updateUserRole('workspace-1', 'user-1', { role: 'ADMIN' });
   */
  updateUserRole(workspaceId: string, userId: string, updates: WorkspaceUserUpdate): Promise<void> {
    return this.call(adminOperations.updateUserRole, { workspaceId, userId, updates });
  }

  /**
   * Remove a user from a workspace.
   *
   * @param workspaceId - Workspace to remove them from.
   * @param userId - User to remove.
   * @example
   * await sdk.admin.removeUser('workspace-1', 'user-1');
   */
  removeUser(workspaceId: string, userId: string): Promise<void> {
    return this.call(adminOperations.removeUser, { workspaceId, userId });
  }

  // ----- Invitations -----

  /**
   * List outstanding invitations to the workspace.
   *
   * @returns Invitations, including those already accepted or expired.
   * @example
   * const invitations = await sdk.admin.listInvitations();
   */
  listInvitations(): Promise<Invitation[]> {
    return this.call(adminOperations.listInvitations, undefined);
  }

  /**
   * Revoke an invitation before it is accepted.
   *
   * @param invitationId - Id of the invitation.
   * @example
   * await sdk.admin.revokeInvitation('invitation-1');
   */
  revokeInvitation(invitationId: string): Promise<void> {
    return this.call(adminOperations.revokeInvitation, { invitationId });
  }

  // ----- Roles -----

  /**
   * List the workspace's roles.
   *
   * @param options.limit - Page size.
   * @param options.start - Cursor from the previous page.
   * @returns One page of roles.
   * @example
   * const roles = await sdk.admin.listRoles({ limit: 20 });
   */
  listRoles(options?: { limit?: number; start?: RoleCursor }): Promise<Role[]> {
    return this.call(adminOperations.listRoles, options ?? {});
  }

  /**
   * Get one role.
   *
   * @param id - Id of the role.
   * @returns The role, or `null` if it does not exist.
   * @example
   * const role = await sdk.admin.getRole('role-1');
   */
  getRole(id: string): Promise<Role | null> {
    return this.call(adminOperations.getRole, { id });
  }

  /**
   * Create a role.
   *
   * @param data.name - Display name.
   * @param data.description - What the role is for.
   * @returns The new role's id.
   * @example
   * const { id } = await sdk.admin.createRole({ name: 'Release manager' });
   */
  async createRole(data: { name: string; description?: string }): Promise<{ id: string }> {
    const id = newId();
    await this.call(adminOperations.createRole, { id, ...data });
    return { id };
  }

  /**
   * Rename a role or change its description.
   *
   * @param id - Id of the role.
   * @param data - Fields to change; omitted fields are left alone.
   * @example
   * await sdk.admin.updateRole('role-1', { name: 'Release lead' });
   */
  updateRole(id: string, data: { name?: string; description?: string }): Promise<void> {
    return this.call(adminOperations.updateRole, { id, ...data });
  }

  /**
   * Assign users to a role.
   *
   * @param roleId - Role to assign.
   * @param userIds - People to assign it to.
   * @returns The mapping ids created, keyed by user id. Keep them: removal is by
   * mapping id rather than by user id.
   * @example
   * const { mappingIds } = await sdk.admin.addRoleMembers('role-1', ['user-1']);
   */
  async addRoleMembers(
    roleId: string,
    userIds: string[]
  ): Promise<{ mappingIds: Record<string, string> }> {
    const mappingIds = newIdMap(userIds);
    await this.call(adminOperations.addRoleMembers, { roleId, userIds, mappingIds });
    return { mappingIds };
  }

  /**
   * Remove role assignments.
   *
   * @param mappingIds - Mapping ids from {@link addRoleMembers}, not user ids.
   * @example
   * await sdk.admin.removeRoleMembers(['mapping-1']);
   */
  removeRoleMembers(mappingIds: string[]): Promise<void> {
    return this.call(adminOperations.removeRoleMembers, { mappingIds });
  }

  // ----- Resource access -----

  /**
   * List the resources that access can be granted on.
   *
   * @returns Every grantable resource.
   * @example
   * const resources = await sdk.admin.listResources();
   */
  listResources(): Promise<AccessResource[]> {
    return this.call(adminOperations.listResources, undefined);
  }

  /**
   * List one user's resource-level grants.
   *
   * @param userId - User to read.
   * @returns Their grants, each naming a resource and access level.
   * @example
   * const grants = await sdk.admin.listUserAccess('user-1');
   */
  listUserAccess(userId: string): Promise<ResourceAccess[]> {
    return this.call(adminOperations.listUserAccess, { userId });
  }

  /**
   * Grant access to resources, as a batch.
   *
   * @param grants - The grants to create. Each id must be supplied by the caller.
   * @example
   * await sdk.admin.grantAccess([
   *   { id: 'grant-1', userId: 'user-1', resourceId: 'resource-1', accessType: 'READ' },
   * ]);
   */
  grantAccess(grants: ResourceAccessGrant[]): Promise<void> {
    return this.call(adminOperations.grantAccess, { grants });
  }

  /**
   * Change existing grants, as a batch.
   *
   * @param updates - Each grant's id and its new access level.
   * @example
   * await sdk.admin.updateAccess([{ id: 'grant-1', accessType: 'WRITE' }]);
   */
  updateAccess(updates: ResourceAccessUpdate[]): Promise<void> {
    return this.call(adminOperations.updateAccess, { updates });
  }

  /**
   * Revoke grants.
   *
   * @param ids - Ids of the grants to revoke.
   * @example
   * await sdk.admin.revokeAccess(['grant-1']);
   */
  revokeAccess(ids: string[]): Promise<void> {
    return this.call(adminOperations.revokeAccess, { ids });
  }

  // ----- Apps -----

  /**
   * List apps installed in the workspace.
   *
   * @param options.limit - Page size.
   * @param options.start - Cursor from the previous page.
   * @returns One page of installations.
   * @example
   * const installed = await sdk.admin.listInstalledApps({ limit: 20 });
   */
  listInstalledApps(options?: { limit?: number; start?: AppCursor }): Promise<InstalledApp[]> {
    return this.call(adminOperations.listInstalledApps, options ?? {});
  }

  /**
   * List apps published by an organisation.
   *
   * @param orgId - Organisation to read.
   * @param options.limit - Page size.
   * @param options.start - Cursor from the previous page.
   * @returns One page of apps.
   * @example
   * const apps = await sdk.admin.listOrgApps('org-1', { limit: 20 });
   */
  listOrgApps(
    orgId: string,
    options?: { limit?: number; start?: AppCursor }
  ): Promise<App[]> {
    return this.call(adminOperations.listOrgApps, { orgId, ...options });
  }

  /**
   * List apps available to install from the marketplace.
   *
   * @param options.limit - Page size.
   * @param options.start - Cursor from the previous page.
   * @returns One page of available apps.
   * @example
   * const apps = await sdk.admin.listMarketplaceApps({ limit: 20 });
   */
  listMarketplaceApps(options?: { limit?: number; start?: AppCursor }): Promise<App[]> {
    return this.call(adminOperations.listMarketplaceApps, options ?? {});
  }

  /**
   * Update an app's name, description or webhook URL.
   *
   * @param appId - Id of the app.
   * @param data - Fields to change; omitted fields are left alone.
   * @example
   * await sdk.admin.updateApp('app-1', { webhookUrl: 'https://example.com/hook' });
   */
  updateApp(
    appId: string,
    data: { name?: string; description?: string; webhookUrl?: string }
  ): Promise<void> {
    return this.call(adminOperations.updateApp, { appId, ...data });
  }
}
