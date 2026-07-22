import type { HostControls } from '@xyne/shared';
import { repositories } from '@/database/repositories';
import { logger } from '@/utils/logger';
import {
  allowedSourcesForHostControls,
  getHostControls,
  hasTurnedOffHostControl,
  livekitService,
} from '@/services/liveKitService';
import { isTrackTurnedOffByHostControls } from '@/services/callHostControlUtils';

class CallHostControlService {
  async applyHostControlsToParticipant(
    roomName: string,
    participantIdentity: string,
    reason: string,
  ): Promise<void> {
    if (participantIdentity.startsWith('agent-')) return;

    try {
      const call = await repositories.calls.findByExternalId(roomName);
      if (!call || call.createdByUserId === participantIdentity) return;

      const hostControls = getHostControls(call);
      if (!hasTurnedOffHostControl(hostControls)) return;

      await livekitService.updateParticipantPublishSources(
        roomName,
        participantIdentity,
        allowedSourcesForHostControls(hostControls),
      );

      logger.info(
        `[CallHostControlService] Applied host controls to participant | room=${roomName}, participant=${participantIdentity}, reason=${reason}, hostControls=${JSON.stringify(hostControls)}`,
      );
    } catch (error) {
      logger.warn(
        `[CallHostControlService] Failed to apply host controls to participant | room=${roomName}, participant=${participantIdentity}, reason=${reason}, error=${error}`,
      );
    }
  }

  async muteTurnedOffHostControlTracks(
    roomName: string,
    targetIdentities: string[],
    hostControls: HostControls,
  ): Promise<number> {
    if (!hasTurnedOffHostControl(hostControls)) return 0;

    const participants = await livekitService.listParticipantsOrThrow(roomName);
    const identitySet = new Set(targetIdentities);
    const muteRequests: Promise<void>[] = [];

    for (const participant of participants) {
      if (!identitySet.has(participant.identity)) {
        continue;
      }

      for (const track of participant.tracks || []) {
        if (!track.sid || track.muted || !isTrackTurnedOffByHostControls(track.source, hostControls)) {
          continue;
        }

        logger.info(
          `[CallHostControlService] muting turned-off track | roomName=${roomName}, identity=${participant.identity}, source=${track.source}, trackSid=${track.sid}`,
        );
        muteRequests.push(livekitService.muteTrack(roomName, participant.identity, track.sid, true));
      }
    }

    const results = await Promise.allSettled(muteRequests);
    const mutedCount = results.filter(({ status }) => status === 'fulfilled').length;
    const failedCount = results.length - mutedCount;
    if (failedCount > 0) {
      let firstFailure: unknown;
      for (const result of results) {
        if (result.status === 'rejected') {
          firstFailure = result.reason;
          break;
        }
      }
      logger.error(
        `[CallHostControlService] turned-off-track mute partial failure | roomName=${roomName}, failedCount=${failedCount}, attempted=${muteRequests.length}`,
        firstFailure,
      );
      throw new Error(`Failed to mute ${failedCount} turned-off host-control track(s)`);
    }

    return mutedCount;
  }
}

export const callHostControlService = new CallHostControlService();
