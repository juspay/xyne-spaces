import type { RecordingPreview } from '@/src/types/recordings';

/** Shared extraction of the recording metadata already used by the v2 chat pill. */
export function recordingPreviewFromMetadata(value: unknown, title = ''): RecordingPreview | null {
  try {
    const metadata = typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
    if (!metadata || typeof metadata !== 'object') return null;
    const data = metadata as Record<string, unknown>;
    if (
      (data['isRecordingMessage'] !== true &&
        data['isHeadlessRecording'] !== true &&
        data['callType'] !== 'HEADLESS') ||
      typeof data['callId'] !== 'string' ||
      !data['callId'].trim()
    )
      return null;
    const isHeadless = data['isHeadlessRecording'] === true || data['callType'] === 'HEADLESS';
    const operation = data['operation'];
    const isExplicitlyActive = operation === 'recording_active' || operation === 'call_active';
    const isEnded =
      operation === 'recording_ended' ||
      operation === 'call_ended' ||
      (!isExplicitlyActive && typeof data['durationMs'] === 'number');
    return {
      callId: data['callId'],
      durationMs:
        typeof data['durationMs'] === 'number' &&
        Number.isFinite(data['durationMs']) &&
        data['durationMs'] >= 0
          ? data['durationMs']
          : 0,
      title,
      isActive: isHeadless && !isEnded,
    };
  } catch {
    return null;
  }
}
