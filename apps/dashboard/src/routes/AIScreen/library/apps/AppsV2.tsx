import { ReactElement, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { cn } from '@/utils/classNames';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { listArtifactApps, type ArtifactAppSummary } from '@/services/claw/artifactAppsService';
import { Pin } from 'lucide-react';
import { LibraryCard, LibraryIconTile } from '../shared/components/LibraryCard';
import { usePinnedArtifactApps } from '@/hooks/usePinnedArtifactApps';
import {
  LibrarySections,
  LibraryTabShell,
  type LibraryEmptyState,
} from '../shared/components/LibraryTabShell';

/**
 * Generated apps a user saved out of the AI chat, plus everything published to
 * the workspace. Two independent fetches rather than one: "mine" returns each
 * app's latest build, while "workspace" returns the *pinned* build, and the
 * server draws that distinction — a published card must not preview the
 * author's unpublished draft.
 */
const AppsV2 = ({ query }: { query: string }): ReactElement => {
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const prefixWs = (path: string): string => (workspaceId ? `/${workspaceId}${path}` : path);
  const { user } = useAuth();
  const { isPinned, togglePin, isFull } = usePinnedArtifactApps();

  const mine = useQuery({
    queryKey: ['artifact-apps', 'mine'],
    queryFn: () => listArtifactApps('mine'),
  });
  const workspace = useQuery({
    queryKey: ['artifact-apps', 'workspace'],
    queryFn: () => listArtifactApps('workspace'),
  });

  const isLoading = mine.isLoading || workspace.isLoading;
  const isError = mine.isError || workspace.isError;

  const q = query.trim().toLowerCase();
  const match = (a: ArtifactAppSummary): boolean =>
    !q || `${a.title} ${a.description ?? ''}`.toLowerCase().includes(q);

  const sections = useMemo(() => {
    const mineApps = (mine.data?.apps ?? []).filter(match);
    // Anything of mine already appears above; this section is other people's work.
    const others = (workspace.data?.apps ?? [])
      .filter(match)
      .filter(a => a.ownerUserId !== user?.id);
    return [
      { key: 'mine', label: 'Created by me', apps: mineApps },
      { key: 'workspace', label: 'Published in this workspace', apps: others },
    ].filter(s => s.apps.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `match` closes over `q` only
  }, [mine.data, workspace.data, q, user?.id]);

  const total = (mine.data?.apps.length ?? 0) + (workspace.data?.apps.length ?? 0);

  const emptyState: LibraryEmptyState | undefined =
    total === 0
      ? {
          icon: '🧩',
          title: 'No apps yet',
          description:
            'Ask an agent to build something in chat, then save it here to keep and share it.',
        }
      : sections.length === 0
        ? { icon: '🔍', title: 'No matching apps', description: 'Try a different search.' }
        : undefined;

  const describe = (a: ArtifactAppSummary): string | undefined => {
    if (a.description) return a.description;
    const count = a.manifest?.fileCount;
    return count ? `${count} ${count === 1 ? 'file' : 'files'}` : undefined;
  };

  return (
    <LibraryTabShell
      // No category filter on this tab yet — the shell still requires the slot.
      toolbar={null}
      isLoading={isLoading}
      error={
        isError
          ? {
              message: "Couldn't load apps.",
              onRetry: (): void => {
                void mine.refetch();
                void workspace.refetch();
              },
            }
          : undefined
      }
      emptyState={emptyState}
    >
      <LibrarySections
        sections={sections.map(section => ({
          key: section.key,
          label: section.label,
          items: section.apps.map(app => (
            <div key={app.id} className='relative [&>a]:pr-11'>
              <LibraryCard
                to={prefixWs(`/ai/library/app/${app.id}`)}
                testId='artifact-app-card'
                icon={<LibraryIconTile name={app.title} color='#6366f1' />}
                name={app.title}
                description={describe(app)}
                meta={app.visibility === 'WORKSPACE' ? 'Published' : undefined}
              />
              {/* Sits above the card's own <Link>, so the click must be stopped
                  from bubbling or pinning would also navigate away. */}
              <button
                type='button'
                onClick={e => {
                  e.preventDefault();
                  e.stopPropagation();
                  togglePin({ id: app.id, title: app.title });
                }}
                disabled={!isPinned(app.id) && isFull}
                aria-label={isPinned(app.id) ? `Unpin ${app.title}` : `Pin ${app.title}`}
                title={
                  isPinned(app.id)
                    ? 'Unpin from sidebar'
                    : isFull
                      ? 'Sidebar is full — unpin something first'
                      : 'Pin to sidebar'
                }
                className={cn(
                  'absolute right-2 top-2 z-10 rounded-md p-1.5 transition-colors',
                  'hover:bg-accent disabled:pointer-events-none disabled:opacity-40',
                  isPinned(app.id)
                    ? 'text-primary hover:text-primary'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                data-track-category='AskAI'
                data-track-name='ArtifactAppPin'
                data-track-metadata={JSON.stringify({ pinned: !isPinned(app.id) })}
              >
                <Pin
                  className={cn('h-3.5 w-3.5', isPinned(app.id) && 'fill-current')}
                  aria-hidden='true'
                />
              </button>
            </div>
          )),
        }))}
      />
    </LibraryTabShell>
  );
};

export default AppsV2;
