import type { Request, Response } from 'express';
import { z } from 'zod';
import { config } from '@/config/env';
import {
  isLiveKitNotFoundError,
  livekitService,
} from '@/services/liveKitService';
import { logger } from '@/utils/logger';

const SwitchTranscriptionAgentSchema = z.object({
  agentName: z.string().trim().min(1).max(128),
}).strict();

export class TranscriptionSwitchController {
  switchAgent = async (req: Request, res: Response): Promise<void> => {
    const parsed = SwitchTranscriptionAgentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: parsed.error.errors[0]?.message ?? 'Invalid request body',
      });
      return;
    }

    const callId = req.params.callId;
    const userId = req.user!.id;
    const { agentName } = parsed.data;

    if (!config.transcriptionSwitch.allowedAgentNames.includes(agentName)) {
      logger.warn('[TranscriptionSwitch] Target agent is not allowlisted', {
        callId,
        userId,
        agentName,
      });
      res.status(403).json({ success: false, error: 'Target agent is not allowed' });
      return;
    }

    try {
      const room = await livekitService.getRoomInfo(callId);
      if (!room) {
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

      if (
        previousDispatch &&
        !config.transcriptionSwitch.allowedAgentNames.includes(previousDispatch.agentName)
      ) {
        res.status(409).json({
          success: false,
          error: 'The current dispatch is not managed by the transcription switch API',
        });
        return;
      }

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
        source: 'transcription-switch-api',
        requestedBy: userId,
        callId,
      });

      logger.info('[TranscriptionSwitch] Agent switched', {
        callId,
        userId,
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
      logger.error('[TranscriptionSwitch] Failed to switch agent', {
        callId,
        userId,
        agentName,
        error,
      });
      res.status(502).json({ success: false, error: 'Failed to switch transcription agent' });
    }
  };
}

export const transcriptionSwitchController = new TranscriptionSwitchController();
