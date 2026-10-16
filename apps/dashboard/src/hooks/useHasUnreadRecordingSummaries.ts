import { useEffect, useMemo } from 'react';
import { mutators } from '../zero/mutators';
import { useUnreadActivities } from './useUnreadActivities';
import { useZero } from './useZero';
import { usePageCoverage, whenShown } from './usePageCoverage';

// actionSource is 'recording' for headless recordings (see recordSummaryReadyActivity).
const isUnreadRecordingSummary = (activity: {
  actorAction: string;
  actionSource: string;
}): boolean =>
  activity.actorAction === 'recording_summary_ready' && activity.actionSource === 'recording';

/** Drives the Recordings sidebar dot. */
export const useHasUnreadRecordingSummaries = (): boolean =>
  useUnreadActivities(isUnreadRecordingSummary).length > 0;

/** Call ids (recording `id`) whose summary is ready but not yet opened. */
export const useUnreadRecordingSummaryCallIds = (): Set<string> => {
  const unread = useUnreadActivities(isUnreadRecordingSummary);
  return useMemo(
    () => new Set(unread.flatMap(activity => (activity.callId ? [activity.callId] : []))),
    [unread],
  );
};

/** Mount on a recording's detail screen to mark its summary as seen. */
export const useMarkRecordingSummaryReadOnOpen = (callId: string | undefined): void => {
  const zero = useZero();
  const activityId = useUnreadActivities(isUnreadRecordingSummary).find(
    activity => !!callId && activity.callId === callId,
  )?.id;
  // Under full-page search the recording is off screen: a summary ready meanwhile stays unread
  // until it is back.
  const coverage = usePageCoverage();

  useEffect(() => {
    if (!activityId) return undefined;
    return whenShown(coverage, () => {
      void zero.mutate(mutators.activities.markAsRead({ activityId }));
    });
  }, [activityId, zero, coverage]);
};
