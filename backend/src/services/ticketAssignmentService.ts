import { DatabaseClient } from '@/database/client';
import { TicketStatusV2, UserResponsibility } from '@prisma/client';
import { evaluateAllRoles, evaluateAssignmentRule, evaluateRoleSlots } from '@/utils/assignmentEngine';
import { logger } from '@/utils/logger';
import { syncUserWorkload } from '@/utils/workloadUtils';
import { repositories } from '@/database/repositories';
import { userResponsibilityFromRoleId, roleIdFromEnum } from '@/utils/roleFrameworkUtils';

const prisma = DatabaseClient.getInstance();

interface AssignmentResult {
  assignedUserId: string;
  reason: string;
}

export interface RoleAssignment {
  userId: string;
  assignmentId: string;
}

export interface FullRoleAssignmentResult {
  manager?: RoleAssignment;
  teamLead?: RoleAssignment;
  member?: string;
  prReviewer?: RoleAssignment;
  qa?: RoleAssignment;
}

/**
 * Board metadata slot describing one roleId to auto-assign.
 * `isPrimary: true` means that slot's user also becomes `ticket.assignedTo`.
 */
export interface AssignmentRoleSlot {
  roleId: string;
  isPrimary: boolean;
}

export interface RoleDrivenAssignmentResult {
  /** Per roleId → assignment record (omitted when no user was picked). */
  assignments: Record<string, RoleAssignment>;
  /** The userId of the slot marked isPrimary (or the first slot if none/many). */
  primaryUserId?: string;
}

/**
 * Union of the two shapes `assignFullRolesToTicket` can return.
 * Callers should read via `primaryUserId` / `secondaryAssignments` helpers
 * below rather than `.member` / `.manager` etc., which only exist on the
 * legacy 5-enum result.
 */
export type AnyFullRoleAssignmentResult = FullRoleAssignmentResult | RoleDrivenAssignmentResult;

export function isRoleDrivenResult(
  r: AnyFullRoleAssignmentResult,
): r is RoleDrivenAssignmentResult {
  return 'assignments' in r && 'primaryUserId' in r;
}

/** Returns the primary assignee's userId regardless of which path produced `r`. */
export function primaryUserIdOf(r: AnyFullRoleAssignmentResult): string | undefined {
  if (isRoleDrivenResult(r)) return r.primaryUserId;
  return r.member;
}

/** Returns the secondary (non-primary) assignments, regardless of path. */
export function secondaryAssignmentsOf(
  r: AnyFullRoleAssignmentResult,
): RoleAssignment[] {
  if (isRoleDrivenResult(r)) {
    return Object.values(r.assignments).filter(
      a => a.userId !== r.primaryUserId,
    );
  }
  return [r.manager, r.teamLead, r.prReviewer, r.qa].filter(
    (a): a is RoleAssignment => Boolean(a),
  );
}

/**
 * Smart ticket assignment service
 * Assigns tickets based on: team membership, skills, current workload
 */
