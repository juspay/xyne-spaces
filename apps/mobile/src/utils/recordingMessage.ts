import type { RecordingPreview } from '@/src/types/recordings';

/** Shared extraction of the recording metadata already used by the v2 chat pill. */
export function recordingPreviewFromMetadata(value: unknown, title = ''): RecordingPreview | null {
  try {
    const metadata = typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
    if (!metadata || typeof metadata !== 'object') return null;
    const data = metadata as Record<string, unknown>;
    if (
      data['isRecordingMessage'] !== true ||
      typeof data['callId'] !== 'string' ||
      !data['callId'].trim()
    )
      return null;
    const isActive =
      data['isHeadlessRecording'] === true && data['operation'] !== 'recording_ended';
    return {
      callId: data['callId'],
      durationMs:
        typeof data['durationMs'] === 'number' &&
        Number.isFinite(data['durationMs']) &&
        data['durationMs'] >= 0
          ? data['durationMs']
          : 0,
      title,
      isActive,
      ...(typeof data['createdBy'] === 'string' ? { createdBy: data['createdBy'] } : {}),
    };
  } catch {
    return null;
  }
}
