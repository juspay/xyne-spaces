import { CallType } from '@xyne/shared';

import type { ActivityWithRelated } from '@/src/types/activity';
import type { ActivityNavigationTarget } from '../presentation/activityRowAssembler';

/** Shared copy and destination for both mobile activity layouts. */
export function describeRecordingSummary(activity: ActivityWithRelated): {
  actorName: string;
  description: string;
  body: string;
  target: ActivityNavigationTarget;
} | null {
  const call = activity.call;
  if (!activity.callId || !call) return null;

  const isRecording = call.callType === CallType.HEADLESS;
  if (isRecording && !call.externalId) return null;

  return {
    actorName: isRecording ? 'Recording summary' : 'Call summary',
    description: `· "${call.title ?? 'Untitled'}"`,
    body: 'Summary is ready to view',
    target: isRecording
      ? { kind: 'recording', recordingId: call.externalId }
      : { kind: 'call-detail', callId: activity.callId },
  };
}
