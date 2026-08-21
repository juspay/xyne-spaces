import { ReactElement, useCallback, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Globe, Lock } from 'lucide-react';
import { Button } from '@/components/ui/Button/index';
import { ReactArtifactView } from '@/components/AIScreen/ReactArtifact';
import type { ReactArtifactRef } from '@/components/AIScreen/ReactArtifact';
import {
  getArtifactApp,
  publishArtifactApp,
  unpublishArtifactApp,
} from '@/services/claw/artifactAppsService';
import { clawErrorText } from '@/services/claw/clawRequest';

/**
 * A saved app on its own page. Owners get the publish control; everyone else
 * simply gets the pinned build, which the server enforces — this screen never
 * decides which version a viewer is allowed to see.
 */
const ArtifactAppScreen = (): ReactElement => {
  const { workspaceId, appId } = useParams<{ workspaceId?: string; appId?: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['artifact-app', appId],
    queryFn: () => getArtifactApp(appId ?? ''),
    enabled: Boolean(appId),
  });

  const app = data?.app;
  const versions = useMemo(() => data?.versions ?? [], [data]);
  const shown = versions[0];

  // The viewer addresses the app by its own id; `attachmentId` is unused on this
  // path but keeps one ref shape across the chat and saved-app surfaces.
  const artifact: ReactArtifactRef | null = useMemo(
    () =>
      app && shown ? { attachmentId: '', manifest: shown.manifest, savedAppId: app.id } : null,
    [app, shown],
  );

  const invalidate = useCallback((): void => {
    void queryClient.invalidateQueries({ queryKey: ['artifact-app', appId] });
    void queryClient.invalidateQueries({ queryKey: ['artifact-apps'] });
  }, [queryClient, appId]);

  const publish = useMutation({
    mutationFn: () => publishArtifactApp(app?.id ?? '', shown?.id ?? ''),
    onSuccess: invalidate,
    onError: (e: unknown) => setError(clawErrorText(e, 'Could not publish this app.')),
  });
  const unpublish = useMutation({
    mutationFn: () => unpublishArtifactApp(app?.id ?? ''),
    onSuccess: invalidate,
    onError: (e: unknown) => setError(clawErrorText(e, 'Could not unpublish this app.')),
  });

  if (isLoading) {
    return (
      <div className='flex h-full items-center justify-center text-sm text-muted-foreground'>
        Loading app…
      </div>
    );
  }

  if (isError || !app || !artifact) {
    return (
      <div className='flex h-full flex-col items-center justify-center gap-2'>
        <p className='text-sm font-medium text-foreground'>Could not open this app</p>
        <Button variant='secondary' onClick={() => void refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  const isPublished = app.visibility === 'WORKSPACE';
  const busy = publish.isPending || unpublish.isPending;

  return (
    <div className='flex h-full flex-col'>
      <div className='flex items-center gap-3 border-b border-border px-4 py-2'>
        <button
          type='button'
          onClick={(): void => {
            // navigate() has separate overloads for a path and a history delta,
            // so a union argument matches neither.
            if (workspaceId) void navigate(`/${workspaceId}/ai/library?tab=apps`);
            else void navigate(-1);
          }}
          className='rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground'
          aria-label='Back to apps'
          data-track-category='AskAI'
          data-track-name='ArtifactAppBack'
        >
          <ArrowLeft className='h-4 w-4' />
        </button>
        <div className='min-w-0 flex-1'>
          <div className='truncate text-sm font-medium text-foreground'>{app.title}</div>
          {app.description && (
            <div className='truncate text-xs text-muted-foreground'>{app.description}</div>
          )}
        </div>

        <span className='flex shrink-0 items-center gap-1 text-xs text-muted-foreground'>
          {isPublished ? <Globe className='h-3.5 w-3.5' /> : <Lock className='h-3.5 w-3.5' />}
          {isPublished ? 'Workspace' : 'Private'}
        </span>

        {app.isOwner && (
          <Button
            variant={isPublished ? 'secondary' : 'default'}
            disabled={busy || !shown}
            onClick={() => {
              setError(null);
              if (isPublished) unpublish.mutate();
              else publish.mutate();
            }}
            data-track-category='AskAI'
            data-track-name={isPublished ? 'ArtifactAppUnpublish' : 'ArtifactAppPublish'}
          >
            {isPublished ? 'Unpublish' : 'Publish to workspace'}
          </Button>
        )}
      </div>

      {error && <p className='px-4 py-2 text-xs text-destructive'>{error}</p>}

      <div className='min-h-0 flex-1'>
        <ReactArtifactView artifact={artifact} fill />
      </div>
    </div>
  );
};

export default ArtifactAppScreen;
