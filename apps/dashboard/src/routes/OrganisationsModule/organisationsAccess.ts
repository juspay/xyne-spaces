import { AccessType } from '@xyne/shared';
import type { usePermissions } from '../../hooks/usePermissions';

export type OrganisationsSectionKey =
  | 'general'
  | 'members'
  | 'invitations'
  | 'guests'
  | 'repository-credentials'
  | 'toolbar'
  | 'user-groups'
  | 'roles'
  | 'all';

type Permissions = ReturnType<typeof usePermissions>;

/**
 * Which Organisations sections a user may open. Mirrors the route guards in
 * AppRoot: WORKSPACE admin for workspace settings, USERS admin also unlocks
 * Members (it replaced User Management), USER-GROUPS write or owning a group,
 * ROLES admin, ORGANIZATIONS admin. The rail shows Organisations when any is true.
 */
export const organisationsAccess = (
  permissions: Permissions,
  ownsUserGroup: boolean,
): Record<OrganisationsSectionKey, boolean> => {
  const isAdmin = (resource: string): boolean =>
    permissions.some(p => p.resourceName === resource && p.accessType === AccessType.ADMIN);
  const canWrite = (resource: string): boolean =>
    permissions.some(
      p =>
        p.resourceName === resource &&
        (p.accessType === AccessType.ADMIN || p.accessType === AccessType.WRITE),
    );

  const workspace = isAdmin('WORKSPACE');
  return {
    general: workspace,
    members: workspace || isAdmin('USERS'),
    invitations: workspace,
    guests: workspace,
    'repository-credentials': workspace,
    toolbar: workspace,
    'user-groups': canWrite('USER-GROUPS') || ownsUserGroup,
    roles: isAdmin('ROLES'),
    all: isAdmin('ORGANIZATIONS'),
  };
};
