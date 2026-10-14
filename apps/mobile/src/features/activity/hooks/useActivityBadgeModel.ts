import { useEffect, useMemo, useRef, useState } from 'react';

import { useCachedQuery } from '@/src/hooks/useCachedQuery';
import { useDeferredLiveData } from '@/src/hooks/useDeferredLiveData';
import { useAuth } from '@/src/contexts/AuthContext';
import { useZero } from '@/src/hooks/useZero';
import { getString } from '@/src/services/localStorage';
import { queries } from '@/src/zero/queries';
import {
  getUnreadActivitySignature,
  selectActivitiesForWorkspace,
  selectActivityBadgeCount,
} from '@/src/features/activity/domain/activitySelectors';
import type { ActivityLike } from '@/src/features/activity/domain/activityTypes';
import { reconcileUnreadActivities } from '@/src/features/activity/sync/activitySyncReconciler';
import { useActivitySyncState } from '@/src/features/activity/sync/useActivitySyncState';

const LOTUS_USER_ID_STORAGE_KEY = '@lotus_user_id';

type ReconciledUnreadActivities = {
  activities: readonly ActivityLike[];
  liveSignatureAtStart: string;
};

export type ActivityBadgeModel = {
  count: number;
  hasLiveSource: boolean;
  unreadActivities: readonly ActivityLike[] | undefined;
};

export const useActivityBadgeModel = (): ActivityBadgeModel => {
  const { user } = useAuth();
  const zero = useZero();
  const syncState = useActivitySyncState();
  const [cachedUserId] = useState(() => getString(LOTUS_USER_ID_STORAGE_KEY) ?? '');
  const userId = user?.user_id ?? cachedUserId;
  const workspaceId = user?.workspaceId ?? zero.context.workspaceId ?? '';
  const liveDataEnabled = useDeferredLiveData({
    name: 'activity_badge',
    screen: 'activity_badge',
    hasInitialData: true,
    delayMs: 2_500,
    timeoutMs: 5_000,
    enabled: Boolean(userId && workspaceId),
  });

  const [rawUnreadActivities, unreadActivitiesDetails] = useCachedQuery(
    queries.userUnreadActivities(),
    {
      // Cache hydration remains available immediately. The live query is
      // delayed because its related channel materialization can be expensive
      // enough to compete with the first tab/list interaction.
      enabled: liveDataEnabled,
      ttl: '10m',
    },
  );
  const [reconciledUnreadActivities, setReconciledUnreadActivities] =
    useState<ReconciledUnreadActivities | null>(null);

  const hasLiveSource = unreadActivitiesDetails.type === 'complete';
  const liveUnreadActivities = useMemo(
    () => selectActivitiesForWorkspace(rawUnreadActivities, workspaceId),
    [rawUnreadActivities, workspaceId],
  );
  const liveSignature = useMemo(
    () => getUnreadActivitySignature(liveUnreadActivities),
    [liveUnreadActivities],
  );
  const liveSignatureRef = useRef(liveSignature);
  liveSignatureRef.current = liveSignature;
  const zeroRef = useRef(zero);
  zeroRef.current = zero;
  const unreadActivities = reconciledUnreadActivities?.activities ?? liveUnreadActivities;
  const count = useMemo(
    () =>
      hasLiveSource || reconciledUnreadActivities ? selectActivityBadgeCount(unreadActivities) : 0,
    [hasLiveSource, reconciledUnreadActivities, unreadActivities],
  );

  useEffect(() => {
    if (
      !liveDataEnabled ||
      !userId ||
      !workspaceId ||
      syncState.refreshNonce === 0 ||
      (syncState.urgency !== 'immediate' && syncState.urgency !== 'deferred')
    ) {
      return;
    }

    let cancelled = false;
    const liveSignatureAtStart = liveSignatureRef.current;
    void reconcileUnreadActivities({
      zero: zeroRef.current,
      currentUserId: userId,
      workspaceId,
      refreshNonce: syncState.refreshNonce,
    })
      .then(result => {
        if (cancelled) {
          return;
        }

        setReconciledUnreadActivities({
          activities: result,
          liveSignatureAtStart,
        });
      })
      .catch(() => {
        if (!cancelled) {
          setReconciledUnreadActivities(null);
        }
      });

    return (): void => {
      cancelled = true;
    };
  }, [liveDataEnabled, syncState.refreshNonce, syncState.urgency, userId, workspaceId]);

  useEffect(() => {
    if (reconciledUnreadActivities === null || !hasLiveSource) {
      return;
    }

    const reconciledSignature = getUnreadActivitySignature(reconciledUnreadActivities.activities);
    if (
      liveSignature === reconciledSignature ||
      liveSignature !== reconciledUnreadActivities.liveSignatureAtStart
    ) {
      setReconciledUnreadActivities(null);
    }
  }, [hasLiveSource, liveSignature, reconciledUnreadActivities]);

  return {
    count,
    hasLiveSource,
    unreadActivities,
  };
};
