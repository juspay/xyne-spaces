import { Request, Response } from 'express';
import { InvitationResponse } from '@prisma/client';
import { repositories } from '@/database/repositories';
import { livekitService } from '@/services/liveKitService';
import { logger } from '@/utils/logger';
import { db } from '@/database/client';
import {
  externalCallTokenService,
  extCallCookieName,
  extCallCookieOptions,
} from '@/services/externalCallTokenService';
import type { CallLobbyRequest } from '@/types/express';

const isProduction = process.env.NODE_ENV === 'production';

/** Helper — set the HTTP-only session cookie for an external participant. */
function setSessionCookie(
  res: Response,
  participantId: string,
  callId: string,
  externalId: string,
): void {
  const token = externalCallTokenService.sign({ participantId, callId, externalId });
  res.cookie(extCallCookieName(externalId), token, extCallCookieOptions(isProduction));
}

export const callLobbyController = {
  /**
   * GET /api/call-lobby/:externalId
   * Returns safe call metadata for the pre-join page.
   * If a valid session cookie exists, includes hasSession so frontend can skip the name form.
   */
  getCallInfo: async (req: Request, res: Response): Promise<void> => {
    try {
      const { call, callSession } = req as CallLobbyRequest;

      const base = { title: call.title, callType: call.callType, status: call.status };

      if (callSession) {
        res.json({ ...base, hasSession: true });
        return;
      }

      res.json(base);
    } catch (err) {
      logger.error(`[call-lobby] getCallInfo failed | error=${err}`);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  /**
   * POST /api/call-lobby/:externalId/request
   * Body: { displayName?: string }
   *
   * Cookie exists → restore ACCEPTED, optionally update displayName, return skipApproval.
   * No cookie   → validate displayName, create participant with REQUESTED, SET COOKIE.
   */
  requestToJoin: async (req: Request, res: Response): Promise<void> => {
    try {
      const { externalId } = req.params;
      const { call, callSession } = req as CallLobbyRequest;
      const { displayName } = req.body as { displayName?: string };

      // Session exists — skip approval
      if (callSession) {
        const trimmedName = displayName?.trim();
        await db.callParticipant.update({
          where: { id: callSession.participantId },
          data: {
            ...(trimmedName && { displayName: trimmedName }),
            response: InvitationResponse.ACCEPTED,
            joinedAt: null,
          },
        });

        logger.info(
          `[call-lobby] requestToJoin: session valid, skipping approval | participantId=${callSession.participantId}`,
        );
        res.status(200).json({ skipApproval: true });
        return;
      }

      // No session — displayName is required
      if (!displayName || typeof displayName !== 'string' || displayName.trim().length === 0) {
        res.status(400).json({ error: 'displayName is required' });
        return;
      }
      if (displayName.trim().length > 100) {
        res.status(400).json({ error: 'displayName must be 100 characters or fewer' });
        return;
      }

      const participant = await repositories.calls.createLobbyRequest({
        callId: call.callId,
        displayName: displayName.trim(),
      });

      // Set cookie at creation time — all subsequent requests are cookie-authenticated
      setSessionCookie(res, participant.id, call.callId, externalId);

      res.status(201).json({ participantId: participant.id });
    } catch (err) {
      logger.error(`[call-lobby] requestToJoin failed | error=${err}`);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  /**
   * GET /api/call-lobby/:externalId/status
   * Polls the current admission status for an external participant.
   * Participant identity comes from the session cookie.
   */
  getLobbyStatus: async (req: Request, res: Response): Promise<void> => {
    try {
      const { call, callSession } = req as CallLobbyRequest;

      if (!callSession) {
        res.status(403).json({ error: 'Not authenticated for this call' });
        return;
      }

      const row = await repositories.calls.getLobbyStatus({
        participantId: callSession.participantId,
        callId: call.callId,
      });

      if (!row) {
        res.status(404).json({ error: 'Participant not found' });
        return;
      }

      res.json({ response: row.response });
    } catch (err) {
      logger.error(`[call-lobby] getLobbyStatus failed | error=${err}`);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  /**
   * POST /api/call-lobby/:externalId/join
   * Joins an admitted external participant — returns a LiveKit token.
   * All identity comes from the session cookie + middleware-resolved call.
   */
  externalJoin: async (req: Request, res: Response): Promise<void> => {
    try {
      const { call, callSession } = req as CallLobbyRequest;

      if (!callSession) {
        res.status(403).json({ error: 'Not authenticated for this call' });
        return;
      }

      const participant = await repositories.calls.externalJoin({
        participantId: callSession.participantId,
        callId: call.callId,
      });

      if (!participant) {
        res.status(403).json({ error: 'Not admitted or already joined' });
        return;
      }

      const token = await livekitService.generateAccessToken({
        userIdentity: participant.id,
        roomName: call.roomName,
        userName: participant.displayName ?? 'Guest',
        metadata: JSON.stringify({ isExternal: true }),
      });

      // Refresh cookie on join
      setSessionCookie(res, participant.id, call.callId, call.roomName);

      res.json({
        token,
        serverUrl: livekitService.getServerUrl(),
        externalId: call.roomName,
        callType: call.callType,
        participantId: participant.id,
      });
    } catch (err) {
      logger.error(`[call-lobby] externalJoin failed | error=${err}`);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  /**
   * POST /api/call-lobby/:externalId/rejoin
   * Rejoins after disconnect. Cookie exists → restore ACCEPTED + skipApproval.
   * No cookie → 403.
   */
  rejoinLobby: async (req: Request, res: Response): Promise<void> => {
    try {
      const { callSession } = req as CallLobbyRequest;

      if (!callSession) {
        res.status(403).json({ error: 'Not authenticated for this call' });
        return;
      }

      await db.callParticipant.update({
        where: { id: callSession.participantId },
        data: { response: InvitationResponse.ACCEPTED, joinedAt: null },
      });

      logger.info(
        `[call-lobby] rejoinLobby: session valid, skipping approval | participantId=${callSession.participantId}`,
      );
      res.json({ skipApproval: true });
    } catch (err) {
      logger.error(`[call-lobby] rejoinLobby failed | error=${err}`);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  sendMessage: async (req: Request, res: Response): Promise<void> => {
    try {
      const { call, callParticipantId: participantId } = req as CallLobbyRequest;
      const { message } = req.body as { message?: string };

      if (!participantId) {
        res.status(403).json({ error: 'Not authenticated' });
        return;
      }
      if (!message || typeof message !== 'string' || message.trim().length === 0) {
        res.status(400).json({ error: 'message is required' });
        return;
      }
      if (message.length > 4000) {
        res.status(400).json({ error: 'message must be 4000 characters or fewer' });
        return;
      }

      const participant = await db.callParticipant.findFirst({
        where: { userId: participantId, callId: call.callId },
        select: { displayName: true, isExternal: true, userId: true },
      });

      // Resolve display name
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
        callId: call.callId,
        participantId,
        message: message.trim(),
      });

      res.status(201).json({ ...created, displayName, isExternal: participant?.isExternal ?? false });
    } catch (err) {
      logger.error(`[call-lobby] sendMessage failed | error=${err}`);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  getMessages: async (req: Request, res: Response): Promise<void> => {
    try {
      const { call } = req as CallLobbyRequest;
      const { limit, before } = req.query as { limit?: string; before?: string };

      const messages = await repositories.callMessages.getByCallId(call.callId, {
        limit: limit ? Math.min(parseInt(limit, 10), 200) : 100,
        before: before || undefined,
      });

      res.json({ messages });
    } catch (err) {
      logger.error(`[call-lobby] getMessages failed | error=${err}`);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  /**
   * GET /api/call-lobby/:externalId/participants
   */
  getParticipants: async (req: Request, res: Response): Promise<void> => {
    try {
      const { call } = req as CallLobbyRequest;

      const participants = await repositories.calls.getCallParticipantsPublic(call.callId);
      res.json({ participants });
    } catch (err) {
      logger.error(`[call-lobby] getParticipants failed | error=${err}`);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
};
