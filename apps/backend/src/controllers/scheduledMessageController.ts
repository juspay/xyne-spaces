import { Request, Response } from 'express';
import { ChannelRole } from '@xyne/shared';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { buildCronPattern, type MonthlyMode } from '@/utils/cronUtils';
import { scheduledMessageService } from '@/services/scheduledMessageService';
import { withWorkspaceScope } from '@/database/tenant/context';

// ── Schedule validation / normalization ──────────────────────────────────────
// Normalizes the raw schedule fields into exactly what we persist. For WEEKLY,
// the monthly columns are nulled; for MONTHLY, daysOfWeek is "" and only the
// columns relevant to the chosen monthlyMode are set.
interface NormalizedSchedule {
  frequency: 'WEEKLY' | 'MONTHLY';
  daysOfWeek: string;
  monthlyMode: MonthlyMode | null;
  dayOfMonth: number | null;
  weekOrdinal: string | null;
  weekday: number | null;
}

interface ScheduleInput {
  frequency?: string;
  daysOfWeek?: string;
  monthlyMode?: string;
  dayOfMonth?: number;
  weekOrdinal?: string;
  weekday?: number;
}

function normalizeSchedule(input: ScheduleInput): { error: string } | { data: NormalizedSchedule } {
  const frequency = input.frequency ?? 'WEEKLY';
  if (frequency !== 'WEEKLY' && frequency !== 'MONTHLY') {
    return { error: 'frequency must be WEEKLY or MONTHLY' };
  }

  if (frequency === 'WEEKLY') {
    if (!input.daysOfWeek || !/^[0-6](,[0-6])*$/.test(input.daysOfWeek)) {
      return { error: 'daysOfWeek must be a comma-separated list of 0-6' };
    }
    return {
      data: { frequency, daysOfWeek: input.daysOfWeek, monthlyMode: null, dayOfMonth: null, weekOrdinal: null, weekday: null },
    };
  }

  // MONTHLY
  const mode = input.monthlyMode;
  if (mode !== 'DAY_OF_MONTH' && mode !== 'NTH_WEEKDAY' && mode !== 'LAST_DAY') {
    return { error: 'monthlyMode must be DAY_OF_MONTH, NTH_WEEKDAY or LAST_DAY' };
  }

  if (mode === 'DAY_OF_MONTH') {
    const d = Number(input.dayOfMonth);
    if (!Number.isInteger(d) || d < 1 || d > 28) {
      return { error: 'dayOfMonth must be an integer between 1 and 28' };
    }
    return { data: { frequency, daysOfWeek: '', monthlyMode: mode, dayOfMonth: d, weekOrdinal: null, weekday: null } };
  }

  if (mode === 'NTH_WEEKDAY') {
    const ord = input.weekOrdinal;
    if (!ord || !['1', '2', '3', '4', 'LAST'].includes(ord)) {
      return { error: 'weekOrdinal must be 1, 2, 3, 4 or LAST' };
    }
    const w = Number(input.weekday);
    if (!Number.isInteger(w) || w < 0 || w > 6) {
      return { error: 'weekday must be an integer between 0 and 6' };
    }
    return { data: { frequency, daysOfWeek: '', monthlyMode: mode, dayOfMonth: null, weekOrdinal: ord, weekday: w } };
  }

  // LAST_DAY — no extra fields
  return { data: { frequency, daysOfWeek: '', monthlyMode: mode, dayOfMonth: null, weekOrdinal: null, weekday: null } };
}

function cronFromSchedule(scheduledTime: string, s: NormalizedSchedule): string {
  return buildCronPattern({
    scheduledTime,
    frequency: s.frequency,
    daysOfWeek: s.daysOfWeek,
    monthlyMode: s.monthlyMode ?? undefined,
    dayOfMonth: s.dayOfMonth ?? undefined,
    weekOrdinal: s.weekOrdinal ?? undefined,
    weekday: s.weekday ?? undefined,
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
      frequency: req.body.frequency ?? existing.frequency,
      daysOfWeek: req.body.daysOfWeek ?? existing.daysOfWeek,
      monthlyMode: req.body.monthlyMode ?? existing.monthlyMode ?? undefined,
      dayOfMonth: req.body.dayOfMonth ?? existing.dayOfMonth ?? undefined,
      weekOrdinal: req.body.weekOrdinal ?? existing.weekOrdinal ?? undefined,
      weekday: req.body.weekday ?? existing.weekday ?? undefined,
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
