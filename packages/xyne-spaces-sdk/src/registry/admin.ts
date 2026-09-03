/**
 * Admin Operation Registry
 *
 * Workspace and organization administration: orgs and their members, roles,
 * invitations, resource-level access grants, and installed apps.
 *
 * These operations change who can do what. Most require an elevated workspace
 * or org role, and the server enforces that independently — an SDK call with an
 * under-privileged token is rejected rather than silently narrowed.
 */

import { op } from './types.js';
import type {
  AccessResource,
  OrgRole,
  App,
  InstalledApp,
  Invitation,
  OrgMember,
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

/** Page cursor for the app listings, ordered by creation. */
export interface AppCursor {
  id: string;
  createdAt: number;
}

/** Page cursor for the role listing. */
export interface RoleCursor {
  id: string;
  createdAt: number;
}

export const adminOperations = {
  // ----- Workspace -----

  /**
   * One workspace.
   */
  getWorkspace: op<{ workspaceId: string }, Workspace | null>('admin.getWorkspace', 'query'),

  /**
   * Organizations attached to a workspace.
   */
  listWorkspaceOrgs: op<{ workspaceId: string }, WorkspaceOrganization[]>('admin.listWorkspaceOrgs', 'query'),

  /**
   * Every active organization, for attaching to a workspace.
   */
  listAvailableOrgs: op<void, Organization[]>('admin.listAvailableOrgs', 'query'),

  /**
   * Rename a workspace or change its settings.
   */
  updateWorkspace: op<{ workspaceId: string; updates: WorkspaceUpdate }, void>('admin.updateWorkspace', 'mutator'),

  // ----- Organizations -----

  /**
   * Create an organization and attach it to a workspace, with a first member.
   */
  createOrg: op<{
      orgId: string;
      workspaceOrgId: string;
      memberId: string;
      orgName: string;
      workspaceId: string;
      orgDescription?: string;
    }, void>('admin.createOrg', 'mutator'),

  /**
   * Attach an existing organization to a workspace.
   */
  addOrgToWorkspace: op<{ id: string; workspaceId: string; orgId: string }, void>('admin.addOrgToWorkspace', 'mutator'),

  /**
   * Detach an organization from a workspace.
   */
  removeOrgFromWorkspace: op<{ workspaceId: string; orgId: string }, void>('admin.removeOrgFromWorkspace', 'mutator'),

  // ----- Org members -----

  /**
   * Members of an organization.
   */
  listOrgMembers: op<{ orgId: string }, OrgMember[]>('admin.listOrgMembers', 'query'),

  /**
   * One org member.
   */
  getOrgMember: op<{ memberId: string }, OrgMember | null>('admin.getOrgMember', 'query'),

  /**
   * Add someone to an organization by email.
   */
  addOrgMember: op<{ memberId: string; orgId: string; email: string; role: OrgRole }, void>('admin.addOrgMember', 'mutator'),

  /**
   * Change an org member's role.
   */
  updateOrgMemberRole: op<{ memberId: string; role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER' }, void>('admin.updateOrgMemberRole', 'mutator'),

  /**
   * Remove someone from an organization.
   *
   * A soft delete — `leftAt` is stamped so the member drops out of active
   * queries while their history stays intact.
   */
  removeOrgMember: op<{ memberId: string }, void>('admin.removeOrgMember', 'mutator'),

  // ----- Workspace users -----

  /**
   * Change a user's workspace role.
   */
  updateUserRole: op<{ workspaceId: string; userId: string; updates: WorkspaceUserUpdate }, void>('admin.updateUserRole', 'mutator'),

  /**
   * Remove a user from a workspace.
   */
  removeUser: op<{ workspaceId: string; userId: string }, void>('admin.removeUser', 'mutator'),

  // ----- Invitations -----

  /**
   * Outstanding invitations.
   */
  listInvitations: op<void, Invitation[]>('admin.listInvitations', 'query'),

  /**
   * Revoke an invitation.
   */
  revokeInvitation: op<{ invitationId: string }, void>('admin.revokeInvitation', 'mutator'),

  // ----- Roles -----

  /**
   * Roles defined in the workspace.
   */
  listRoles: op<{ limit?: number; start?: RoleCursor }, Role[]>('admin.listRoles', 'query'),

  /**
   * One role.
   */
  getRole: op<{ id: string }, Role | null>('admin.getRole', 'query'),

  /**
   * Create a role.
   */
  createRole: op<{ id: string; name: string; description?: string }, void>('admin.createRole', 'mutator'),

  /**
   * Rename a role or change its description.
   */
  updateRole: op<{ id: string; name?: string; description?: string }, void>('admin.updateRole', 'mutator'),

  /**
   * Assign users to a role.
   */
  addRoleMembers: op<{ roleId: string; userIds: string[]; mappingIds: Record<string, string> }, void>('admin.addRoleMembers', 'mutator'),

  /**
   * Remove role assignments, by mapping id.
   */
  removeRoleMembers: op<{ mappingIds: string[] }, void>('admin.removeRoleMembers', 'mutator'),

  // ----- Resource access -----

  /**
   * Resources that can have access granted on them.
   */
  listResources: op<void, AccessResource[]>('admin.listResources', 'query'),

  /**
   * A user's resource-level grants.
   */
  listUserAccess: op<{ userId: string }, ResourceAccess[]>('admin.listUserAccess', 'query'),

  /**
   * Grant access to resources. Takes a batch.
   */
  grantAccess: op<{ grants: ResourceAccessGrant[] }, void>('admin.grantAccess', 'mutator'),

  /**
   * Change existing grants. Takes a batch.
   */
  updateAccess: op<{ updates: ResourceAccessUpdate[] }, void>('admin.updateAccess', 'mutator'),

  /**
   * Revoke grants by id.
   */
  revokeAccess: op<{ ids: string[] }, void>('admin.revokeAccess', 'mutator'),

  // ----- Apps -----

  /**
   * Apps installed in the workspace.
   */
  listInstalledApps: op<{ limit?: number; start?: AppCursor }, InstalledApp[]>('admin.listInstalledApps', 'query'),

  /**
   * Apps published by the organization.
   */
  listOrgApps: op<{ orgId: string; limit?: number; start?: AppCursor }, App[]>('admin.listOrgApps', 'query'),

  /**
   * Apps available to install.
   */
  listMarketplaceApps: op<{ limit?: number; start?: AppCursor }, App[]>('admin.listMarketplaceApps', 'query'),

  /**
   * Update an app's name, description, or webhook URL.
   */
  updateApp: op<{ appId: string; name?: string; description?: string; webhookUrl?: string }, void>('admin.updateApp', 'mutator'),
} as const;
