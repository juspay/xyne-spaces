import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { ParticipantInfo_Kind } from '@livekit/protocol';
import { normalizeHostControls, type HostControls } from '@xyne/shared';
import { repositories } from '@/database/repositories';
import {
  allowedSourcesForHostControls,
  getHostControls,
  isLiveKitNotFoundError,
  livekitService,
} from '@/services/liveKitService';
import { callHostControlService } from '@/services/callHostControlService';
import { logger } from '@/utils/logger';

class CallHostControlController {
  /** PATCH /api/calls/:callId/host-controls */
  setHostControls = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.id;
    const { callId } = req.params;
    const requestControls = req.body as Partial<HostControls> & Record<string, unknown>;

    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    try {
      const call = await repositories.calls.findByExternalId(callId);
      if (!call) {
        res.status(404).json({ success: false, error: 'Call not found' });
        return;
      }

      if (call.createdByUserId !== userId) {
        logger.warn(`[CallHostControlController] host-controls not host | callId=${callId}, userId=${userId}, hostId=${call.createdByUserId}`);
        res.status(403).json({ success: false, error: 'Only the call host can change host controls' });
        return;
      }

      const current = getHostControls(call);
      const hostControls = normalizeHostControls(requestControls, current) ?? current;

      const allowedSources = allowedSourcesForHostControls(hostControls);
      const rollbackAllowedSources = allowedSourcesForHostControls(current);
      const roomExists = (await livekitService.listRooms([callId])).length > 0;
      let appliedTo = 0;
      let mutedTurnedOffTrackCount = 0;
      let failedParticipantCount = 0;
      let targetIdentities: string[] = [];

      const previousMetadata = call.metadata;
      const existingMetadata =
        previousMetadata && typeof previousMetadata === 'object' && !Array.isArray(previousMetadata)
          ? (previousMetadata as Record<string, unknown>)
          : {};
      await repositories.calls.update(call.id, {
        metadata: { ...existingMetadata, hostControls },
      });

      try {
        if (roomExists) {
          const participants = await livekitService.listParticipantsOrThrow(callId);
          const targets = participants.filter(
            p =>
              p.identity !== userId &&
              !p.identity.startsWith('agent-') &&
              p.kind !== ParticipantInfo_Kind.EGRESS,
          );
          targetIdentities = targets.map(p => p.identity);
          const updateResults = await Promise.allSettled(
            targetIdentities.map(identity =>
              livekitService.updateParticipantPublishSources(callId, identity, allowedSources),
            ),
          );
          const failedUpdates = updateResults.filter(result => result.status === 'rejected');
          if (failedUpdates.length > 0) {
            failedParticipantCount = failedUpdates.length;
            let firstFailure: unknown;
            for (const result of updateResults) {
              if (result.status === 'rejected') {
                firstFailure = result.reason;
                break;
              }
            }
            logger.error(
              `[CallHostControlController] host-controls partial participant permission failure | callId=${callId}, failedUpdates=${failedParticipantCount}, attempted=${targets.length}`,
              firstFailure,
            );
            throw new Error(`Failed to update host controls for ${failedParticipantCount} participant(s)`);
          }

          appliedTo = targets.length;
          mutedTurnedOffTrackCount = await callHostControlService.muteTurnedOffHostControlTracks(
            callId,
            targetIdentities,
            hostControls,
          );

          const roomMetadataUpdated = await livekitService.setRoomHostControls(callId, hostControls);
          if (!roomMetadataUpdated) {
            throw new Error('LiveKit room disappeared while applying host controls');
          }
        }
      } catch (liveKitError) {
        await repositories.calls.update(call.id, {
          metadata:
            previousMetadata === null
              ? Prisma.DbNull
              : (previousMetadata as Prisma.InputJsonValue),
        });

        if (roomExists && targetIdentities.length > 0) {
          const rollbackResults = await Promise.allSettled(
            targetIdentities.map(identity =>
              livekitService.updateParticipantPublishSources(callId, identity, rollbackAllowedSources),
            ),
          );
          const failedRollbacks = rollbackResults.filter(result => result.status === 'rejected').length;
          if (failedRollbacks > 0) {
            logger.warn(
              `[CallHostControlController] host-controls participant permission rollback partial failure | callId=${callId}, failedRollbacks=${failedRollbacks}, attempted=${targetIdentities.length}`,
            );
          }
        }

        if (roomExists) {
          try {
            await livekitService.setRoomHostControls(callId, current);
          } catch (rollbackError) {
            logger.warn(`[CallHostControlController] host-controls room metadata rollback failed | callId=${callId}, error=${rollbackError}`);
          }
        }

        logger.error(`[CallHostControlController] host-controls LiveKit enforcement failed | callId=${callId}, error=`, liveKitError);
        res.status(502).json({
          success: false,
          error: 'Failed to apply host controls',
          code: 'LIVEKIT_ENFORCEMENT_FAILED',
        });
        return;
      }

      logger.info(`[CallHostControlController] host-controls updated | callId=${callId}, ${JSON.stringify(hostControls)}, appliedTo=${appliedTo}, failedParticipantCount=${failedParticipantCount}, mutedTurnedOffTrackCount=${mutedTurnedOffTrackCount}`);
      res.json({ success: true, hostControls, failedParticipantCount });
    } catch (error) {
      logger.error(`[CallHostControlController] host-controls failed | callId=${callId}, error=`, error);
      res.status(500).json({ success: false, error: 'Failed to update host controls' });
    }
  };

  /** POST /api/calls/:callId/remove-participant */
  removeCallParticipant = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.id;
    const { callId } = req.params;
    const { participantUserId } = req.body as { participantUserId?: string };

    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }
    if (!participantUserId) {
      res.status(400).json({ success: false, error: 'participantUserId is required' });
      return;
    }

    try {
      const call = await repositories.calls.findByExternalId(callId);
      if (!call) {
        res.status(404).json({ success: false, error: 'Call not found' });
        return;
      }

      if (call.createdByUserId !== userId) {
        logger.warn(`[CallHostControlController] remove-participant not host | callId=${callId}, userId=${userId}, hostId=${call.createdByUserId}`);
        res.status(403).json({ success: false, error: 'Only the call host can remove participants' });
        return;
      }

      if (participantUserId === userId) {
        res.status(400).json({ success: false, error: 'Cannot remove yourself' });
        return;
      }
      if (participantUserId.startsWith('agent-')) {
        res.status(400).json({ success: false, error: 'Cannot remove agents' });
        return;
      }

      const participant = await repositories.calls.markParticipantRemovedByHost({
        callId: call.id,
        participantUserId,
        removedAt: new Date(),
      });

      try {
        await livekitService.removeParticipant(callId, participantUserId);
      } catch (err) {
        if (isLiveKitNotFoundError(err)) {
          logger.info(`[CallHostControlController] remove-participant target already absent from LiveKit | callId=${callId}, targetUserId=${participantUserId}`);
        } else {
          if (participant) {
            await repositories.calls.restoreParticipantState(participant);
          }

          logger.error(`[CallHostControlController] remove-participant LiveKit removal failed | callId=${callId}, targetUserId=${participantUserId}, error=`, err);
          res.status(502).json({
            success: false,
            error: 'Failed to remove participant from room',
            code: 'LIVEKIT_REMOVAL_FAILED',
          });
          return;
        }
      }

      logger.info(`[CallHostControlController] remove-participant completed | callId=${callId}, targetUserId=${participantUserId}`);
      res.json({ success: true });
    } catch (error) {
      logger.error(`[CallHostControlController] remove-participant failed | callId=${callId}, targetUserId=${participantUserId}, error=`, error);
      res.status(500).json({ success: false, error: 'Failed to remove participant' });
    }
  };
}

export const callHostControlController = new CallHostControlController();
