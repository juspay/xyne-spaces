import { flushRemoteLogs, logger as structuredLogger } from '../appLogger';
import type { VideoPlaybackFailedFields, VideoPlaybackReadyFields } from './videoPlayback';

export function emitVideoPlaybackReady(fields: VideoPlaybackReadyFields): void {
  structuredLogger.info('video_playback_ready', fields);
}

export function emitVideoPlaybackFailed(fields: VideoPlaybackFailedFields): void {
  structuredLogger.error('video_playback_failed', fields);
  // Users often kill/restart the app right after a failed video; flush so the
  // failure is not lost with the in-memory buffer.
  void flushRemoteLogs();
}
