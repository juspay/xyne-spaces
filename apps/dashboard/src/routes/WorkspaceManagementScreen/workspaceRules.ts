import { WorkspaceRole, type Invitation } from '@xyne/shared';

/**
 * The rules the Members and Invitations pages apply before they change anything, shared with Xyne
 * Buddy so it refuses exactly what the pages would not offer. The server checks again.
 */

export const isWorkspaceAdmin = (role: WorkspaceRole | null | undefined): boolean =>
  role === WorkspaceRole.ADMIN || role === WorkspaceRole.OWNER;

// The last admin can be neither demoted nor removed.
// `adminCount` is counted once by the caller, not per member, as the Members page asks per row.
export const isLastAdmin = (user: { role: WorkspaceRole | null }, adminCount: number): boolean =>
  user.role === WorkspaceRole.ADMIN && adminCount <= 1;

export const isInvitationRevocable = (invitation: Invitation): boolean => {
  if (invitation.acceptedAt) return false;
  if (!invitation.expiredAt) return true;

  const now = Date.now();
  const expiredAt = invitation.expiredAt;
  const createdAt = invitation.createdAt;

  if (expiredAt < now) return false;

  const fifteenDaysInMs = 15 * 24 * 60 * 60 * 1000;
  if (expiredAt - createdAt + 1000 < fifteenDaysInMs) return false;

  return true;
};
