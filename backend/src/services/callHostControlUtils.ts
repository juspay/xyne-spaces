import { TrackSource } from 'livekit-server-sdk';
import type { HostControls } from '@xyne/shared';

export function isTrackLockedByHostControls(
  source: TrackSource | undefined,
  hostControls: HostControls,
): boolean {
  return (
    (hostControls.lockMic && source === TrackSource.MICROPHONE) ||
    (hostControls.lockCamera && source === TrackSource.CAMERA) ||
    (hostControls.lockScreenShare &&
      (source === TrackSource.SCREEN_SHARE || source === TrackSource.SCREEN_SHARE_AUDIO))
  );
}
