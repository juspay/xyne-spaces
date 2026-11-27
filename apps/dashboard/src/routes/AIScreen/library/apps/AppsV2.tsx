import { ReactElement, ReactNode, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { cn } from '@/utils/classNames';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  archiveArtifactApp,
  listArtifactApps,
  unarchiveArtifactApp,
  type ArtifactAppSummary,
} from '@/services/claw/artifactAppsService';
import { Archive, ArchiveRestore, Pin, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { copyTextToClipboard } from '@/utils/clipboardUtils';
import { AppIcon } from '@/components/AppIcon/AppIcon';
import UserAvatar, { AvatarShape, AvatarSize } from '@/components/UserAvatar/UserAvatar';
import { LibraryCard, LibraryIconTile } from '../shared/components/LibraryCard';
import { LibraryFilterMenu } from '../shared/components/LibraryFilterMenu';
import { LibraryToolbarPortal } from '../shared/components/LibraryToolbarSlot';
import { useToolbarApps } from '@/hooks/useToolbarApps';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import {
  LibrarySections,
  LibraryTabShell,
  type LibraryEmptyState,
} from '../shared/components/LibraryTabShell';

/** The toolbar filter's "show archived" option; `null` (its "all") is the live list. */
const ARCHIVED_VIEW = 'archived';

/** Shared look for the small icon actions in a card's top-right corner. */
const cardActionClass = cn(
  'rounded-md p-1.5 transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-40',
  // Dimmed until the card is hovered, never hidden, so it stays reachable on touch.
  'text-muted-foreground/40 hover:text-foreground focus-visible:text-foreground group-hover/card:text-muted-foreground',
);

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
  const { isPinned, togglePin, pinApp, unpinApp, isFull } = useToolbarApps();
  const queryClient = useQueryClient();
  const { confirm, ConfirmDialog } = useConfirmDialog();
  // Every app with an archive or unarchive in flight. A mutation only remembers
  // its latest call, so archiving A then B would otherwise re-enable A's button.
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());
  const setPending = (appId: string, on: boolean): void =>
    setPendingIds(prev => {
      const next = new Set(prev);
      if (on) next.add(appId);
      else next.delete(appId);
      return next;
    });
  // null = the live list; ARCHIVED_VIEW = my archived apps, where they can be restored.
  const [view, setView] = useState<string | null>(null);
  const showArchived = view === ARCHIVED_VIEW;

  // The app's Agent Hub URL. Pasted into any chat it renders as an app chip
  // (InternalXyneLink); opening it is still checked by claw-auth, so a private
  // app only opens for its owner.
  const shareApp = (app: ArtifactAppSummary): void => {
    const url = `${window.location.origin}${prefixWs(`/ai/library/app/${app.id}`)}`;
    copyTextToClipboard(url)
      .then(() =>
        toast.success('App link copied', {
          description:
            app.visibility === 'WORKSPACE'
              ? 'Paste it in any chat — it shows as the app and opens it in Agent Hub.'
              : 'Only you can open this app until you publish it to the workspace.',
        }),
      )
      .catch(() => toast.error('Could not copy the link'));
  };

  const mine = useQuery({
    queryKey: ['artifact-apps', 'mine'],
    queryFn: () => listArtifactApps('mine'),
  });
  const workspace = useQuery({
    queryKey: ['artifact-apps', 'workspace'],
    queryFn: () => listArtifactApps('workspace'),
  });
  // Fetched only once someone opens the archived view: nothing else needs it.
  const archived = useQuery({
    queryKey: ['artifact-apps', 'archived'],
    queryFn: () => listArtifactApps('archived'),
    enabled: showArchived,
  });

  // Every listing changes when an app moves in or out of the archive, and so
  // does the app's own page (its header and versions live under 'artifact-app').
  // "mine" refetches first: the workspace list hides apps that are in "mine", so
  // if it landed first an unarchived app would flash under other people's apps.
  const refreshLists = async (appId: string): Promise<void> => {
    void queryClient.invalidateQueries({ queryKey: ['artifact-app', appId] });
    await queryClient.invalidateQueries({ queryKey: ['artifact-apps', 'mine'] });
    await queryClient.invalidateQueries({
      queryKey: ['artifact-apps'],
      predicate: q => q.queryKey[1] !== 'mine',
    });
  };

  const unarchive = useMutation({
    // `repin`: put it back on the sidebar, for an Undo of an archive that unpinned it.
    mutationFn: ({ app }: { app: ArtifactAppSummary; repin?: boolean }) =>
      unarchiveArtifactApp(app.id),
    onMutate: ({ app }) => setPending(app.id, true),
    onSettled: (_r, _e, { app }) => setPending(app.id, false),
    onSuccess: async ({ app: restored }, { app, repin }) => {
      if (repin) pinApp({ id: app.id, title: app.title, icon: app.icon });
      await refreshLists(app.id);
      toast.success(`Restored ${restored.title}`, {
        description:
          restored.visibility === 'WORKSPACE'
            ? 'It is published to your workspace again.'
            : 'It is back in your apps.',
      });
    },
    onError: (error: unknown) =>
      toast.error('Could not restore the app', {
        description: error instanceof Error ? error.message : undefined,
      }),
  });

  const archive = useMutation({
    mutationFn: (app: ArtifactAppSummary) => archiveArtifactApp(app.id),
    onMutate: app => setPending(app.id, true),
    onSettled: (_r, _e, app) => setPending(app.id, false),
    onSuccess: async (_result, app) => {
      // A pinned archived app would open to "not found", so take it off the bar,
      // and remember that, so Undo puts it back where it was.
      const wasPinned = isPinned(app.id);
      if (wasPinned) unpinApp(app.id);
      await refreshLists(app.id);
      toast.success(`Archived ${app.title}`, {
        description:
          app.visibility === 'WORKSPACE'
            ? 'Your workspace can no longer open it. Nothing was deleted.'
            : 'Nothing was deleted. Find it under Show → Archived.',
        action: { label: 'Undo', onClick: () => unarchive.mutate({ app, repin: wasPinned }) },
      });
    },
    onError: (error: unknown) =>
      toast.error('Could not archive the app', {
        description: error instanceof Error ? error.message : undefined,
      }),
  });

  /**
   * Archiving a published app takes it away from everyone in the workspace (their
   * pins and chat links go to "not found"), so that one asks first. A private app
   * only affects its owner and keeps the one-click archive with Undo.
   */
  const requestArchive = async (app: ArtifactAppSummary): Promise<void> => {
    if (app.visibility === 'WORKSPACE') {
      const ok = await confirm({
        title: `Archive ${app.title}?`,
        description:
          'It is published, so everyone in your workspace loses access, including their pins and links to it. Nothing is deleted, and you can unarchive it any time.',
        confirmLabel: 'Archive',
        variant: 'destructive',
      });
      if (!ok) return;
    }
    archive.mutate(app);
  };

  const isLoading = showArchived ? archived.isLoading : mine.isLoading || workspace.isLoading;
  const isError = showArchived ? archived.isError : mine.isError || workspace.isError;

  const q = query.trim().toLowerCase();
  const match = (a: ArtifactAppSummary): boolean =>
    !q || `${a.title} ${a.description ?? ''} ${a.ownerName ?? ''}`.toLowerCase().includes(q);

  const sections = useMemo(() => {
    if (showArchived) {
      return [
        { key: 'archived', label: 'Archived', apps: (archived.data?.apps ?? []).filter(match) },
      ].filter(s => s.apps.length > 0);
    }
    const mineApps = (mine.data?.apps ?? []).filter(match);
    // Anything of mine already appears above; this section is other people's work.
    const mineIds = new Set((mine.data?.apps ?? []).map(a => a.id));
    const others = (workspace.data?.apps ?? []).filter(match).filter(a => !mineIds.has(a.id));
    return [
      { key: 'mine', label: 'Created by me', apps: mineApps },
      { key: 'workspace', label: 'Published in this workspace', apps: others },
    ].filter(s => s.apps.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `match` closes over `q` only
  }, [showArchived, archived.data, mine.data, workspace.data, q]);

  const total = showArchived
    ? (archived.data?.apps.length ?? 0)
    : (mine.data?.apps.length ?? 0) + (workspace.data?.apps.length ?? 0);

  const emptyState: LibraryEmptyState | undefined =
    total === 0
      ? showArchived
        ? {
            icon: '🗄️',
            title: 'No archived apps',
            description: 'Apps you archive appear here, ready to restore exactly as they were.',
          }
        : {
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
    showArchived ? (
      <span className='shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium leading-4 text-muted-foreground'>
        {a.archivedAt ? `Archived ${new Date(a.archivedAt).toLocaleDateString()}` : 'Archived'}
      </span>
    ) : a.visibility === 'WORKSPACE' ? (
      <span className='flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-500/10 py-0.5 pl-1.5 pr-2 text-[11px] font-medium leading-4 text-emerald-700 dark:text-emerald-400'>
        <span className='h-1.5 w-1.5 rounded-full bg-emerald-500' aria-hidden='true' />
        Published
      </span>
    ) : undefined;

  return (
    <LibraryTabShell
      toolbar={
        <LibraryToolbarPortal>
          <LibraryFilterMenu
            title='Show'
            options={[
              { id: 'all', label: 'Active apps' },
              { id: ARCHIVED_VIEW, label: 'Archived' },
            ]}
            activeId={view}
            onSelect={setView}
            trackName='Filter apps by archived'
          />
        </LibraryToolbarPortal>
      }
      isLoading={isLoading}
      error={
        isError
          ? {
              message: "Couldn't load apps.",
              onRetry: (): void => {
                if (showArchived) {
                  void archived.refetch();
                  return;
                }
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
          items: section.apps.map(app =>
            section.key === 'archived' ? (
              // An archived app's page answers "not found", so the card goes
              // nowhere: restoring it is the one thing to do from here.
              <div key={app.id} className='group/card relative *:first:pr-12'>
                <LibraryCard
                  testId='artifact-app-card-archived'
                  dimmed
                  icon={
                    <LibraryIconTile name={app.title}>
                      {app.icon ? (
                        <AppIcon name={app.icon} size={16} aria-hidden='true' />
                      ) : undefined}
                    </LibraryIconTile>
                  }
                  name={app.title}
                  description={app.description ?? undefined}
                  meta={metaFor(app)}
                />
                <div className='absolute right-2 top-2 z-1 flex items-center'>
                  <button
                    type='button'
                    onClick={() => unarchive.mutate({ app })}
                    disabled={pendingIds.has(app.id)}
                    aria-label={`Unarchive ${app.title}`}
                    title='Unarchive: restore this app exactly as it was'
                    className={cardActionClass}
                    data-track-category='AskAI'
                    data-track-name='ArtifactAppUnarchive'
                  >
                    <ArchiveRestore className='h-3.5 w-3.5' aria-hidden='true' />
                  </button>
                </div>
              </div>
            ) : (
              <div
                key={app.id}
                className={cn(
                  'group/card relative',
                  // Room for the corner actions: three on my own apps, two otherwise.
                  section.key === 'mine' ? '[&>a]:pr-28' : '[&>a]:pr-20',
                )}
              >
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
                <div className='absolute right-2 top-2 z-1 flex items-center gap-0.5'>
                  {/* Only the owner can archive, and "Created by me" is exactly
                    the owner's apps. */}
                  {section.key === 'mine' && (
                    <button
                      type='button'
                      onClick={e => {
                        e.preventDefault();
                        e.stopPropagation();
                        void requestArchive(app);
                      }}
                      disabled={pendingIds.has(app.id)}
                      aria-label={`Archive ${app.title}`}
                      title='Archive: hide this app everywhere, without deleting it'
                      className={cardActionClass}
                      data-track-category='AskAI'
                      data-track-name='ArtifactAppArchive'
                      data-track-metadata={JSON.stringify({ visibility: app.visibility })}
                    >
                      <Archive className='h-3.5 w-3.5' aria-hidden='true' />
                    </button>
                  )}
                  <button
                    type='button'
                    onClick={e => {
                      e.preventDefault();
                      e.stopPropagation();
                      shareApp(app);
                    }}
                    aria-label={`Share ${app.title}`}
                    title='Copy a link to share this app'
                    className={cn(
                      'rounded-md p-1.5 transition-all hover:bg-accent',
                      // Same dimmed-until-hovered treatment as an unpinned pin.
                      'text-muted-foreground/40 hover:text-foreground focus-visible:text-foreground group-hover/card:text-muted-foreground',
                    )}
                    data-track-category='AskAI'
                    data-track-name='ArtifactAppShare'
                    data-track-metadata={JSON.stringify({ visibility: app.visibility })}
                  >
                    <Share2 className='h-3.5 w-3.5' aria-hidden='true' />
                  </button>
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
                      'rounded-md p-1.5 transition-all',
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
              </div>
            ),
          ),
        }))}
      />
      <ConfirmDialog />
    </LibraryTabShell>
  );
};

export default AppsV2;
