import { Request, Response } from 'express';
import { InvitationResponse, Prisma } from '@prisma/client';
import { buildCallInviteUrl } from '@/utils/urlUtils';
import { repositories } from '@/database/repositories';
import {
  livekitService,
  allowedSourcesFor,
  hasActiveLock,
  getHostControls,
} from '@/services/liveKitService';
import { logger } from '@/utils/logger';
import { db } from '@/database/client';
import {
  externalCallTokenService,
  extCallCookieName,
  extCallCookieOptions,
} from '@/services/externalCallTokenService';
import type { CallLobbyRequest } from '@/types/express';
import type { CallParticipantMetadata } from '@xyne/shared';

const isProduction = process.env.NODE_ENV === 'production';

function hasRemovedByHost(metadata: unknown): boolean {
  return (metadata as CallParticipantMetadata | null)?.removedByHost === true;
}

function stripRemovedByHostFlag(metadata: unknown): Prisma.InputJsonValue {
  const meta = (metadata as CallParticipantMetadata | null) ?? {};
  const { removedByHost: _removedByHost, ...rest } = meta;
  return rest as Prisma.InputJsonValue;
}

/** Helper — set the HTTP-only session cookie for an external participant. */
function setSessionCookie(
  res: Response,
  participantId: string,
  callId: string,
  externalId: string
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
        const existing = await repositories.calls.findExternalParticipantById({
          participantId: callSession.participantId,
          callId: call.callId,
        });
        if (!existing) {
          res.status(403).json({ error: 'Not authenticated for this call' });
          return;
        }

        if (hasRemovedByHost(existing.metadata)) {
          await repositories.calls.markExternalParticipantRequested({
            participantId: callSession.participantId,
            ...(trimmedName && { displayName: trimmedName }),
            respondedAt: new Date(),
          });

          logger.info(
            `[call-lobby] requestToJoin: removed participant re-requested approval | participantId=${callSession.participantId}`,
          );
          res.status(200).json({ skipApproval: false, participantId: callSession.participantId });
          return;
        }

        await repositories.calls.acceptExternalParticipantSession({
          participantId: callSession.participantId,
          ...(trimmedName && { displayName: trimmedName }),
        });

        logger.info(
          `[call-lobby] requestToJoin: session valid, skipping approval | participantId=${callSession.participantId}`
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

      if (hasRemovedByHost(participant.metadata)) {
        await repositories.calls.updateParticipantMetadata(
          participant.id,
          stripRemovedByHostFlag(participant.metadata),
        );
      }

      const callRecord = await repositories.calls.findById(call.callId);
      const hostControls = getHostControls(callRecord);
      const lockedSources = hasActiveLock(hostControls)
        ? allowedSourcesFor(hostControls)
        : undefined;

      if (hasActiveLock(hostControls)) {
        try {
          await livekitService.setRoomHostControls(call.roomName, hostControls);
        } catch (err) {
          logger.warn(
            `[call-lobby] externalJoin: failed to sync host controls metadata | callId=${call.roomName}, error=${err}`,
          );
        }
      }

      const token = await livekitService.generateAccessToken({
        userIdentity: participant.id,
        roomName: call.roomName,
        userName: participant.displayName ?? 'Guest',
        metadata: JSON.stringify({ isExternal: true }),
        canPublishSources: lockedSources,
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
      const { call, callSession } = req as CallLobbyRequest;

      if (!callSession) {
        res.status(403).json({ error: 'Not authenticated for this call' });
        return;
      }

      const existing = await repositories.calls.findExternalParticipantById({
        participantId: callSession.participantId,
        callId: call.callId,
      });
      if (!existing) {
        res.status(403).json({ error: 'Not authenticated for this call' });
        return;
      }

      if (hasRemovedByHost(existing.metadata)) {
        await repositories.calls.markExternalParticipantRequested({
          participantId: callSession.participantId,
          respondedAt: new Date(),
        });

        logger.info(
          `[call-lobby] rejoinLobby: removed participant re-requested approval | participantId=${callSession.participantId}`,
        );
        res.json({ skipApproval: false, participantId: callSession.participantId });
        return;
      }

      await repositories.calls.acceptExternalParticipantSession({
        participantId: callSession.participantId,
      });

      logger.info(
        `[call-lobby] rejoinLobby: session valid, skipping approval | participantId=${callSession.participantId}`
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

      res
        .status(201)
        .json({ ...created, displayName, isExternal: participant?.isExternal ?? false });
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

  /**
   * GET /api/call-lobby/:externalId/recording-state
   * Returns the active in-call recording state for an authenticated external participant.
   */
  getRecordingState: async (req: Request, res: Response): Promise<void> => {
    try {
      const { call, callSession } = req as CallLobbyRequest;

      if (callSession?.response !== InvitationResponse.ACCEPTED) {
        res.status(403).json({ error: 'Not admitted for this call' });
        return;
      }

      const recording = await repositories.callRecordings.findActiveByCallId(call.callId);

      if (!recording) {
        res.json({ activeRecording: null });
        return;
      }

      const starter = await db.user.findUnique({
        where: { id: recording.startedBy },
        select: { displayName: true, name: true },
      });

      res.json({
        activeRecording: {
          recordingId: recording.id,
          startedBy: recording.startedBy,
          startedByName: starter?.displayName || starter?.name || null,
          startedAt: recording.startedAt.getTime(),
          recordingType: recording.recordingType,
        },
      });
    } catch (err) {
      logger.error(`[call-lobby] getRecordingState failed | error=${err}`);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  /**
   * GET /api/call-lobby/:externalId/invite-url
   * Returns the full external call invite URL for this call.
   * No session required — the URL is constructed from backend config.
   */
  getInviteUrl: async (req: Request, res: Response): Promise<void> => {
    try {
      const { externalId } = req.params;
      const url = buildCallInviteUrl(externalId);
      res.json({ url });
    } catch (err) {
      logger.error(`[call-lobby] getInviteUrl failed | error=${err}`);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
};
