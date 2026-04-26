import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { CallStatus } from '@prisma/client';
import { callLobbyController } from '@/controllers/callLobbyController';
import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import { logger } from '@/utils/logger';
import {
  externalCallTokenService,
  extCallCookieName,
  clearExtCallCookie,
} from '@/services/externalCallTokenService';
import type { CallLobbyRequest } from '@/types/express';

// Statuses a call may be in when external users try to enter the lobby.
// SCHEDULED is included so externals who click the invitation link before the
// host starts the call land on the pre-join / waiting view instead of being
// told "call ended".
const JOINABLE_STATUSES: CallStatus[] = [
  CallStatus.SCHEDULED,
  CallStatus.ACTIVE,
  CallStatus.IN_PROGRESS,
];

const router = Router();

// ---------------------------------------------------------------------------
// Layer 1: resolveCallSession
//
// Runs on ALL :externalId routes. Resolves the call from the DB, checks for
// a valid session cookie, and attaches req.call + req.callSession.
// Does NOT filter by participant status — handlers decide what states they accept.
// ---------------------------------------------------------------------------

async function resolveCallSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { externalId } = req.params;
    const lobbyReq = req as CallLobbyRequest;

    const call = await repositories.calls.getPublicCallInfo(externalId);
    if (!call) {
      clearExtCallCookie(res, externalId);
      res.status(404).json({ error: 'Call not found' });
      return;
    }

    if (!JOINABLE_STATUSES.includes(call.status)) {
      clearExtCallCookie(res, externalId);
      res.json({ status: 'ended' });
      return;
    }

    lobbyReq.call = call;
    lobbyReq.callSession = null;

    // Check cookie — just verify the participant exists for this call
    const cookieToken = req.cookies?.[extCallCookieName(externalId)] as string | undefined;
    if (cookieToken) {
      const payload = externalCallTokenService.verify(cookieToken);
      if (payload && payload.externalId === externalId && payload.callId === call.callId) {
        const existing = await db.callParticipant.findFirst({
          where: {
            id: payload.participantId,
            callId: call.callId,
            isExternal: true,
          },
          select: { id: true, response: true },
        });

        if (existing) {
          lobbyReq.callSession = { participantId: existing.id, response: existing.response ?? 'REQUESTED' };
        } else {
          clearExtCallCookie(res, externalId);
        }
      } else {
        clearExtCallCookie(res, externalId);
      }
    }

    next();
  } catch (err) {
    logger.error(`[call-lobby] resolveCallSession failed | error=${err}`);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ---------------------------------------------------------------------------
// Layer 2: requireCallParticipant
//
// For protected routes (messages, participants). Ensures the request has an
// authenticated external participant via cookie session.
// Sets req.callParticipantId.
// Internal (logged-in) users use /api/calls/chat/ endpoints instead.
// ---------------------------------------------------------------------------

async function requireCallParticipant(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const lobbyReq = req as CallLobbyRequest;

    if (lobbyReq.callSession) {
      lobbyReq.callParticipantId = lobbyReq.callSession.participantId;
      next();
      return;
    }

    res.status(403).json({ error: 'Not authenticated for this call' });
  } catch (err) {
    logger.error(`[call-lobby] requireCallParticipant failed | error=${err}`);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ---------------------------------------------------------------------------
// Routes — ALL :externalId routes go through resolveCallSession
// ---------------------------------------------------------------------------

router.get('/:externalId', resolveCallSession, callLobbyController.getCallInfo);
router.post('/:externalId/request', resolveCallSession, callLobbyController.requestToJoin);
router.get('/:externalId/status', resolveCallSession, callLobbyController.getLobbyStatus);
router.post('/:externalId/join', resolveCallSession, callLobbyController.externalJoin);
router.post('/:externalId/rejoin', resolveCallSession, callLobbyController.rejoinLobby);
router.post('/:externalId/messages', resolveCallSession, requireCallParticipant, callLobbyController.sendMessage);
router.get('/:externalId/messages', resolveCallSession, requireCallParticipant, callLobbyController.getMessages);
router.get('/:externalId/participants', resolveCallSession, requireCallParticipant, callLobbyController.getParticipants);

export default router;
