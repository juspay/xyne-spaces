import { DatabaseClient } from '@/database/client';
import { TicketStatusV2, UserResponsibility } from '@prisma/client';
import { evaluateAllRoles, evaluateAssignmentRule } from '@/utils/assignmentEngine';
import { logger } from '@/utils/logger';
import { syncUserWorkload } from '@/utils/workloadUtils';
import { repositories } from '@/database/repositories';

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
   * Full role assignment — assigns one user per role (MANAGER, TEAM_LEAD, MEMBER,
   * PR_REVIEWER, QA) into the ticket_assignments table when the board has
   * fullRoleAssignment enabled.
   *
   * Also returns the MEMBER userId so the caller can set ticket.assignedTo.
   */
  async assignFullRolesToTicket(params: {
    ticketId: string;
    userGroupId: string;
    boardId: string;
    createdBy: string;
    projectId?: string;
    channelId?: string;
  }): Promise<FullRoleAssignmentResult> {
    const { ticketId, userGroupId, boardId, createdBy, projectId, channelId } = params;

    const allRoles = await evaluateAllRoles(userGroupId, boardId, projectId, channelId);

    // upsert into ticket_assignments + sync workload for one resolved role
    const persist = async (
      userId: string,
      responsibility: UserResponsibility,
    ): Promise<RoleAssignment> => {
      const assignment = await prisma.ticketAssignment.upsert({
        where: {
          ticketId_userId_userResponsibility: { ticketId, userId, userResponsibility: responsibility },
        },
        update: {},
        create: { ticketId, userId, userResponsibility: responsibility, createdBy },
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
    const isFullRole =
      (board?.metadata as { fullRoleAssignment?: boolean } | null)?.fullRoleAssignment === true;

    let assignedUserId: string | undefined;
    if (isFullRole) {
      const fullRoles = await this.assignFullRolesToTicket({
        ticketId,
        userGroupId: groupId,
        boardId: ticket.boardId,
        createdBy: actorId,
        projectId: ticket.projectId,
        channelId: ticket.channelId,
      });
      assignedUserId = fullRoles.member;
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
    if (!isFullRole) {
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
