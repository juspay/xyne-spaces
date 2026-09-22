/**
 * Recording sessions as spans on the call timeline.
 *
 * A call records one session at a time — the backend holds a single-active lock —
 * so the spans it produces never overlap, whatever their type.
 */

import { RecordingStatus, RecordingType } from '@xyne/shared';
import type { CallRecordingSession } from '../../services/Recording/recordingService';

/**
 * What the band stands for. `AUDIO_SCREEN` and `AUDIO_VIDEO` both stitch to an MP4
 * with a picture, so the timeline treats them alike and only the shade differs.
 */
export type RecordedSpanKind = 'audio' | 'video';

const SPAN_KIND: Record<RecordingType, RecordedSpanKind> = {
  [RecordingType.AUDIO_ONLY]: 'audio',
  [RecordingType.AUDIO_SCREEN]: 'video',
  [RecordingType.AUDIO_VIDEO]: 'video',
};

export interface RecordedSpan {
  /** Which session this is, so its file can be fetched on demand. */
  recordingId: string;
  /** Offsets onto the timeline's axis, in seconds. */
  startSeconds: number;
  endSeconds: number;
  /** What the user called this session, for the band's tooltip. */
  name: string | null;
  /** Only `audio` plays through the bar today; video bands are drawn, not played. */
  kind: RecordedSpanKind;
}

/**
 * Sessions that produced a file, measured from `originMs`. A session that never
 * uploaded is left out — nothing was kept for that stretch, so nothing is claimed
 * for it.
 *
 * The right edge runs slightly long: `endedAt` is overwritten with the moment
 * stitching finished, not the moment recording stopped.
 */
export function buildRecordedSpans(
  sessions: readonly CallRecordingSession[],
  originMs: number,
): RecordedSpan[] {
  const spans: RecordedSpan[] = [];

  for (const session of sessions) {
    if (session.status !== RecordingStatus.RECORDING_UPLOADED) continue;
    if (!session.endedAt) continue;

    // A type this build doesn't know has no shade to be drawn in.
    const kind = SPAN_KIND[session.recordingType];
    if (!kind) continue;

    const startMs = new Date(session.startedAt).getTime();
    const endMs = new Date(session.endedAt).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;

    // Started before the call was marked started: pin to the start.
    const startSeconds = Math.max(0, (startMs - originMs) / 1000);
    const endSeconds = Math.max(0, (endMs - originMs) / 1000);
    if (endSeconds <= startSeconds) continue;

    spans.push({ recordingId: session.id, startSeconds, endSeconds, name: session.name, kind });
  }

  return spans.sort((left, right) => left.startSeconds - right.startSeconds);
}
