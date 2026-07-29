import { Request, Response, NextFunction } from 'express';
import { CallStatus, InvitationResponse } from '@prisma/client';
import { repositories } from '@/database/repositories';
import { logger } from '@/utils/logger';
import { db } from '@/database/client';

const ACTIVE_STATUSES: CallStatus[] = [CallStatus.ACTIVE, CallStatus.IN_PROGRESS];

/**
 * Middleware for internal (authenticated) call chat routes.
 * Resolves the call by externalId and verifies the authenticated user
 * is an accepted participant. Attaches call and userId to the request.
 */
export async function requireInternalCallParticipant(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { externalId } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const call = await repositories.calls.getPublicCallInfo(externalId);
    if (!call) {
      res.status(404).json({ error: 'Call not found' });
      return;
    }

    if (!ACTIVE_STATUSES.includes(call.status as CallStatus)) {
      res.json({ status: 'ended' });
      return;
    }

    const participant = await db.callParticipant.findFirst({
      where: {
        userId,
        callId: call.callId,
        response: InvitationResponse.ACCEPTED,
      },
    });

    if (!participant) {
      res.status(404).json({ error: 'Not an accepted participant of this call' });
      return;
    }

    // Attach to request for handlers
    (req as Request & { callChat: { callId: string; userId: string } }).callChat = {
      callId: call.callId,
      userId,
    };

    next();
  } catch (err) {
    logger.error(`[call-chat] requireInternalCallParticipant failed | error=${err}`);
    res.status(500).json({ error: 'Internal server error' });
  }
}

type CallChatRequest = Request & { callChat: { callId: string; userId: string } };

export const callChatController = {
  sendMessage: async (req: Request, res: Response): Promise<void> => {
    try {
      const { callId, userId } = (req as CallChatRequest).callChat;
      const { message } = req.body as { message?: string };

      if (!message || typeof message !== 'string' || message.trim().length === 0) {
        res.status(400).json({ error: 'message is required' });
        return;
      }
      if (message.length > 4000) {
        res.status(400).json({ error: 'message must be 4000 characters or fewer' });
        return;
      }

      const participant = await db.callParticipant.findFirst({
        where: { userId, callId },
        select: { displayName: true, isExternal: true, userId: true },
      });

      // Resolve display name from user record for internal users
      let displayName = participant?.displayName ?? 'Guest';
      if (participant && !participant.isExternal && participant.userId) {
        const user = await db.user.findUnique({
          where: { id: participant.userId },
          select: { displayName: true, name: true },
        });
        if (user) {
          displayName = user.displayName || user.name || displayName;
        }
      }

      const created = await repositories.callMessages.create({
        callId,
        participantId: userId,
        message: message.trim(),
      });

      res.status(201).json({ ...created, displayName, isExternal: participant?.isExternal ?? false });
    } catch (err) {
      logger.error(`[call-chat] sendMessage failed | error=${err}`);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  getMessages: async (req: Request, res: Response): Promise<void> => {
    try {
      const { callId } = (req as CallChatRequest).callChat;
      const { limit, before } = req.query as { limit?: string; before?: string };

      const messages = await repositories.callMessages.getByCallId(callId, {
        limit: limit ? Math.min(parseInt(limit, 10), 200) : 100,
        before: before || undefined,
      });

      res.json({ messages });
    } catch (err) {
      logger.error(`[call-chat] getMessages failed | error=${err}`);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  getParticipants: async (req: Request, res: Response): Promise<void> => {
    try {
      const { callId } = (req as CallChatRequest).callChat;

      const participants = await repositories.calls.getCallParticipantsPublic(callId);
      res.json({ participants });
    } catch (err) {
      logger.error(`[call-chat] getParticipants failed | error=${err}`);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
};
