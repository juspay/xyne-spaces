import type { RecordingRepairOutage, RecordingRepairReason } from './recordingService';

interface RecordingRepairOutageState {
  outages: RecordingRepairOutage[];
  activeReasons: RecordingRepairReason[];
  activeOutageStartedAt: number | null;
}

function sameReasons(left: RecordingRepairReason[], right: RecordingRepairReason[]): boolean {
  return left.length === right.length && left.every((reason, index) => reason === right[index]);
}

export function transitionRecordingRepairReasons(
  capture: RecordingRepairOutageState,
  nextReasons: RecordingRepairReason[],
  now: number,
  paused: boolean,
): void {
  const normalized = [...new Set(nextReasons)].sort();
  if (sameReasons(capture.activeReasons, normalized)) return;
  if (capture.activeOutageStartedAt !== null && capture.activeReasons.length > 0) {
    capture.outages.push({
      startedAt: new Date(capture.activeOutageStartedAt).toISOString(),
      endedAt: new Date(now).toISOString(),
      reasons: capture.activeReasons,
    });
  }
  capture.activeReasons = normalized;
  capture.activeOutageStartedAt = !paused && normalized.length > 0 ? now : null;
}
