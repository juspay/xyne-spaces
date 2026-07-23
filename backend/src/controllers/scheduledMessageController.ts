import { Request, Response } from 'express';
import { db } from '@/database/client';
import { ChannelRole } from '@prisma/client';
import { logger } from '@/utils/logger';
import { buildCronPattern } from '@/utils/cronUtils';
import { scheduledMessageService } from '@/services/scheduledMessageService';

async function checkMutatePermission(
  channelId: string,
  creatorId: string,
  userId: string,
): Promise<{ status: number; error: string } | null> {
  const rows = await db.channelParticipant.findMany({
    where: { channelId, userId: { in: [userId, creatorId] } },
    select: { userId: true, role: true },
  });
  const callerParticipant = rows.find((r) => r.userId === userId);
  if (!callerParticipant) {
    return { status: 403, error: 'You must be a participant of this channel' };
  }

  const isOwner = creatorId === userId;
  const creatorParticipant = rows.find((r) => r.userId === creatorId);
  const creatorIsActiveAdmin = creatorParticipant?.role === ChannelRole.ADMIN;

  if (creatorIsActiveAdmin) {
    if (!isOwner) {
      return {
        status: 403,
        error: 'Only the creator may modify this message while they remain a channel admin',
      };
    }
  } else if (callerParticipant.role !== ChannelRole.ADMIN) {
    return { status: 403, error: 'Only a channel admin may modify this message' };
  }
  return null;
}

// ── List all scheduled messages ─────────────────────────────────────────────
export async function listScheduledMessages(req: Request, res: Response) {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const adminChannels = await db.channelParticipant.findMany({
      where: { userId, role: ChannelRole.ADMIN },
      select: { channelId: true },
    });
    const channelIds = adminChannels.map((p) => p.channelId);
    const messages = await db.scheduledMessage.findMany({
      where: { channelId: { in: channelIds } },
      orderBy: { createdAt: 'desc' },
    });

    const creatorAdminRows = messages.length
      ? await db.channelParticipant.findMany({
          where: {
            role: ChannelRole.ADMIN,
            OR: messages.map((m) => ({ channelId: m.channelId, userId: m.createdBy })),
          },
          select: { channelId: true, userId: true },
        })
      : [];
    const creatorIsAdmin = new Set(creatorAdminRows.map((r) => `${r.channelId}:${r.userId}`));
    const scheduledMessages = messages.map((m) => ({
      ...m,
      canEdit: m.createdBy === userId || !creatorIsAdmin.has(`${m.channelId}:${m.createdBy}`),
    }));
    return res.json({ scheduledMessages });
  } catch (error) {
    logger.error('[SCHEDULED-MESSAGE-CTRL] List failed:', error);
    return res.status(500).json({ error: 'Failed to list scheduled messages' });
  }
}

// ── Create a scheduled message ──────────────────────────────────────────────
export async function createScheduledMessage(req: Request, res: Response) {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { channelId, title, messageContent, daysOfWeek, scheduledTime } = req.body;

  // Basic validation
  if (!channelId || !title || !messageContent || !daysOfWeek || !scheduledTime) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (!/^\d{2}:\d{2}$/.test(scheduledTime)) {
    return res.status(400).json({ error: 'scheduledTime must be HH:mm format' });
  }
  if (title.length > 100) {
    return res.status(400).json({ error: 'Title must be at most 100 characters' });
  }
  if (messageContent.length > 4000) {
    return res.status(400).json({ error: 'Message must be at most 4000 characters' });
  }

  try {
    // Verify user is an ADMIN of the channel
    const participant = await db.channelParticipant.findUnique({
      where: { channelId_userId: { channelId, userId } },
    });
    if (!participant) {
      return res.status(403).json({ error: 'You must be a participant of this channel' });
    }
    if (participant.role !== ChannelRole.ADMIN) {
      return res.status(403).json({ error: 'Only channel admins can create scheduled messages' });
    }

    const message = await db.scheduledMessage.create({
      data: {
        title,
        messageContent,
        channelId,
        daysOfWeek,
        scheduledTime,
        isActive: true,
        createdBy: userId,
        workspaceId: req.user!.workspaceId!,
      },
    });

    // Schedule the Bull cron job
    const cron = buildCronPattern(scheduledTime, daysOfWeek);
    await scheduledMessageService.syncJob(channelId, cron, message.id);

    logger.info(`[SCHEDULED-MESSAGE-CTRL] Created message ${message.id} by user ${userId}`);
    return res.status(201).json({ scheduledMessage: message });
  } catch (error) {
    logger.error('[SCHEDULED-MESSAGE-CTRL] Create failed:', error);
    return res.status(500).json({ error: 'Failed to create scheduled message' });
  }
}

// ── Update a scheduled message ──────────────────────────────────────────────
export async function updateScheduledMessage(req: Request, res: Response) {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { id } = req.params;
  const { title, messageContent, daysOfWeek, scheduledTime, isActive } = req.body;

  try {
    // Check the message exists
    const existing = await db.scheduledMessage.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Scheduled message not found' });
    }

    const denied = await checkMutatePermission(existing.channelId, existing.createdBy, userId);
    if (denied) return res.status(denied.status).json({ error: denied.error });

    // Build partial update
    const data: Record<string, unknown> = {};
    if (title !== undefined) data.title = title;
    if (messageContent !== undefined) data.messageContent = messageContent;
    if (daysOfWeek !== undefined) data.daysOfWeek = daysOfWeek;
    if (scheduledTime !== undefined) data.scheduledTime = scheduledTime;
    if (isActive !== undefined) data.isActive = isActive;

    const updated = await db.scheduledMessage.update({
      where: { id },
      data,
    });

    // Re-sync Bull job
    const effectiveTime = scheduledTime ?? existing.scheduledTime;
    const effectiveDays = daysOfWeek ?? existing.daysOfWeek;
    const effectiveActive = isActive ?? existing.isActive;
    const cron = buildCronPattern(effectiveTime, effectiveDays);

    if (effectiveActive) {
      await scheduledMessageService.syncJob(existing.channelId, cron, id);
    } else {
      await scheduledMessageService.removeJob(id);
    }

    logger.info(`[SCHEDULED-MESSAGE-CTRL] Updated message ${id} by user ${userId}`);
    return res.json({ scheduledMessage: updated });
  } catch (error) {
    logger.error('[SCHEDULED-MESSAGE-CTRL] Update failed:', error);
    return res.status(500).json({ error: 'Failed to update scheduled message' });
  }
}

// ── Delete a scheduled message ──────────────────────────────────────────────
export async function deleteScheduledMessage(req: Request, res: Response) {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { id } = req.params;

  try {
    const existing = await db.scheduledMessage.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Scheduled message not found' });
    }

    const denied = await checkMutatePermission(existing.channelId, existing.createdBy, userId);
    if (denied) return res.status(denied.status).json({ error: denied.error });

    await db.scheduledMessage.delete({ where: { id } });

    // Remove Bull job
    await scheduledMessageService.removeJob(id);

    logger.info(`[SCHEDULED-MESSAGE-CTRL] Deleted message ${id} by user ${userId}`);
    return res.json({ success: true });
  } catch (error) {
    logger.error('[SCHEDULED-MESSAGE-CTRL] Delete failed:', error);
    return res.status(500).json({ error: 'Failed to delete scheduled message' });
  }
}
