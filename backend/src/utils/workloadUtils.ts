import { DatabaseClient } from '@/database/client';
import { repositories } from '@/database/repositories';
import { TicketStatusV2 } from '@prisma/client';
import { logger } from './logger';

const db = DatabaseClient.getInstance();

/**
 * Sync UserWorkloadMapping for a specific user on a specific board
 * Calculates activeTasks (TODO, STARTED) and totalTasks from tickets
 */
export async function syncUserWorkload(
  userId: string,
  userGroupId: string,
  boardId: string,
  createdBy: string
): Promise<void> {
  // Count tickets directly in the database for better performance
  const [activeTasks, totalTasks] = await Promise.all([
    db.ticket.count({
      where: {
        assignedTo: userId,
        boardId: boardId,
        userGroupId: userGroupId,
        statusV2: { in: [TicketStatusV2.TODO, TicketStatusV2.STARTED] },
      },
    }),
    db.ticket.count({
      where: {
        assignedTo: userId,
        boardId: boardId,
        userGroupId: userGroupId,
      },
    }),
  ]);

  // Upsert the workload mapping
  await repositories.userWorkloadMapping.upsert({
    where: {
      userId_userGroupId_boardId: {
        userId,
        userGroupId,
        boardId,
      },
    },
    create: {
      userId,
      userGroupId,
      boardId,
      activeTasks,
      totalTasks,
      createdBy,
    },
    update: {
      activeTasks,
      totalTasks,
    },
  });
}

/**
 * Sync workload for a user across all boards in a user group
 * Useful when reassigning tickets or bulk updates
 */
export async function syncUserWorkloadAllBoards(
  userId: string,
  userGroupId: string,
  createdBy: string
): Promise<void> {
  // Get all boards this user has tickets on
  const tickets = await db.ticket.findMany({
    where: {
      assignedTo: userId,
      userGroupId: userGroupId,
    },
    select: {
      boardId: true,
    },
    distinct: ['boardId'],
  });

  const boardIds = tickets.map((t: any) => t.boardId);

  // Sync workload for each board
  for (const boardId of boardIds) {
    await syncUserWorkload(userId, userGroupId, boardId, createdBy);
  }
}

/**
 * Handle ticket assignment/reassignment change
 * Syncs workload for both old and new assignees
 */
export async function handleTicketAssignmentChange(
  newAssignedTo: string | null,
  oldAssignedTo: string | null,
  userGroupId: string,
  boardId: string,
  updatedBy: string
): Promise<void> {
  // Sync workload for old assignee (if exists)
  if (oldAssignedTo && oldAssignedTo !== newAssignedTo) {
    try {
      await syncUserWorkload(oldAssignedTo, userGroupId, boardId, updatedBy);
      logger.info(`[Workload Sync] Updated workload for old assignee ${oldAssignedTo}`);
    } catch (error) {
      logger.error(`[Workload Sync] Error syncing workload for old assignee:`, error);
    }
  }

  // Sync workload for new assignee (if exists)
  if (newAssignedTo && newAssignedTo !== oldAssignedTo) {
    try {
      await syncUserWorkload(newAssignedTo, userGroupId, boardId, updatedBy);
      logger.info(`[Workload Sync] Updated workload for new assignee ${newAssignedTo}`);
    } catch (error) {
      logger.error(`[Workload Sync] Error syncing workload for new assignee:`, error);
    }
  }
}

/**
 * Handle ticket status change
 * Syncs workload for the assigned user (activeTasks count changes)
 */
export async function handleTicketStatusChange(
  assignedTo: string | null,
  userGroupId: string,
  boardId: string,
  updatedBy: string
): Promise<void> {
  if (!assignedTo) {
    return; // No one to sync workload for
  }

  try {
    await syncUserWorkload(assignedTo, userGroupId, boardId, updatedBy);
    logger.info(`[Workload Sync] Updated workload after status change for user ${assignedTo}`);
  } catch (error) {
    logger.error(`[Workload Sync] Error syncing workload after status change:`, error);
  }
}
