import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { unifiedBotUserService } from '@/bots/unified/services/unified-bot-user-service';
import { TicketStatusV2 } from '@prisma/client';
import { MessageType } from '@xyne/shared';
import { v4 as uuidv4 } from 'uuid';

export const OPEN_STATUSES = [TicketStatusV2.TODO, TicketStatusV2.STARTED, TicketStatusV2.PAUSED];

/**
 * Basic ticket info needed for ETA notifications
 */
export interface TicketBasicInfo {
  id: string;
  xyneId: string;
  assignedTo: string | null;
  createdBy: string | null;
  channelId: string;
  conversationId: string | null;
  eta: Date | null;
  workspaceId: string;
}

/**
 * Get all USER field IDs from formFields
 */
export async function getUserFieldIds(): Promise<string[]> {
  try {
    const userFields = await db.formFields.findMany({
      where: { fieldType: 'USER' as any },
      select: { id: true },
    });
    return userFields.map(f => f.id);
  } catch (error) {
    logger.error('[ETA-UTILS] Error fetching user field IDs:', error);
    return [];
  }
}

/**
 * Build a map of ticketId -> form field user IDs
 */
export async function getFormUsersMap(
  ticketIds: string[],
  userFieldIds: string[]
): Promise<Map<string, string[]>> {
  const formUsersMap = new Map<string, string[]>();

  if (userFieldIds.length === 0 || ticketIds.length === 0) {
    return formUsersMap;
  }

  try {
    const formValues = await db.formEntityValues.findMany({
      where: {
        entityId: { in: ticketIds },
        entityType: 'TICKET' as any,
        fieldId: { in: userFieldIds },
      },
      select: { entityId: true, actualFieldValue: true },
    });

    for (const value of formValues) {
      if (!value.actualFieldValue) continue;
      const userIds = parseUserIdsFromFieldValue(value.actualFieldValue);
      if (userIds.length > 0) {
        const existingUsers = formUsersMap.get(value.entityId) || [];
        formUsersMap.set(value.entityId, [...existingUsers, ...userIds]);
      }
    }
  } catch (error) {
    logger.error('[ETA-UTILS] Error fetching form users map:', error);
  }

  return formUsersMap;
}

/**
 * Parse user IDs from form field value
 */
export function parseUserIdsFromFieldValue(fieldValue: any): string[] {
  const userIds: string[] = [];
  if (!fieldValue) return userIds;

  if (Array.isArray(fieldValue)) {
    fieldValue.forEach(item => {
      if (typeof item === 'string' && item.length > 0) userIds.push(item);
      else if (item?.id && typeof item.id === 'string') userIds.push(item.id);
    });
  } else if (fieldValue?.id && typeof fieldValue.id === 'string') {
    userIds.push(fieldValue.id);
  } else if (typeof fieldValue === 'string' && fieldValue.length > 0) {
    userIds.push(fieldValue);
  }

  return userIds;
}

/**
 * Get unique users to notify (assignedTo, createdBy, and form field users)
 * This is the shared function used by both etaDeadlineQueue and stageEtaDeadlineQueue
 */
export function getUsersToNotify(
  assignedTo: string | null,
  createdBy: string | null,
  formFieldUsers: string[]
): string[] {
  const users = new Set<string>();

  // Add assignedTo and createdBy
  [assignedTo, createdBy].forEach(userId => {
    if (typeof userId === 'string' && userId.length > 0) {
      users.add(userId);
    }
  });

  // Add form field users
  formFieldUsers.forEach(userId => {
    if (typeof userId === 'string' && userId.length > 0) {
      users.add(userId);
    }
  });

  return Array.from(users);
}

/**
 * Get users to notify for a ticket (including form field users)
 * Convenience function that combines all steps
 */
