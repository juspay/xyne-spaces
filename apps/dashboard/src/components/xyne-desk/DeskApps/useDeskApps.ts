import { useCallback, useMemo } from 'react';
import { useQueries, type UseQueryResult } from '@tanstack/react-query';
import { parseDeskAppIds } from '@xyne/shared';
import { getArtifactApp } from '../../../services/claw/artifactAppsService';

export interface DeskApp {
  id: string;
  title: string;
  /** Xyne icon id, or null for the fallback mark. */
  icon: string | null;
}

export interface DeskApps {
  /** Every id saved on the desk, in order — what a manager edits. */
  ids: string[];
  /** The apps this viewer can open, in the desk's order. */
  apps: DeskApp[];
  /** Saved ids this viewer can't open: unpublished by their owner, or deleted. */
  unavailableIds: string[];
  isLoading: boolean;
}

/**
 * The desk's apps, resolved for the current viewer.
 *
 * The desk stores ids only (EmailChannelPreference.deskAppIds); titles and icons
 * are read live, so a renamed app or a new icon shows up for everyone without
 * touching the desk. Each lookup shares ArtifactAppHost's query key, so opening
 * an app from the desk reuses the fetch the header already made.
 *
 * The claw-auth route decides who may see an app. An id it refuses for this
 * viewer is dropped from `apps` rather than shown as a dead entry.
 */
export function useDeskApps(rawDeskAppIds: string | null | undefined): DeskApps {
  const ids = useMemo(() => parseDeskAppIds(rawDeskAppIds), [rawDeskAppIds]);

  // `combine` is re-run only when a query's result changes (and when this
  // callback does, i.e. when the id list does), so the returned object keeps its
  // identity across unrelated renders.
  const combine = useCallback(
    (results: UseQueryResult<{ app: { title: string; icon: string | null } }>[]): DeskApps => {
      const apps: DeskApp[] = [];
      const unavailableIds: string[] = [];
      ids.forEach((id, index) => {
        const result = results[index];
        const app = result?.data?.app;
        if (app) apps.push({ id, title: app.title, icon: app.icon });
        else if (result?.isError) unavailableIds.push(id);
      });
      return { ids, apps, unavailableIds, isLoading: results.some(r => r.isLoading) };
    },
    [ids],
  );

  return useQueries({
    queries: ids.map(id => ({
      queryKey: ['artifact-app', id],
      queryFn: () => getArtifactApp(id),
      // A 403/404 is the answer, not a blip worth retrying three times.
      retry: false,
      staleTime: 5 * 60_000,
    })),
    combine,
  });
}
