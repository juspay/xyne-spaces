import { timingSafeEqual } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { config } from '@/config/env';
import { AppError } from '@/middleware/errorHandler';
import { isMeetBotStatus, meetBotOf, meetNotetakerService } from '@/services/meetNotetakerService';
import { logger } from '@/utils/logger';
import type { Call } from '@prisma/client';

const sendSchema = z.object({ meetingUrl: z.string().trim().min(1).max(2000) });
const livekitSchema = z.object({
  speaker: z
    .object({ key: z.string().trim().min(1).max(200), name: z.string().trim().min(1).max(100) })
    .optional(),
});
const statusSchema = z.object({
  status: z.string().refine(isMeetBotStatus, 'Unknown status'),
  reason: z.string().max(100).optional(),
  message: z.string().max(2000).optional(),
});

function toResponse(call: Call) {
  return {
    callId: call.id,
    externalId: call.externalId,
    status: call.status,
    title: call.title,
    meetingUrl: call.roomLink,
    meetBot: meetBotOf(call),
  };
}

function fail(res: Response, error: unknown, context: string): void {
  if (error instanceof AppError) {
    res.status(error.statusCode).json({ success: false, error: error.message });
    return;
  }
  logger.error(`[MeetNotetaker] ${context}_failed`, { error: error instanceof Error ? error.message : String(error) });
  res.status(500).json({ success: false, error: 'Something went wrong with the notetaker' });
}

/** Checks the shared key the meet-bot service sends on its callbacks. */
export function verifyMeetBot(req: Request, res: Response, next: NextFunction): void {
  const expected = config.meetBot.apiKey;
  const given = req.headers['x-api-key'];
  if (!expected) {
    res.status(503).json({ error: 'Meet notetaker is not configured' });
    return;
  }
  const ok =
    typeof given === 'string' &&
    Buffer.byteLength(given) === Buffer.byteLength(expected) &&
    timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  if (!ok) {
    logger.warn('[MeetNotetaker] bot_callback_unauthorized', { path: req.path });
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

export const meetNotetakerController = {
  // GET /api/calls/meet-notetaker/availability
  availability: (_req: Request, res: Response): void => {
    res.json({ success: true, enabled: meetNotetakerService.enabled });
  },

  // POST /api/calls/meet-notetaker  { meetingUrl }
  send: async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.id;
    const workspaceId = req.user?.workspaceId;
    if (!userId || !workspaceId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }
    const parsed = sendSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: 'meetingUrl is required' });
      return;
    }
    try {
      const { call, alreadySentBy } = await meetNotetakerService.sendToMeeting({
        userId,
        workspaceId,
        meetingUrl: parsed.data.meetingUrl,
      });
      res.status(alreadySentBy ? 200 : 201).json({
        success: true,
        call: toResponse(call),
        alreadySentBy: alreadySentBy && { ...alreadySentBy, isYou: alreadySentBy.userId === userId },
      });
    } catch (error) {
      fail(res, error, 'send');
    }
  },

  // DELETE /api/calls/meet-notetaker/:callId  (callId = the call's externalId)
  stop: async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.id;
    const callExternalId = req.params.callId;
    if (!userId || !callExternalId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }
    try {
      const call = await meetNotetakerService.stop({ userId, callExternalId });
      res.json({ success: true, call: toResponse(call) });
    } catch (error) {
      fail(res, error, 'stop');
    }
  },

  // POST /api/meet-bot/sessions/:callId/status  (bot → backend)
  botStatus: async (req: Request, res: Response): Promise<void> => {
    const parsed = statusSchema.safeParse(req.body);
    const callExternalId = req.params.callId;
    if (!parsed.success || !callExternalId) {
      res.status(400).json({ error: 'Invalid status event' });
      return;
    }
    const { status, reason, message } = parsed.data;
    if (!isMeetBotStatus(status)) {
      res.status(400).json({ error: 'Invalid status event' });
      return;
    }
    try {
      await meetNotetakerService.handleBotStatus(callExternalId, { status, reason, message });
      res.json({ success: true });
    } catch (error) {
      fail(res, error, 'bot_status');
    }
  },

  // POST /api/meet-bot/sessions/:callId/livekit  (bot → backend, once admitted)
  botLivekit: async (req: Request, res: Response): Promise<void> => {
    const callExternalId = req.params.callId;
    if (!callExternalId) {
      res.status(400).json({ error: 'callId is required' });
      return;
    }
    const parsed = livekitSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid speaker' });
      return;
    }
    try {
      res.json(await meetNotetakerService.startBotRoom(callExternalId, parsed.data.speaker));
    } catch (error) {
      fail(res, error, 'bot_livekit');
    }
  },
};