export class TicketAssignmentService {
  /**
   * Auto-assign ticket to best team member
   */
  async assignTicket(params: {
    userGroupId: string;
  }): Promise<AssignmentResult | null> {
    const { userGroupId } = params;

    // Get all team members
    const members = await prisma.userGroupMapping.findMany({
      where: { userGroupId }
    });

    if (members.length === 0) return null;

    // Fetch users
    const userIds = members.map(m => m.userId);
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } }
    });

    // Batch fetch workload for all users using groupBy
    const workloadResults = await prisma.ticket.groupBy({
      by: ['assignedTo'],
      where: {
        assignedTo: { in: userIds },
        statusV2: { in: [TicketStatusV2.TODO, TicketStatusV2.STARTED] } // Active statuses
      },
      _count: {
        id: true
      }
    });

    // Create a map of userId -> workload count
    const workloadMap = new Map<string, number>();
    workloadResults.forEach(item => {
      if (item.assignedTo) {
        workloadMap.set(item.assignedTo, item._count.id);
      }
    });

    // Combine users with their workloads
    const userWorkloads = users.map(user => ({
      user,
      workload: workloadMap.get(user.id) || 0
    }));

    // Score each member based on workload
    const scores = userWorkloads.map(({ user, workload }) => {
      // Score based on workload: lower workload = higher score
      const score = 1 / (workload + 1);

      return {
        userId: user.id,
        userName: user.name,
        score,
        workload
      };
    });

    // Sort by score descending
    scores.sort((a, b) => b.score - a.score);

    const best = scores[0];

    return {
      assignedUserId: best.userId,
      reason: `Assigned to ${best.userName} (workload: ${best.workload} tickets)`
    };
  }

  /**
   * Get workload stats for a team
   */
  async getTeamWorkload(userGroupId: string) {
    // Get all team members
    const members = await prisma.userGroupMapping.findMany({
      where: { userGroupId }
    });

    // Fetch users
    const userIds = members.map(m => m.userId);
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: {
        id: true,
        name: true
      }
    });

    // Batch fetch ticket count for all users using groupBy
    const ticketCounts = await prisma.ticket.groupBy({
      by: ['assignedTo'],
      where: {
        assignedTo: { in: userIds },
        statusV2: { in: [TicketStatusV2.TODO, TicketStatusV2.STARTED] } // Active statuses
      },
      _count: {
        id: true
      }
    });

    // Create a map of userId -> ticket count
    const ticketCountMap = new Map<string, number>();
    ticketCounts.forEach(item => {
      if (item.assignedTo) {
        ticketCountMap.set(item.assignedTo, item._count.id);
      }
    });

    // Combine users with their ticket counts
    const usersWithWorkload = users.map(user => ({
      userId: user.id,
      userName: user.name,
      openTickets: ticketCountMap.get(user.id) || 0
    }));

    return usersWithWorkload;
  }

  /**
   * Full role assignment — assigns one user per role into the ticket_assignments
   * table when the board has auto-assignment enabled.
   *
   * Two paths:
   * 1. Role-driven (new): `board.metadata.assignmentRoles` non-empty → for each
   *    `{roleId, isPrimary}` slot, pick a user whose `UserGroupMapping.roleId`
   *    matches, persist a `TicketAssignment` with `roleId` set and
   *    `userResponsibility = null`. The `isPrimary` slot also sets
   *    `ticket.assignedTo`. If zero or multiple primary slots, logs a warning
   *    and falls back to the first slot.
   * 2. Legacy 5-enum (fallback): `assignmentRoles` missing/empty but
   *    `board.metadata.fullRoleAssignment === true` → the original MANAGER /
   *    TEAM_LEAD / MEMBER / PR_REVIEWER / QA path, unchanged. MEMBER's pick
   *    becomes `ticket.assignedTo`.
   */
  async assignFullRolesToTicket(params: {
    ticketId: string;
    userGroupId: string;
    boardId: string;
    createdBy: string;
    projectId?: string;
    channelId?: string;
  }): Promise<FullRoleAssignmentResult | RoleDrivenAssignmentResult> {
    const { ticketId, userGroupId, boardId, createdBy, projectId, channelId } = params;

    const board = await prisma.board.findUnique({
      where: { id: boardId },
      select: { metadata: true, workspaceId: true },
    });
    const metadata = (board?.metadata as Record<string, unknown> | null) ?? {};
    const assignmentRoles = Array.isArray(metadata.assignmentRoles)
      ? (metadata.assignmentRoles as AssignmentRoleSlot[])
      : [];
    const workspaceId = board?.workspaceId;

    if (assignmentRoles.length > 0) {
      return this.assignRoleDrivenSlots({
        ticketId,
        userGroupId,
        boardId,
        createdBy,
        projectId,
        channelId,
        assignmentRoles,
      });
    }

    return this.assignLegacyEnumSlots({
      ticketId,
      userGroupId,
      boardId,
      createdBy,
      projectId,
      channelId,
      workspaceId,
    });
  }

  /**
   * Role-driven path: one `TicketAssignment` per configured roleId.
   */
  private async assignRoleDrivenSlots(params: {
    ticketId: string;
    userGroupId: string;
    boardId: string;
    createdBy: string;
    projectId?: string;
    channelId?: string;
    assignmentRoles: AssignmentRoleSlot[];
  }): Promise<RoleDrivenAssignmentResult> {
    const { ticketId, userGroupId, boardId, createdBy, projectId, channelId, assignmentRoles } = params;

    const roleIds = assignmentRoles.map(s => s.roleId);
    const slots = await evaluateRoleSlots(userGroupId, boardId, roleIds, projectId, channelId);

    const primarySlots = assignmentRoles.filter(s => s.isPrimary);
    let primarySlot: AssignmentRoleSlot;
    if (primarySlots.length === 0) {
      logger.warn(
        `[ROLE-DRIVEN-ASSIGN] No isPrimary slot in assignmentRoles for ticket ${ticketId}; using first slot as primary`,
      );
      primarySlot = assignmentRoles[0];
    } else if (primarySlots.length > 1) {
      logger.warn(
        `[ROLE-DRIVEN-ASSIGN] Multiple isPrimary slots in assignmentRoles for ticket ${ticketId}; using first primary as primary`,
      );
      primarySlot = primarySlots[0];
    } else {
      primarySlot = primarySlots[0];
    }

    const persist = async (
      userId: string,
      roleId: string,
    ): Promise<RoleAssignment> => {
      // De-dupe on (ticketId, roleId): if a row already exists for this role
      // (possibly with a different userId from a previous run), update its
      // userId instead of creating a duplicate. Re-runs of assignFullRolesToTicket
      // (e.g. ticket reassigned to same group, PR webhook reassignment) would
      // otherwise accumulate stale rows for the same roleId.
      const existingAssignment = await prisma.ticketAssignment.findFirst({
        where: { ticketId, roleId },
        select: { id: true },
      });
      const userResponsibility = await userResponsibilityFromRoleId(roleId);
      const data = {
        ticketId,
        userId,
        roleId,
        createdBy,
        ...(userResponsibility ? { userResponsibility } : {}),
      };
      const assignment = existingAssignment
        ? await prisma.ticketAssignment.update({
            where: { id: existingAssignment.id },
            data: { userId, ...(userResponsibility ? { userResponsibility } : {}) },
          })
        : await prisma.ticketAssignment.create({ data });
      await syncUserWorkload(userId, userGroupId, boardId, createdBy);
      logger.info(`[ROLE-DRIVEN-ASSIGN] Assigned roleId=${roleId} → ${userId} for ticket ${ticketId}`);
      return { userId, assignmentId: assignment.id };
    };

    const result: RoleDrivenAssignmentResult = { assignments: {} };

    for (const slot of assignmentRoles) {
      const picked = slots[slot.roleId]?.assignedUserId;
      if (!picked) {
        logger.info(`[ROLE-DRIVEN-ASSIGN] No candidate for roleId=${slot.roleId} on ticket ${ticketId}`);
        continue;
      }
      // The primary slot becomes ticket.assignedTo; only non-primary roles are
      // persisted in the ticket_assignments table.
      if (slot.roleId === primarySlot.roleId) {
        continue;
      }
      try {
        const assignment = await persist(picked, slot.roleId);
        result.assignments[slot.roleId] = assignment;
      } catch (err) {
        logger.error(
          `[ROLE-DRIVEN-ASSIGN] Failed to persist roleId=${slot.roleId} for ticket ${ticketId}:`,
          err,
        );
      }
    }

    result.primaryUserId = slots[primarySlot.roleId]?.assignedUserId;
    if (!result.primaryUserId) {
      logger.info(
        `[ROLE-DRIVEN-ASSIGN] No primary assignee resolved for ticket ${ticketId} (roleId=${primarySlot.roleId})`,
      );
    } else {
      logger.info(
        `[ROLE-DRIVEN-ASSIGN] Primary ${result.primaryUserId} (roleId=${primarySlot.roleId}) for ticket ${ticketId}`,
      );
    }

    return result;
  }

  /**
   * Legacy 5-enum path (MANAGER/TEAM_LEAD/MEMBER/PR_REVIEWER/QA). Unchanged
   * from the original implementation; used when `assignmentRoles` is empty.
   */
  private async assignLegacyEnumSlots(params: {
    ticketId: string;
    userGroupId: string;
    boardId: string;
    createdBy: string;
    projectId?: string;
    channelId?: string;
    workspaceId?: string;
  }): Promise<FullRoleAssignmentResult> {
    const { ticketId, userGroupId, boardId, createdBy, projectId, channelId, workspaceId } = params;

    const allRoles = await evaluateAllRoles(userGroupId, boardId, projectId, channelId);

    const persist = async (
      userId: string,
      responsibility: UserResponsibility,
    ): Promise<RoleAssignment> => {
      const roleId = workspaceId ? await roleIdFromEnum(responsibility, workspaceId) : null;
      const createData: { ticketId: string; userId: string; userResponsibility: UserResponsibility; createdBy: string; roleId?: string } = {
        ticketId,
        userId,
        userResponsibility: responsibility,
        createdBy,
      };
      if (roleId) createData.roleId = roleId;
      const assignment = await prisma.ticketAssignment.upsert({
        where: {
          ticketId_userId_userResponsibility: { ticketId, userId, userResponsibility: responsibility },
        },
        update: {},
        create: createData,
      });
      await syncUserWorkload(userId, userGroupId, boardId, createdBy);
      logger.info(`[FULL-ROLE-ASSIGN] Assigned ${responsibility} → ${userId} for ticket ${ticketId}`);
      return { userId, assignmentId: assignment.id };
    };

    const roleEntries: Array<{ userId: string | undefined; responsibility: UserResponsibility }> = [
      { userId: allRoles.manager.assignedUserId,    responsibility: UserResponsibility.MANAGER },
      { userId: allRoles.teamLead.assignedUserId,   responsibility: UserResponsibility.TEAM_LEAD },
      { userId: allRoles.member.assignedUserId,     responsibility: UserResponsibility.MEMBER },
      { userId: allRoles.prReviewer.assignedUserId, responsibility: UserResponsibility.PR_REVIEWER },
      { userId: allRoles.qa.assignedUserId,         responsibility: UserResponsibility.QA },
    ];

    const result: FullRoleAssignmentResult = {};

    await Promise.all(
      roleEntries.map(async ({ userId, responsibility }) => {
        if (!userId) {
          logger.info(`[FULL-ROLE-ASSIGN] No candidate for ${responsibility} on ticket ${ticketId}`);
          return;
        }
        if (responsibility === UserResponsibility.MEMBER) {
          result.member = userId;
          logger.info(`[FULL-ROLE-ASSIGN] MEMBER ${userId} assigned to ticket.assignedTo for ticket ${ticketId}`);
          return;
        }
        try {
          const assignment = await persist(userId, responsibility);
          if (responsibility === UserResponsibility.MANAGER) result.manager = assignment;
          else if (responsibility === UserResponsibility.TEAM_LEAD) result.teamLead = assignment;
          else if (responsibility === UserResponsibility.PR_REVIEWER) result.prReviewer = assignment;
          else if (responsibility === UserResponsibility.QA) result.qa = assignment;
        } catch (err) {
          logger.error(`[FULL-ROLE-ASSIGN] Failed to persist ${responsibility} for ticket ${ticketId}:`, err);
        }
      }),
    );

    return result;
  }
  
  async assignTicketToGroup(params: {
    ticketId: string;
    groupId: string;
    actorId: string;
  }): Promise<string | null> {
    const { ticketId, groupId, actorId } = params;

    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { boardId: true, projectId: true, channelId: true },
    });
    if (!ticket) {
      logger.warn(`[AUTO-ASSIGN] Ticket ${ticketId} not found; cannot assign to group ${groupId}`);
      return null;
    }

    // Set group ownership via the existing repository method (handles md sync).
    await repositories.tickets.assignUserGroupToTicket(ticketId, groupId, actorId);

    const board = await prisma.board.findUnique({
      where: { id: ticket.boardId },
      select: { metadata: true },
    });
    const metadata = (board?.metadata as Record<string, unknown> | null) ?? {};
    const hasAssignmentRoles = Array.isArray(metadata.assignmentRoles)
      && (metadata.assignmentRoles as unknown[]).length > 0;
    const isFullRole = hasAssignmentRoles
      || metadata.fullRoleAssignment === true;

    let assignedUserId: string | undefined;
    let usedFullRole = false;
    if (isFullRole) {
      const fullRoles = await this.assignFullRolesToTicket({
        ticketId,
        userGroupId: groupId,
        boardId: ticket.boardId,
        createdBy: actorId,
        projectId: ticket.projectId,
        channelId: ticket.channelId,
      });
      usedFullRole = true;
      // Role-driven path returns primaryUserId; legacy path returns member.
      assignedUserId = primaryUserIdOf(fullRoles);
    } else {
      const result = await evaluateAssignmentRule(
        groupId,
        ticket.boardId,
        undefined,
        undefined,
        ticket.projectId,
        ticket.channelId,
      );
      assignedUserId = result.assignedUserId;
    }

    if (!assignedUserId) {
      logger.info(
        `[AUTO-ASSIGN] No eligible member in group ${groupId} for ticket ${ticketId} (e.g. NO_ON_CALL_USERS); group set without assignee`,
      );
      return null;
    }

    // Set the assignee via the existing repository method (md sync + ticket-updated event).
    await repositories.tickets.updateTicketAssignee(ticketId, assignedUserId, actorId);

    // Full-role path already syncs workload per role inside assignFullRolesToTicket.
    if (!usedFullRole) {
      try {
        await syncUserWorkload(assignedUserId, groupId, ticket.boardId, actorId);
      } catch (workloadError) {
        logger.error('[AUTO-ASSIGN] Error syncing workload:', workloadError);
      }
    }

    logger.info(
      `[AUTO-ASSIGN] Assigned member ${assignedUserId} from group ${groupId} to ticket ${ticketId}`,
    );
    return assignedUserId;
  }
}

export const ticketAssignmentService = new TicketAssignmentService();
