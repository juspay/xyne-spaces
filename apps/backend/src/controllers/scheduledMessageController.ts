import { Request, Response } from 'express';
import { ChannelRole } from '@xyne/shared';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { buildCronPattern, type MonthlyMode } from '@/utils/cronUtils';
import { scheduledMessageService } from '@/services/scheduledMessageService';
import { withWorkspaceScope } from '@/database/tenant/context';

// ── Schedule validation / normalization ──────────────────────────────────────
// Normalizes the raw schedule fields into exactly what we persist. Weekly stores a
// day list in daysOfWeek (monthly columns null); monthly sets daysOfWeek = "-" plus
// a mode and a packed integer value (see cronUtils for the encoding).
const MONTHLY_DOW = '-';

interface NormalizedSchedule {
  daysOfWeek: string;
  monthlyMode: MonthlyMode | null;
  monthlyValue: number | null;
}

interface ScheduleInput {
  daysOfWeek?: string;
  monthlyMode?: string;
  monthlyValue?: number;
}

function normalizeSchedule(input: ScheduleInput): { error: string } | { data: NormalizedSchedule } {
  const { daysOfWeek } = input;

  // Weekly — daysOfWeek is a comma-separated list of 0-6.
  if (daysOfWeek !== MONTHLY_DOW) {
    if (!daysOfWeek || !/^[0-6](,[0-6])*$/.test(daysOfWeek)) {
      return { error: 'daysOfWeek must be a comma-separated list of 0-6, or "-" for monthly' };
    }
    return { data: { daysOfWeek, monthlyMode: null, monthlyValue: null } };
  }

  // Monthly — mode + a single packed integer.
  const mode = input.monthlyMode;
  const value = Number(input.monthlyValue);
  if (!Number.isInteger(value)) {
    return { error: 'monthlyValue must be an integer' };
  }

  if (mode === 'DAY_OF_MONTH') {
    if (value !== -1 && (value < 1 || value > 28)) {
      return { error: 'monthlyValue for DAY_OF_MONTH must be 1..28, or -1 for the last day' };
    }
    return { data: { daysOfWeek: MONTHLY_DOW, monthlyMode: mode, monthlyValue: value } };
  }

  if (mode === 'NTH_WEEKDAY') {
    const ordinal = Math.floor(value / 10);
    const weekday = value % 10;
    if (![1, 2, 3, 4, 5].includes(ordinal) || weekday < 0 || weekday > 6) {
      return {
        error:
          'monthlyValue for NTH_WEEKDAY must be ordinal*10+weekday (ordinal 1..4 or 5=last, weekday 0..6)',
      };
    }
    return { data: { daysOfWeek: MONTHLY_DOW, monthlyMode: mode, monthlyValue: value } };
  }

  return { error: 'monthlyMode must be DAY_OF_MONTH or NTH_WEEKDAY' };
}

function cronFromSchedule(scheduledTime: string, s: NormalizedSchedule): string {
  return buildCronPattern({
    scheduledTime,
    daysOfWeek: s.daysOfWeek,
    monthlyMode: s.monthlyMode ?? undefined,
    monthlyValue: s.monthlyValue ?? undefined,
  });
}

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
    // A channel admin sees every scheduled message in the channels they administer.
    const messages = await withWorkspaceScope(() =>
      db.scheduledMessage.findMany({
        where: { channelId: { in: channelIds } },
        orderBy: { createdAt: 'desc' },
      }),
    );

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

  const { channelId, title, messageContent, scheduledTime } = req.body;

  // Basic validation
  if (!channelId || !title || !messageContent || !scheduledTime) {
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

  // Validate & normalize the recurrence (WEEKLY days-of-week, or MONTHLY mode).
  const normalized = normalizeSchedule(req.body);
  if ('error' in normalized) {
    return res.status(400).json({ error: normalized.error });
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
        ...normalized.data,
        scheduledTime,
        isActive: true,
        createdBy: userId,
        workspaceId: req.user!.workspaceId!,
      },
    });

    // Schedule the Bull cron job
    const cron = cronFromSchedule(scheduledTime, normalized.data);
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
  const { title, messageContent, scheduledTime, isActive } = req.body;

  if (scheduledTime !== undefined && !/^\d{2}:\d{2}$/.test(scheduledTime)) {
    return res.status(400).json({ error: 'scheduledTime must be HH:mm format' });
  }

  try {
    // Check the message exists — checkMutatePermission below decides who may change it.
    const existing = await withWorkspaceScope(() =>
      db.scheduledMessage.findUnique({ where: { id } }),
    );
    if (!existing) {
      return res.status(404).json({ error: 'Scheduled message not found' });
    }

    const denied = await checkMutatePermission(existing.channelId, existing.createdBy, userId);
    if (denied) return res.status(denied.status).json({ error: denied.error });

    // Merge any incoming schedule fields over the existing row, then normalize so
    // the persisted columns stay internally consistent (also handles switching
    // frequency, e.g. WEEKLY → MONTHLY).
    const normalized = normalizeSchedule({
      daysOfWeek: req.body.daysOfWeek ?? existing.daysOfWeek,
      monthlyMode: req.body.monthlyMode ?? existing.monthlyMode ?? undefined,
      monthlyValue: req.body.monthlyValue ?? existing.monthlyValue ?? undefined,
    });
    if ('error' in normalized) {
      return res.status(400).json({ error: normalized.error });
    }

    // Build partial update — always write the full normalized schedule so stale
    // columns from a previous frequency are cleared.
    const data: Record<string, unknown> = { ...normalized.data };
    if (title !== undefined) data.title = title;
    if (messageContent !== undefined) data.messageContent = messageContent;
    if (scheduledTime !== undefined) data.scheduledTime = scheduledTime;
    if (isActive !== undefined) data.isActive = isActive;

    // checkMutatePermission above authorised a channel admin to edit another user's message.
    const updated = await withWorkspaceScope(() =>
      db.scheduledMessage.update({
        where: { id },
        data,
      }),
    );

    // Re-sync Bull job
    const effectiveTime = scheduledTime ?? existing.scheduledTime;
    const effectiveActive = isActive ?? existing.isActive;
    const cron = cronFromSchedule(effectiveTime, normalized.data);

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
    // checkMutatePermission below decides who may delete it.
    const existing = await withWorkspaceScope(() =>
      db.scheduledMessage.findUnique({ where: { id } }),
    );
    if (!existing) {
      return res.status(404).json({ error: 'Scheduled message not found' });
    }

    const denied = await checkMutatePermission(existing.channelId, existing.createdBy, userId);
    if (denied) return res.status(denied.status).json({ error: denied.error });

    // checkMutatePermission above authorised a channel admin to delete another user's message.
    await withWorkspaceScope(() => db.scheduledMessage.delete({ where: { id } }));

    // Remove Bull job
    await scheduledMessageService.removeJob(id);

    logger.info(`[SCHEDULED-MESSAGE-CTRL] Deleted message ${id} by user ${userId}`);
    return res.json({ success: true });
  } catch (error) {
    logger.error('[SCHEDULED-MESSAGE-CTRL] Delete failed:', error);
    return res.status(500).json({ error: 'Failed to delete scheduled message' });
  }
}
