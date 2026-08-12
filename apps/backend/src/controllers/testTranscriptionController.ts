import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  isLiveKitNotFoundError,
  livekitService,
} from '@/services/liveKitService';
import { logger } from '@/utils/logger';

const TestTranscriptionSchema = z.object({
  agentName: z.string().trim().min(1).max(128),
}).strict();

export class TestTranscriptionController {
  start = async (req: Request, res: Response): Promise<void> => {
    const parsed = TestTranscriptionSchema.safeParse(req.body);
    if (!parsed.success) {
      logger.warn('[TestTranscription] Invalid request body', {
        userId: req.user?.id,
        userEmail: req.user?.email,
        callId: req.params.callId,
        validationError: parsed.error.errors[0]?.message,
      });
      res.status(400).json({
        success: false,
        error: parsed.error.errors[0]?.message ?? 'Invalid request body',
      });
      return;
    }

    const callId = req.params.callId;
    const userId = req.user!.id;
    const userEmail = req.user!.email;
    const { agentName } = parsed.data;

    logger.info('[TestTranscription] Starting agent replacement', {
      userId,
      userEmail,
      callId,
      agentName,
    });

    try {
      const room = await livekitService.getRoomInfo(callId);
      if (!room) {
        logger.warn('[TestTranscription] Active LiveKit room not found', {
          userId,
          userEmail,
          callId,
          agentName,
        });
        res.status(404).json({ success: false, error: 'Active LiveKit room not found' });
        return;
      }

      const [dispatches, participants] = await Promise.all([
        livekitService.listAgentDispatches(callId),
        livekitService.listParticipantsOrThrow(callId),
      ]);
      const agentParticipants = participants.filter(participant =>
        participant.identity.startsWith('agent-')
      );

      // A transcription room is expected to have at most one agent. Refusing an
      // ambiguous switch is safer than disconnecting an unrelated room agent.
      if (dispatches.length > 1 || agentParticipants.length > 1) {
        logger.warn('[TestTranscription] Ambiguous agent state; replacement refused', {
          userId,
          userEmail,
          callId,
          agentName,
          dispatchCount: dispatches.length,
          agentParticipantCount: agentParticipants.length,
        });
        res.status(409).json({
          success: false,
          error: 'Multiple agents are present; refusing an ambiguous switch',
          dispatchCount: dispatches.length,
          agentParticipantCount: agentParticipants.length,
        });
        return;
      }

      const previousDispatch = dispatches[0];
      const previousParticipant = agentParticipants[0];

      if (previousDispatch) {
        await livekitService.deleteAgentDispatch(callId, previousDispatch.id);
      }

      if (previousParticipant) {
        try {
          await livekitService.removeParticipant(callId, previousParticipant.identity);
        } catch (error) {
          // Deleting an explicit dispatch may disconnect its participant before
          // RemoveParticipant runs. Treat that race as successful cleanup.
          if (!isLiveKitNotFoundError(error)) throw error;
        }
      }

      const dispatch = await livekitService.dispatchAgent(callId, agentName, {
        source: 'test-transcription-api',
        requestedBy: userId,
        callId,
      });

      logger.info('[TestTranscription] Test agent dispatched', {
        callId,
        userId,
        userEmail,
        previousAgentName: previousDispatch?.agentName ?? null,
        previousParticipantIdentity: previousParticipant?.identity ?? null,
        agentName,
        dispatchId: dispatch.id,
      });

      res.json({
        success: true,
        callId,
        removed: {
          agentName: previousDispatch?.agentName ?? null,
          participantIdentity: previousParticipant?.identity ?? null,
          dispatchId: previousDispatch?.id ?? null,
        },
        dispatched: {
          agentName: dispatch.agentName,
          dispatchId: dispatch.id,
        },
      });
    } catch (error) {
      logger.error('[TestTranscription] Failed to switch agent', {
        callId,
        userId,
        userEmail,
        agentName,
        error,
      });
      res.status(502).json({ success: false, error: 'Failed to start test transcription' });
    }
  };
}

export const testTranscriptionController = new TestTranscriptionController();
