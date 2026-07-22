import { TrackSource } from 'livekit-server-sdk';
import type { HostControls } from '@xyne/shared';

export function isTrackTurnedOffByHostControls(
  source: TrackSource | undefined,
  hostControls: HostControls,
): boolean {
  return (
    (hostControls.turnOffAudio && source === TrackSource.MICROPHONE) ||
    (hostControls.turnOffCamera && source === TrackSource.CAMERA) ||
    (hostControls.turnOffScreenShare &&
      (source === TrackSource.SCREEN_SHARE || source === TrackSource.SCREEN_SHARE_AUDIO))
  );
}
