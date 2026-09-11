import { ReactElement, ReactNode, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { cn } from '@/utils/classNames';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { listArtifactApps, type ArtifactAppSummary } from '@/services/claw/artifactAppsService';
import { Pin } from 'lucide-react';
import { AppIcon } from '@/components/AppIcon/AppIcon';
import UserAvatar, { AvatarShape, AvatarSize } from '@/components/UserAvatar/UserAvatar';
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
    !q || `${a.title} ${a.description ?? ''} ${a.ownerName ?? ''}`.toLowerCase().includes(q);

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

  /**
   * The second line: who made it, with their avatar.
   *
   * This replaces the old file-count fallback, which only ever appeared because
   * generated apps rarely carry a description — "3 files" says nothing a viewer
   * scanning the library needs. Who built it does.
   *
   * The avatar resolves from `ownerUserId` through Zero's local user store, so
   * the picture needs no extra field on the API response; `ownerName` comes
   * from claw-auth and is null only when the row could not be resolved, in
   * which case the whole line is dropped rather than showing a bare avatar.
   */
  const creatorLine = (a: ArtifactAppSummary): ReactNode =>
    a.ownerName ? (
      <span className='flex min-w-0 items-center gap-1.5'>
        <UserAvatar
          userId={a.ownerUserId}
          size={AvatarSize.SM}
          shape={AvatarShape.CIRCULAR}
          showActiveStatus={false}
        />
        {/* Smaller and lighter than the title line. At `text-sm` this competed
            with the app's own name for the eye; attribution should be legible
            without being the second thing you read. */}
        <span className='truncate text-xs leading-5 text-foreground/55'>{a.ownerName}</span>
      </span>
    ) : undefined;

  /**
   * Publication state as a badge rather than muted text.
   *
   * Set as a plain string it sat immediately after the title in the same size
   * and colour as a subtitle, so "Skeuomorphic Tic Tac Toe Published" read as
   * one phrase. A state is not part of a name: the pill and its dot separate
   * them at a glance, and the dot alone carries the meaning once you know it.
   */
  const metaFor = (a: ArtifactAppSummary): ReactNode =>
    a.visibility === 'WORKSPACE' ? (
      <span className='flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-500/10 py-0.5 pl-1.5 pr-2 text-[11px] font-medium leading-4 text-emerald-700 dark:text-emerald-400'>
        <span className='h-1.5 w-1.5 rounded-full bg-emerald-500' aria-hidden='true' />
        Published
      </span>
    ) : undefined;

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
            <div key={app.id} className='group/card relative [&>a]:pr-11'>
              <LibraryCard
                to={prefixWs(`/ai/library/app/${app.id}`)}
                testId='artifact-app-card'
                icon={
                  <LibraryIconTile name={app.title}>
                    {app.icon ? (
                      <AppIcon name={app.icon} size={16} aria-hidden='true' />
                    ) : undefined}
                  </LibraryIconTile>
                }
                name={app.title}
                description={app.description ?? undefined}
                footer={creatorLine(app)}
                meta={metaFor(app)}
              />
              {/* Sits above the card's own <Link>, so the click must be stopped
                  from bubbling or pinning would also navigate away.

                  z-[1], NOT z-10: the tab's header (LibraryV2) is `sticky top-0
                  z-10`, and a pin at the same level paints over it on scroll —
                  the buttons slid across the "Agent Hub" title and the tab bar.
                  One is enough to clear the Link, which is unpositioned. */}
              <button
                type='button'
                onClick={e => {
                  e.preventDefault();
                  e.stopPropagation();
                  togglePin({ id: app.id, title: app.title, icon: app.icon });
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
                  'absolute right-2 top-2 z-[1] rounded-md p-1.5 transition-all',
                  'hover:bg-accent disabled:pointer-events-none disabled:opacity-40',
                  // An unpinned pin is an offer, not information: at full
                  // strength on every card it read as a state and made a grid
                  // look busy. Dimmed until pointed at — but never hidden, so
                  // it stays reachable on touch. A PINNED one is state, and
                  // state is always visible.
                  isPinned(app.id)
                    ? 'text-primary hover:text-primary'
                    : 'text-muted-foreground/40 hover:text-foreground focus-visible:text-foreground group-hover/card:text-muted-foreground',
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
