import { DatabaseClient } from '@/database/client';
import { TicketStatusV2 } from '@prisma/client';

const prisma = DatabaseClient.getInstance();

interface AssignmentResult {
  assignedUserId: string;
  reason: string;
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
}

export const ticketAssignmentService = new TicketAssignmentService();
