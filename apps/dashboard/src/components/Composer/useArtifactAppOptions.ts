import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listArtifactApps, type ArtifactAppSummary } from '../../services/claw/artifactAppsService';

export interface ArtifactAppOption {
  app: ArtifactAppSummary;
  /** "Yours · Private", "By Asha · Published" — who made it and who can see it. */
  subtitle: string;
}

/**
 * The artifact apps the "@" menu offers as context: the user's own plus
 * everything published to their workspace — the same set the agent can read
 * once one is attached. Apps live in claw-auth, not Vespa, so they are listed
 * from the gallery routes and filtered here rather than searched.
 */
export function useArtifactAppOptions(
  query: string,
  enabled: boolean,
): { options: ArtifactAppOption[]; isLoading: boolean; isError: boolean } {
  const mine = useQuery({
    queryKey: ['artifact-apps', 'mine'],
    queryFn: () => listArtifactApps('mine'),
    enabled,
  });
  const workspace = useQuery({
    queryKey: ['artifact-apps', 'workspace'],
    queryFn: () => listArtifactApps('workspace'),
    enabled,
  });

  const options = useMemo((): ArtifactAppOption[] => {
    const mineIds = new Set((mine.data?.apps ?? []).map(a => a.id));
    // "workspace" includes my own published apps; keep each app once.
    const byId = new Map<string, ArtifactAppSummary>();
    for (const app of [...(mine.data?.apps ?? []), ...(workspace.data?.apps ?? [])]) {
      if (!byId.has(app.id)) byId.set(app.id, app);
    }
    const q = query.trim().toLowerCase();
    return Array.from(byId.values())
      .filter(a => !q || `${a.title} ${a.ownerName ?? ''}`.toLowerCase().includes(q))
      .map(app => {
        const owner = mineIds.has(app.id) ? 'Yours' : `By ${app.ownerName ?? 'a teammate'}`;
        const visibility = app.visibility === 'WORKSPACE' ? 'Published' : 'Private';
        return { app, subtitle: `${owner} · ${visibility}` };
      });
  }, [mine.data, workspace.data, query]);

  return {
    options,
    isLoading: mine.isLoading || workspace.isLoading,
    isError: mine.isError && workspace.isError,
  };
}
