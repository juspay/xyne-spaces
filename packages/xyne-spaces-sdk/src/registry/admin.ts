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

import { query, mutator } from './types.js';
import { now } from '../core/ids.js';

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
   * Maps to: Zero query 'getWorkspaceById'
   */
  getWorkspace: query<{ workspaceId: string }, unknown>('getWorkspaceById'),

  /**
   * Organizations attached to a workspace.
   * Maps to: Zero query 'workspaceOrganizations'
   */
  listWorkspaceOrgs: query<{ workspaceId: string }, unknown[]>('workspaceOrganizations'),

  /**
   * Every active organization, for attaching to a workspace.
   * Maps to: Zero query 'availableOrganizations'
   */
  listAvailableOrgs: query<void, unknown[]>('availableOrganizations', {
    // Declared as an empty object rather than no arguments.
    mapArgs: () => ({}),
  }),

  /**
   * Rename a workspace or change its settings.
   * Maps to: Zero mutator 'workspace.update'
   */
  updateWorkspace: mutator<{ workspaceId: string; updates: unknown }, void>(
    'workspace.update',
    {
      mapArgs: (args) => ({ ...args, timestamp: now() }),
    }
  ),

  // ----- Organizations -----

  /**
   * Create an organization and attach it to a workspace, with a first member.
   * Maps to: Zero mutator 'org.create'
   */
  createOrg: mutator<
    {
      orgId: string;
      workspaceOrgId: string;
      memberId: string;
      orgName: string;
      workspaceId: string;
      orgDescription?: string;
    },
    void
  >('org.create', {
    mapArgs: (args) => ({ ...args, timestamp: now() }),
  }),

  /**
   * Attach an existing organization to a workspace.
   * Maps to: Zero mutator 'workspaceOrg.add'
   */
  addOrgToWorkspace: mutator<{ id: string; workspaceId: string; orgId: string }, void>(
    'workspaceOrg.add',
    {
      mapArgs: (args) => ({ ...args, timestamp: now() }),
    }
  ),

  /**
   * Detach an organization from a workspace.
   * Maps to: Zero mutator 'workspaceOrg.remove'
   */
  removeOrgFromWorkspace: mutator<{ workspaceId: string; orgId: string }, void>(
    'workspaceOrg.remove',
    {
      mapArgs: (args) => ({ ...args, timestamp: now() }),
    }
  ),

  // ----- Org members -----

  /**
   * Members of an organization.
   * Maps to: Zero query 'getOrgMembers'
   */
  listOrgMembers: query<{ orgId: string }, unknown[]>('getOrgMembers'),

  /**
   * One org member.
   * Maps to: Zero query 'getOrgMemberById'
   */
  getOrgMember: query<{ memberId: string }, unknown>('getOrgMemberById'),

  /**
   * Add someone to an organization by email.
   * Maps to: Zero mutator 'orgMember.add'
   */
  addOrgMember: mutator<
    { memberId: string; orgId: string; email: string; role: string },
    void
  >('orgMember.add', {
    mapArgs: (args) => ({ ...args, timestamp: now() }),
  }),

  /**
   * Change an org member's role.
   * Maps to: Zero mutator 'orgMember.updateRole'
   */
  updateOrgMemberRole: mutator<
    { memberId: string; role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER' },
    void
  >('orgMember.updateRole', {
    // The mutator nests the change under `updates`.
    mapArgs: (args) => ({ memberId: args.memberId, updates: { role: args.role } }),
  }),

  /**
   * Remove someone from an organization.
   *
   * A soft delete — `leftAt` is stamped so the member drops out of active
   * queries while their history stays intact.
   * Maps to: Zero mutator 'orgMember.remove'
   */
  removeOrgMember: mutator<{ memberId: string }, void>('orgMember.remove', {
    mapArgs: (args) => ({ memberId: args.memberId, timestamp: now() }),
  }),

  // ----- Workspace users -----

  /**
   * Change a user's workspace role.
   * Maps to: Zero mutator 'users.updateRole'
   */
  updateUserRole: mutator<
    { workspaceId: string; userId: string; updates: unknown },
    void
  >('users.updateRole', {
    mapArgs: (args) => ({ ...args, timestamp: now() }),
  }),

  /**
   * Remove a user from a workspace.
   * Maps to: Zero mutator 'users.remove'
   */
  removeUser: mutator<{ workspaceId: string; userId: string }, void>('users.remove', {
    mapArgs: (args) => ({ ...args, timestamp: now() }),
  }),

  // ----- Invitations -----

  /**
   * Outstanding invitations.
   * Maps to: Zero query 'getAllInvitations'
   */
  listInvitations: query<void, unknown[]>('getAllInvitations'),

  /**
   * Revoke an invitation.
   * Maps to: Zero mutator 'invitation.revoke'
   */
  revokeInvitation: mutator<{ invitationId: string }, void>('invitation.revoke', {
    mapArgs: (args) => ({ invitationId: args.invitationId, timestamp: now() }),
  }),

  // ----- Roles -----

  /**
   * Roles defined in the workspace.
   * Maps to: Zero query 'roles'
   */
  listRoles: query<{ limit?: number; start?: RoleCursor }, unknown[]>('roles', {
    mapArgs: (args) => ({
      ...(args?.limit !== undefined ? { limit: args.limit } : {}),
      start: args?.start ?? null,
    }),
  }),

  /**
   * One role.
   * Maps to: Zero query 'roleById'
   */
  getRole: query<{ id: string }, unknown>('roleById'),

  /**
   * Create a role.
   * Maps to: Zero mutator 'role.create'
   */
  createRole: mutator<{ id: string; name: string; description?: string }, void>(
    'role.create',
    {
      mapArgs: (args) => ({ ...args, timestamp: now() }),
    }
  ),

  /**
   * Rename a role or change its description.
   * Maps to: Zero mutator 'role.update'
   */
  updateRole: mutator<{ id: string; name?: string; description?: string }, void>(
    'role.update',
    {
      mapArgs: (args) => ({ ...args, timestamp: now() }),
    }
  ),

  /**
   * Assign users to a role.
   * Maps to: Zero mutator 'role.addMembers'
   */
  addRoleMembers: mutator<
    { roleId: string; userIds: string[]; mappingIds: Record<string, string> },
    void
  >('role.addMembers', {
    mapArgs: (args) => ({ ...args, timestamp: now() }),
  }),

  /**
   * Remove role assignments, by mapping id.
   * Maps to: Zero mutator 'role.removeMembers'
   */
  removeRoleMembers: mutator<{ mappingIds: string[] }, void>('role.removeMembers'),

  // ----- Resource access -----

  /**
   * Resources that can have access granted on them.
   * Maps to: Zero query 'getAllResources'
   */
  listResources: query<void, unknown[]>('getAllResources'),

  /**
   * A user's resource-level grants.
   * Maps to: Zero query 'getResourceAccessForUser'
   */
  listUserAccess: query<{ userId: string }, unknown[]>('getResourceAccessForUser'),

  /**
   * Grant access to resources. Takes a batch.
   * Maps to: Zero mutator 'resourceAccess.grant'
   */
  grantAccess: mutator<{ grants: unknown[] }, void>('resourceAccess.grant', {
    mapArgs: (args) => ({ grants: args.grants, timestamp: now() }),
  }),

  /**
   * Change existing grants. Takes a batch.
   * Maps to: Zero mutator 'resourceAccess.update'
   */
  updateAccess: mutator<{ updates: unknown[] }, void>('resourceAccess.update', {
    mapArgs: (args) => ({ updates: args.updates, timestamp: now() }),
  }),

  /**
   * Revoke grants by id.
   * Maps to: Zero mutator 'resourceAccess.revoke'
   */
  revokeAccess: mutator<{ ids: string[] }, void>('resourceAccess.revoke'),

  // ----- Apps -----

  /**
   * Apps installed in the workspace.
   * Maps to: Zero query 'getWorkspaceInstalledApps'
   */
  listInstalledApps: query<{ limit?: number; start?: AppCursor }, unknown[]>(
    'getWorkspaceInstalledApps',
    {
      mapArgs: (args) => ({ limit: args?.limit ?? 50, start: args?.start ?? null }),
    }
  ),

  /**
   * Apps published by the organization.
   * Maps to: Zero query 'getOrgApps'
   */
  listOrgApps: query<{ orgId: string; limit?: number; start?: AppCursor }, unknown[]>(
    'getOrgApps',
    {
      // orgId is required server-side and was never sent — the call always failed
      // validation. Get one from `listAvailableOrgs` / `listWorkspaceOrgs`.
      mapArgs: (args) => ({
        orgId: args.orgId,
        limit: args?.limit ?? 50,
        start: args?.start ?? null,
      }),
    }
  ),

  /**
   * Apps available to install.
   * Maps to: Zero query 'getMarketplaceApps'
   */
  listMarketplaceApps: query<{ limit?: number; start?: AppCursor }, unknown[]>(
    'getMarketplaceApps',
    {
      mapArgs: (args) => ({ limit: args?.limit ?? 50, start: args?.start ?? null }),
    }
  ),

  /**
   * Update an app's name, description, or webhook URL.
   * Maps to: Zero mutator 'apps.update'
   */
  updateApp: mutator<
    { appId: string; name?: string; description?: string; webhookUrl?: string },
    void
  >('apps.update', {
    mapArgs: (args) => ({ ...args, timestamp: now() }),
  }),
} as const;
