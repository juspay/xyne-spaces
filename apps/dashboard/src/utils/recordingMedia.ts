import { Track, type Room } from 'livekit-client';
import { RecordingType } from '@xyne/shared';
import {
  CALL_MEDIA_QUALITY_CONFIG,
  getCallMediaQualitySettings,
  type CallMediaQuality,
} from '../hooks/useCallMediaQualitySettings';

export type RecordingVideoSource = Track.Source.Camera | Track.Source.ScreenShare;

export interface LocalVideoState {
  isCameraEnabled: boolean;
  isScreenShareEnabled: boolean;
}

interface CaptureResolution {
  width: number;
  height: number;
  frameRate: number;
}

const VIDEO_SOURCES: readonly RecordingVideoSource[] = [
  Track.Source.Camera,
  Track.Source.ScreenShare,
];

const pendingToggles = new Set<RecordingVideoSource>();

export const isVideoRecordingType = (type: RecordingType | null | undefined): boolean =>
  !!type && type !== RecordingType.AUDIO_ONLY;

export const canShareScreen = (): boolean =>
  typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;

/** Published counts as enabled, so pausing (which mutes) doesn't read as off. */
export const isLocalVideoEnabled = (room: Room, source: RecordingVideoSource): boolean =>
  !!room.localParticipant.getTrackPublication(source);

export const getLocalVideoState = (room: Room): LocalVideoState => ({
  isCameraEnabled: isLocalVideoEnabled(room, Track.Source.Camera),
  isScreenShareEnabled: isLocalVideoEnabled(room, Track.Source.ScreenShare),
});

const getCaptureResolution = (quality: CallMediaQuality): CaptureResolution => {
  const { width, height, frameRate } = CALL_MEDIA_QUALITY_CONFIG[quality];
  return { width, height, frameRate };
};

const enableLocalVideo = async (room: Room, source: RecordingVideoSource): Promise<void> => {
  const { videoQuality, screenShareQuality } = getCallMediaQualitySettings();

  if (source === Track.Source.Camera) {
    await room.localParticipant.setCameraEnabled(true, {
      resolution: getCaptureResolution(videoQuality),
    });
  } else {
    await room.localParticipant.setScreenShareEnabled(true, {
      resolution: getCaptureResolution(screenShareQuality),
    });
  }
};

const disableLocalVideo = async (room: Room, source: RecordingVideoSource): Promise<void> => {
  const { localParticipant } = room;

  if (source === Track.Source.ScreenShare) {
    await localParticipant.setScreenShareEnabled(false);
    return;
  }

  // setCameraEnabled(false) only mutes; unpublish so the camera device actually stops.
  const track = localParticipant.getTrackPublication(Track.Source.Camera)?.track;
  if (track) await localParticipant.unpublishTrack(track);
};

/** Flips a video source on or off. Ignored while the previous toggle is still settling. */
export const toggleLocalVideo = async (room: Room, source: RecordingVideoSource): Promise<void> => {
  if (pendingToggles.has(source)) return;
  pendingToggles.add(source);

  try {
    if (isLocalVideoEnabled(room, source)) {
      await disableLocalVideo(room, source);
    } else {
      await enableLocalVideo(room, source);
    }
  } finally {
    pendingToggles.delete(source);
  }
};

export const setLocalVideoMuted = (room: Room, muted: boolean): void => {
  for (const source of VIDEO_SOURCES) {
    const publication = room.localParticipant.getTrackPublication(source);
    void (muted ? publication?.mute() : publication?.unmute());
  }
};
