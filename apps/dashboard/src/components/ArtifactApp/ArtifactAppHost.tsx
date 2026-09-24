import { ReactElement, useCallback, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Globe, Lock } from 'lucide-react';
import { Button } from '../ui/Button/index';
import { ArtifactAppSettings, ReactArtifactView } from '../AIScreen/ReactArtifact';
import type { ReactArtifactRef } from '../AIScreen/ReactArtifact';
import { updateAppSnapshot } from '../../hooks/barItems';
import {
  getArtifactApp,
  publishArtifactApp,
  unpublishArtifactApp,
  updateArtifactAppIcon,
} from '../../services/claw/artifactAppsService';
import { clawErrorText } from '../../services/claw/clawRequest';
import type { XyneAppContext, XyneContextChannel } from '../AIScreen/ReactArtifact';

/**
 * Where this host is mounted, as the app will be told. The channel case carries
 * the channel so an app opened as a channel tab can scope itself to it; every
 * other surface has nothing to add.
 */
export type ArtifactAppPlacement =
  | { surface: 'toolbar' | 'inbox' | 'library' }
  | { surface: 'channel'; channel: XyneContextChannel };

/** A panel sits beside other chrome; the rail and the Agent Hub own the page. */
const LAYOUT_BY_SURFACE = {
  toolbar: 'fullscreen',
  library: 'fullscreen',
  inbox: 'panel',
  channel: 'panel',
} as const;

interface ArtifactAppHostProps {
  appId: string;
  /**
   * Passed through to the app as its context, so one build can lay itself out
   * differently in the rail, the Inbox, a channel tab and the Agent Hub.
   */
  placement: ArtifactAppPlacement;
  /**
   * Show the payload's own title inside the runner's header.
   *
   * Off in the bars: this component's header already names the app, so the
   * inner one repeats it. On in the Agent Hub, where the build's title is worth
   * seeing next to the version controls — it can legitimately differ from the
   * app's name once a later build renames itself.
   */
  showPayloadTitle?: boolean;
  /**
   * Renders a back arrow in the header. Only the Agent Hub's own app page has
   * somewhere to go back to; a bar-hosted app (rail, Inbox, channel tab) is
   * already where the user asked for it and gets no back control.
   */
  onBack?: () => void;
}

/**
 * A saved app, running. Owners get the publish control; everyone else simply
 * gets the pinned build, which the server enforces — this component never
 * decides which version a viewer is allowed to see.
 *
 * Fills whatever box it is given, so the same host serves the full-screen
 * route, the Inbox's `chat-main` panel and a channel tab.
 */
export const ArtifactAppHost = ({
  appId,
  onBack,
  placement,
  showPayloadTitle = false,
}: ArtifactAppHostProps): ReactElement => {
  const queryClient = useQueryClient();
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['artifact-app', appId],
    queryFn: () => getArtifactApp(appId),
    enabled: Boolean(appId),
  });

  const app = data?.app;
  const versions = useMemo(() => data?.versions ?? [], [data]);

  /**
   * The build this page is actually served, mirroring the payload route: an
   * owner gets HEAD, everyone else gets the pin, and both fall back to the
   * newest row for apps that predate those pointers.
   *
   * Not simply `versions[0]`. After a restore the newest version is no longer
   * head, so that took the *wrong* row: the page rendered head while its header
   * described a build nobody was looking at — and Publish would have pinned
   * that other build to the whole workspace.
   */
  const shown = useMemo(() => {
    const preferred = app?.isOwner
      ? (app.headVersionId ?? app.publishedVersionId)
      : app?.publishedVersionId;
    return versions.find(v => v.id === preferred) ?? versions[0];
  }, [app, versions]);

  const hostContext = useMemo(
    (): XyneAppContext => ({
      v: 1,
      appId,
      layout: LAYOUT_BY_SURFACE[placement.surface],
      ...(workspaceId ? { workspaceId } : {}),
      ...(placement.surface === 'channel'
        ? { surface: 'channel' as const, channel: placement.channel }
        : { surface: placement.surface }),
    }),
    [appId, workspaceId, placement],
  );

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

  // The bars draw apps from a localStorage snapshot rather than this query, so
  // a new mark has to be written there too or the rail keeps the old icon
  // until the next full load. Same pairing as the chat pane's own edit.
  const setIcon = useMutation({
    mutationFn: (icon: string | null) => updateArtifactAppIcon(app?.id ?? '', icon),
    onSuccess: (_result, icon) => {
      invalidate();
      updateAppSnapshot(appId, { icon });
    },
    onError: (e: unknown) => setError(clawErrorText(e, 'Could not change the icon.')),
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
        <Button
          variant='secondary'
          onClick={() => void refetch()}
          data-track-category='AskAI'
          data-track-name='ArtifactAppRetryLoad'
        >
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
        {onBack && (
          <button
            type='button'
            onClick={onBack}
            className='rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground'
            aria-label='Back to apps'
            data-track-category='AskAI'
            data-track-name='ArtifactAppBack'
          >
            <ArrowLeft className='h-4 w-4' />
          </button>
        )}
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
        <ReactArtifactView
          artifact={artifact}
          fill
          hostContext={hostContext}
          hideTitle={!showPayloadTitle}
          settingsSlot={
            <ArtifactAppSettings
              app={app}
              viewing={shown ?? null}
              versions={versions}
              {...(app.isOwner ? { onIconChange: setIcon.mutate } : {})}
            />
          }
        />
      </div>
    </div>
  );
};