export async function getUsersToNotifyForTicket(
  ticketId: string,
  assignedTo: string | null,
  createdBy: string | null
): Promise<string[]> {
  // Get user field IDs
  const userFieldIds = await getUserFieldIds();

  // Get form users map for this ticket
  const formUsersMap = await getFormUsersMap([ticketId], userFieldIds);
  const formFieldUsers = formUsersMap.get(ticketId) || [];

  // Get unique users
  return getUsersToNotify(assignedTo, createdBy, formFieldUsers);
}

/**
 * Get the ticket bot actor ID for system-generated activities
 */
export async function getTicketBotActorId(workspaceId: string): Promise<string> {
  try {
    const xyneTicketBot = await unifiedBotUserService.getBotByEmail('ticket-bot@bot.xyne.ai', workspaceId);
    return xyneTicketBot?.id || 'cmjkaarlm0001jq9oftpebya1';
  } catch (error) {
    logger.error('[ETA-UTILS] Error fetching ticket bot, using fallback actorId:', error);
    return 'cmjkaarlm0001jq9oftpebya1';
  }
}

/**
 * Check if now is approximately the same time (within window) on any day after a target time
 * Used for daily follow-up reminders at the same time
 */
export function isSameTimeDaily(targetTime: Date, now: Date, windowMinutes: number = 30): boolean {
  const targetHour = targetTime.getHours();
  const targetMinute = targetTime.getMinutes();
  const nowHour = now.getHours();
  const nowMinute = now.getMinutes();

  // Calculate minutes from midnight for both times
  const targetMinutesFromMidnight = targetHour * 60 + targetMinute;
  const nowMinutesFromMidnight = nowHour * 60 + nowMinute;

  // Check if current time is within window minutes of the target time
  const timeDiff = Math.abs(nowMinutesFromMidnight - targetMinutesFromMidnight);
  return timeDiff <= windowMinutes;
}

/**
 * Calculate days overdue from an ETA date (using exact time)
 */
export function calculateDaysOverdueExact(eta: Date, now: Date): number {
  return Math.floor((now.getTime() - eta.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Calculate days overdue from an ETA date (using midnight comparison)
 */
export function calculateDaysOverdueMidnight(eta: Date, today: Date): number {
  const etaMidnight = new Date(eta);
  etaMidnight.setHours(0, 0, 0, 0);
  return Math.floor((today.getTime() - etaMidnight.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Ticket info with stage for stage ETA notifications
 */
export interface TicketWithStageInfo extends TicketBasicInfo {
  stageName: string;
}

/**
 * Get all open tickets for ETA notifications
 * @param includeStage - If true, includes stageName and returns all open tickets (for stage ETA)
 *                        If false, only returns tickets with ETA set (for overall ETA)
 */
export async function getOpenTickets(includeStage: boolean = false): Promise<TicketBasicInfo[] | TicketWithStageInfo[]> {
  const baseSelect = {
    id: true,
    xyneId: true,
    assignedTo: true,
    createdBy: true,
    channelId: true,
    conversationId: true,
    eta: true,
    workspaceId: true,
  };

  const select = includeStage
    ? { ...baseSelect, stageName: true }
    : baseSelect;

  const where = includeStage
    ? { statusV2: { in: OPEN_STATUSES } }
    : { eta: { not: null }, statusV2: { in: OPEN_STATUSES } };

  return await db.ticket.findMany({ where, select });
}

/**
 * Create a system message for ETA notification
 */
export async function createEtaSystemMessage(params: {
  conversationId: string;
  content: string;
  createdAt: Date;
  activityType: 'ETA' | 'STAGE_ETA';
  stageId?: string;
}): Promise<void> {
  const { conversationId, content, createdAt, activityType, stageId } = params;

  const metadata: Record<string, any> = {
    activityType,
    isTicketActivity: true,
  };

  if (stageId) {
    metadata.stageId = stageId;
  }

  await db.message.create({
    data: {
      messageId: uuidv4(),
      conversationId,
      senderId: 'system',
      content,
      msgType: MessageType.SYSTEM,
      hasAttachment: false,
      edited: false,
      isDeleted: false,
      isSent: true,
      showInChannel: false,
      createdAt,
      metadata,
    },
  });
}
