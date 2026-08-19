import { UserResponsibility, type BoardMetadata } from '@xyne/shared';

/**
 * Backend enforcement of the ticket-control permission (Assignee/ETA/Stage/
 * Board changes, and planning-risk acknowledgment), extracted from the gate
 * that was inlined in the Zero `ticket.update` mutator. Storage-agnostic: the
 * caller supplies the two lookups via whatever client it holds - Prisma `tx`
 * or Zero `tx.run(zql...)`.
 *
 * PRD §13.2: the backend is the only security boundary for this check -
 * frontend visibility must never be treated as one, so this logic is not
 * shared with or duplicated in the dashboard.
 */
export interface TicketControlUserGroupMapping {
  roleId: string | null;
  responsibility: string | null;
}

export interface EtaPermissionDataSource {
  getBoardMetadata(boardId: string): Promise<unknown>;
  getUserGroupMapping(
    userId: string,
    userGroupId: string,
  ): Promise<TicketControlUserGroupMapping | null>;
}

export interface EtaPermissionResult {
  allowed: boolean;
  reason?: string;
}

export async function canUserModifyTicketControl(
  userId: string,
  userGroupId: string | null,
  boardId: string,
  dataSource: EtaPermissionDataSource,
): Promise<EtaPermissionResult> {
  if (!userGroupId) {
    return { allowed: true };
  }

  const boardMetadata = await dataSource.getBoardMetadata(boardId);
  const metadata =
    boardMetadata && typeof boardMetadata === 'object' ? (boardMetadata as BoardMetadata) : null;

  const controlRoleIds = Array.isArray(metadata?.ticketControlRoleIds)
    ? metadata!.ticketControlRoleIds!
    : [];
  const legacyIsAllowedToTransfer = metadata?.isAllowedToTransfer === true;

  // Boards with neither config are unrestricted - no membership lookup needed.
  if (controlRoleIds.length === 0 && !legacyIsAllowedToTransfer) {
    return { allowed: true };
  }

  const mapping = await dataSource.getUserGroupMapping(userId, userGroupId);
  if (!mapping) {
    return {
      allowed: false,
      reason: 'You must be a member of the current user group to modify this ticket',
    };
  }

  if (controlRoleIds.length > 0) {
    // Role-driven: raw roleId membership, so custom roles work.
    if (!mapping.roleId || !controlRoleIds.includes(mapping.roleId)) {
      return {
        allowed: false,
        reason: 'Only users with a configured role can modify Assignee, ETA, Stage, or Board on this board',
      };
    }
    return { allowed: true };
  }

  // Legacy enum fallback (only reachable when isAllowedToTransfer === true).
  if (
    mapping.responsibility !== UserResponsibility.MANAGER &&
    mapping.responsibility !== UserResponsibility.TEAM_LEAD
  ) {
    return {
      allowed: false,
      reason:
        'Only users with MANAGER or TEAM_LEAD responsibility can modify Assignee, ETA, Stage, or Board on this board',
    };
  }
  return { allowed: true };
}
