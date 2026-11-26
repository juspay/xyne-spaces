import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getArtifactApp, type ArtifactAppDetail } from '../../services/claw/artifactAppsService';
import type { ReactArtifactRef } from '../AIScreen/ReactArtifact/ReactArtifact.types';

interface SurfaceApp {
  app: ArtifactAppDetail | undefined;
  /** What the view loads. Null until the app is known, or when it has no build. */
  artifact: ReactArtifactRef | null;
  isLoading: boolean;
  /** No access, archived, deleted, or the request failed. */
  isError: boolean;
}

/**
 * An app as an overlay or widget runs it. Same query key as ArtifactAppHost, so
 * an app that is also open as a page shares the cache, and the same build: the
 * owner's head, everyone else's published pin. The payload route enforces that
 * pin on its own; this only picks the manifest to describe it.
 */
export const useSurfaceApp = (appId: string): SurfaceApp => {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['artifact-app', appId],
    queryFn: () => getArtifactApp(appId),
    enabled: Boolean(appId),
    retry: 1,
  });

  const app = data?.app;
  const artifact = useMemo((): ReactArtifactRef | null => {
    if (!app || !data) return null;
    const preferred = app.isOwner
      ? (app.headVersionId ?? app.publishedVersionId)
      : app.publishedVersionId;
    const shown = data.versions.find(v => v.id === preferred) ?? data.versions[0];
    if (!shown) return null;
    return { attachmentId: '', manifest: shown.manifest, savedAppId: app.id };
  }, [app, data]);

  return { app, artifact, isLoading, isError: isError || (!!data && !artifact) };
};
