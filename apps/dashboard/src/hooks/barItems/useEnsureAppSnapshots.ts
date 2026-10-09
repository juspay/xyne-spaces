import { useCallback, useEffect, useMemo } from 'react';
import { useQueries, type UseQueryResult } from '@tanstack/react-query';
import { getArtifactApp } from '../../services/claw/artifactAppsService';
import { setAppSnapshot, useAppSnapshots } from './appSnapshotsStore';

type AppLookup = Awaited<ReturnType<typeof getArtifactApp>>;
type Resolved = { id: string; title: string; icon: string | null };

/**
 * Bars draw apps from this device's snapshot cache, which is written when the
 * user adds an app. An app a channel admin published was never added on this
 * device, so it has no snapshot and the bar would skip it. This fetches those
 * apps once and writes their snapshots; the bars then draw them like any other.
 *
 * An app this viewer can't open (unpublished, deleted, no access) fails the
 * lookup, gets no snapshot, and so simply never appears — the same as today.
 * Shares ArtifactAppHost's query key, so opening the app reuses the fetch.
 */
export const useEnsureAppSnapshots = (appIds: readonly string[]): void => {
  const snapshots = useAppSnapshots();
  const missing = useMemo(() => appIds.filter(id => !snapshots.has(id)), [appIds, snapshots]);

  // `combine` keeps the result referentially stable until a lookup resolves,
  // so the effect below runs per resolution rather than per render.
  const combine = useCallback(
    (results: UseQueryResult<AppLookup>[]): Resolved[] =>
      results.flatMap((result, index) => {
        const app = result.data?.app;
        const id = missing[index];
        return app && id ? [{ id, title: app.title, icon: app.icon }] : [];
      }),
    [missing],
  );

  const resolved = useQueries({
    queries: missing.map(id => ({
      queryKey: ['artifact-app', id],
      queryFn: () => getArtifactApp(id),
      // A 403/404 is the answer, not a blip worth retrying.
      retry: false,
      staleTime: 5 * 60_000,
    })),
    combine,
  });

  useEffect(() => {
    for (const app of resolved) setAppSnapshot(app.id, { title: app.title, icon: app.icon });
  }, [resolved]);
};
