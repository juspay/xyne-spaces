import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown, GitBranch, Package, Rocket, Settings } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { Popover } from '../../../components/ui/Popover';
import { Tooltip } from '../../../components/ui/Tooltip';
import Avatar from '../../../components/ui/Avatar/Avatar';
import { CreateTicketModal } from '../../../components/Tickets/CreateTicketModal/CreateTicketModal';
import { useCanManageRelease } from '../../../hooks/usePermissions';
import { useScrollFade } from '../../../hooks/useScrollFade';
import { useShortcut } from '../../../shortcuts';
import { cn } from '../../../utils/classNames';
import type { SdlcReleaseCardData, SdlcReleaseRepo, SdlcReleasesProps } from './SdlcReleases.types';
import { TRACK_CATEGORY } from './SdlcReleases.utils';
import { useSdlcReleaseRepos, useSdlcReleases } from './useSdlcReleases';
import { SdlcReleaseConfigDialog } from './SdlcReleaseConfigDialog';
import { SdlcReleaseDetail } from './SdlcReleaseDetail';
import { EllipsisText, MenuItem, RepoPill, SearchInput, StagePill } from './SdlcReleasePrimitives';

const ALL_REPOS = 'all';

const CARD_ESTIMATE = 86;
const CARD_GAP = 11;
const LIST_FADE_PX = 48;
const LOAD_MORE_THRESHOLD = 3;

// The registry already skips editable targets; these guards cover the rest.
// j/k must not fight an open overlay; Enter must never double-fire on a
// focused control (the control's own activation wins).
const isInsideOverlay = (): boolean => {
  const el = document.activeElement;
  return (
    el instanceof HTMLElement &&
    !!el.closest(
      '[role="dialog"],[role="menu"],[role="listbox"],[data-radix-popper-content-wrapper]',
    )
  );
};
const isActivatableFocused = (): boolean => {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement) || el === document.body) return false;
  const tag = el.tagName;
  return tag === 'BUTTON' || tag === 'A' || el.getAttribute('role') === 'button';
};

export function SdlcReleases({
  projectId,
  repositories,
  openReleaseId,
  onOpenRelease,
  onOpenTicket,
  onOpenCanvas,
  onConnectRepository,
}: SdlcReleasesProps): ReactElement {
  const [configOpen, setConfigOpen] = useState(false);
  const { repos, loading } = useSdlcReleaseRepos(repositories, projectId);
  const configuredRepos = useMemo(() => repos.filter(repo => repo.config), [repos]);

  const renderContent = (): ReactElement | null => {
    if (repositories.length === 0) {
      return (
        <EmptyState
          icon={<GitBranch size={20} />}
          title='No repositories connected'
          description='Connect a repository to this hub to start tracking releases.'
          action={
            <Button
              onClick={onConnectRepository}
              data-track-category={TRACK_CATEGORY}
              data-track-name='ConnectRepositoryFromReleases'
            >
              Connect repository
            </Button>
          }
        />
      );
    }
    if (loading) return null;
    if (configuredRepos.length === 0) {
      return (
        <EmptyState
          icon={<Rocket size={20} />}
          title="Release manager isn't configured"
          description='Configure a repository and release channel to start tracking releases.'
          action={
            <Button
              onClick={() => setConfigOpen(true)}
              data-track-category={TRACK_CATEGORY}
              data-track-name='ConfigureReleaseManager'
            >
              Configure
            </Button>
          }
        />
      );
    }
    if (openReleaseId) {
      return (
        <SdlcReleaseDetail
          key={openReleaseId}
          releaseId={openReleaseId}
          repos={configuredRepos}
          onOpenTicket={onOpenTicket}
          onOpenCanvas={onOpenCanvas}
        />
      );
    }
    return (
      <ReleaseList
        configuredRepos={configuredRepos}
        onConfigure={() => setConfigOpen(true)}
        onOpenRelease={onOpenRelease}
      />
    );
  };

  return (
    <div className='flex min-h-0 flex-1 flex-col overflow-hidden bg-background leading-tight'>
      {renderContent()}
      <SdlcReleaseConfigDialog
        open={configOpen}
        repos={repos}
        onClose={() => setConfigOpen(false)}
        onConnectRepository={() => {
          setConfigOpen(false);
          onConnectRepository();
        }}
      />
    </div>
  );
}

function ReleaseList({
  configuredRepos,
  onConfigure,
  onOpenRelease,
}: {
  configuredRepos: SdlcReleaseRepo[];
  onConfigure: () => void;
  onOpenRelease: (releaseId: string) => void;
}): ReactElement {
  const [repoFilter, setRepoFilter] = useState(ALL_REPOS);
  const [creatingRelease, setCreatingRelease] = useState(false);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const fade = useScrollFade<HTMLDivElement>('y', LIST_FADE_PX);
  const fadeRef = fade.ref;
  const scrollerRef = useCallback(
    (element: HTMLDivElement | null): void => {
      setScroller(element);
      fadeRef(element);
    },
    [fadeRef],
  );
  const filteredRepo = configuredRepos.find(repo => repo.id === repoFilter);
  const scopedRepos = useMemo(
    () => (filteredRepo ? [filteredRepo] : configuredRepos),
    [filteredRepo, configuredRepos],
  );
  const { releases, loading, loadingMore, hasMore, loadMore } = useSdlcReleases(scopedRepos);
  const canCreateRelease = useCanManageRelease();
  const virtualizer = useVirtualizer({
    count: releases.length + (hasMore || loadingMore ? 1 : 0),
    getScrollElement: () => scroller,
    estimateSize: () => CARD_ESTIMATE,
    // Cache measured heights per release, not per position — releases shift as new ones land.
    getItemKey: useCallback((index: number) => releases[index]?.id ?? 'loading', [releases]),
    gap: CARD_GAP,
    overscan: 6,
  });
  const lastVisibleIndex = virtualizer.range?.endIndex ?? -1;
  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null);
  const releaseCount = releases.length;
  const activeIndex =
    highlightedIndex !== null && highlightedIndex < releaseCount ? highlightedIndex : null;

  const moveBy = useCallback(
    (delta: number) => {
      setHighlightedIndex(prev => {
        const current = prev !== null && prev < releaseCount ? prev : null;
        const next =
          current === null
            ? delta > 0
              ? 0
              : releaseCount - 1
            : Math.max(0, Math.min(releaseCount - 1, current + delta));
        virtualizer.scrollToIndex(next, { align: 'auto' });
        return next;
      });
    },
    [releaseCount, virtualizer],
  );

  useShortcut('j', () => moveBy(1), {
    scope: 'global',
    description: 'Next release in list',
    category: 'Releases',
    enabled: releaseCount > 0,
    when: () => !isInsideOverlay(),
  });
  useShortcut('k', () => moveBy(-1), {
    scope: 'global',
    description: 'Previous release in list',
    category: 'Releases',
    enabled: releaseCount > 0,
    when: () => !isInsideOverlay(),
  });
  useShortcut(
    'enter',
    () => {
      const release = activeIndex === null ? undefined : releases[activeIndex];
      if (release) onOpenRelease(release.id);
    },
    {
      scope: 'global',
      description: 'Open selected release',
      category: 'Releases',
      enabled: activeIndex !== null,
      when: () => !isInsideOverlay() && !isActivatableFocused(),
    },
  );
  useShortcut('escape', () => setHighlightedIndex(null), {
    scope: 'global',
    description: 'Clear release selection',
    category: 'Releases',
    enabled: activeIndex !== null,
    when: () => !isInsideOverlay(),
  });

  useEffect(() => {
    if (releases.length > 0 && lastVisibleIndex >= releases.length - LOAD_MORE_THRESHOLD) {
      loadMore();
    }
  }, [lastVisibleIndex, releases.length, loadMore]);

  const projectId = configuredRepos[0]?.projectId ?? null;
  const releaseChannelIds = [
    ...new Set(
      configuredRepos.flatMap(repo => (repo.config?.channelId ? [repo.config.channelId] : [])),
    ),
  ];
  const releaseChannelId = releaseChannelIds[0] ?? null;
  const newReleaseButton = (
    <Button
      onClick={() => setCreatingRelease(true)}
      disabled={!canCreateRelease || !releaseChannelId || !projectId}
      data-track-category={TRACK_CATEGORY}
      data-track-name='NewReleaseOpened'
    >
      + New release
    </Button>
  );

  return (
    <div className='flex min-h-0 flex-1 flex-col overflow-hidden px-8 pt-7'>
      <div className='mx-auto flex min-h-0 w-full max-w-[1074px] flex-1 flex-col gap-5'>
        <div className='flex flex-col gap-1'>
          <h1 className='text-2xl font-bold tracking-[-0.02em] text-foreground'>Releases</h1>
          <p className='text-sm text-muted-foreground'>
            What shipped, what was decided, and what it cost afterwards.
          </p>
        </div>
        <div className='flex flex-wrap items-center gap-2'>
          <RepoFilter
            repos={configuredRepos}
            value={filteredRepo?.id ?? ALL_REPOS}
            onChange={value => {
              setRepoFilter(value);
              setHighlightedIndex(null);
            }}
            onConfigure={onConfigure}
          />
          <span className='flex-1' />
          {canCreateRelease ? (
            newReleaseButton
          ) : (
            <Tooltip content='Only release managers can create releases'>
              <span className='inline-flex'>{newReleaseButton}</span>
            </Tooltip>
          )}
          <Tooltip content='Release configuration'>
            <Button
              variant='outline'
              size='icon'
              aria-label='Release configuration'
              onClick={onConfigure}
              data-track-category={TRACK_CATEGORY}
              data-track-name='ReleaseConfigurationOpened'
            >
              <Settings />
            </Button>
          </Tooltip>
        </div>
        {!loading && releases.length === 0 ? (
          <EmptyState
            icon={<Package size={20} />}
            title={filteredRepo ? `No releases in ${filteredRepo.name} yet` : 'No releases yet'}
            description='Use New release to cut one and see what ships in it — tickets, env changes and migrations.'
          >
            <div className='flex flex-wrap items-center justify-center gap-1.5'>
              <span className='text-xs text-muted-foreground'>Tracking</span>
              {scopedRepos.map(repo => (
                <span
                  key={repo.id}
                  className='flex h-6 items-center gap-1.5 rounded-full border border-border px-2.5 text-xs text-foreground/80'
                >
                  <span className='size-1.5 rounded-full bg-status-success' />
                  {repo.name}
                </span>
              ))}
            </div>
          </EmptyState>
        ) : (
          <div
            ref={scrollerRef}
            onScroll={fade.onScroll}
            style={fade.style}
            className='no-scrollbar -mx-0.5 min-h-0 flex-1 overflow-y-auto px-0.5 pb-8 pt-0.5'
          >
            <div className='relative w-full' style={{ height: virtualizer.getTotalSize() }}>
              {virtualizer.getVirtualItems().map(item => {
                const release = releases[item.index];
                return (
                  <div
                    key={release?.id ?? 'loading'}
                    data-index={item.index}
                    ref={virtualizer.measureElement}
                    className='absolute left-0 top-0 w-full'
                    style={{ transform: `translateY(${item.start}px)` }}
                  >
                    {release ? (
                      <ReleaseCard
                        release={release}
                        showRepo={!filteredRepo}
                        highlighted={activeIndex === item.index}
                        onOpen={() => onOpenRelease(release.id)}
                      />
                    ) : (
                      <div className='flex h-10 items-center justify-center text-xs text-muted-foreground'>
                        Loading more releases…
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
      {creatingRelease && releaseChannelId && projectId && (
        <CreateTicketModal
          isOpen
          channelId={releaseChannelId}
          projectId={projectId}
          initialTicketKind='release'
          releaseOnly
          releaseChannelIds={releaseChannelIds}
          useLocalAttachments
          trackSource='sdlc_releases'
          onClose={() => setCreatingRelease(false)}
          onTicketCreated={() => setCreatingRelease(false)}
        />
      )}
    </div>
  );
}

function ReleaseCard({
  release,
  showRepo,
  highlighted,
  onOpen,
}: {
  release: SdlcReleaseCardData;
  showRepo: boolean;
  highlighted: boolean;
  onOpen: () => void;
}): ReactElement {
  return (
    <button
      type='button'
      onClick={onOpen}
      className={cn(
        'flex w-full gap-4 rounded-[10px] border border-border bg-background px-4 py-3.5 text-left transition-[border-color,box-shadow] hover:border-foreground/20 hover:shadow-sm',
        highlighted && 'border-primary bg-primary/5 shadow-sm hover:border-primary',
      )}
      data-track-category={TRACK_CATEGORY}
      data-track-name='ReleaseOpened'
    >
      <span className='flex min-w-0 flex-1 flex-col gap-3'>
        <span className='flex min-w-0 items-center gap-2.5'>
          <EllipsisText
            text={release.title}
            className='min-w-0 text-base font-bold tracking-[-0.01em] text-foreground'
          />
          <StagePill name={release.stage.name} status={release.stage.status} />
          {showRepo && <RepoPill name={release.repoName} />}
        </span>
        {release.summary && (
          <EllipsisText
            text={release.summary}
            className='text-sm leading-snug text-foreground/85'
          />
        )}
      </span>
      <span className='flex shrink-0 flex-col items-end justify-between gap-3'>
        <span className='flex h-6 items-center text-[13px] text-muted-foreground'>
          {release.date}
        </span>
        <span className='flex items-center gap-2 text-[13px] text-muted-foreground'>
          <Avatar userId={release.ownerId} size='sm' />
          {release.ownerName}
        </span>
      </span>
    </button>
  );
}

function RepoFilter({
  repos,
  value,
  onChange,
  onConfigure,
}: {
  repos: SdlcReleaseRepo[];
  value: string;
  onChange: (repoId: string) => void;
  onConfigure: () => void;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const options = [
    { id: ALL_REPOS, name: 'All repositories' },
    ...repos.filter(repo => repo.name.toLowerCase().includes(needle)),
  ];
  const selected = repos.find(repo => repo.id === value);

  const pick = (repoId: string): void => {
    onChange(repoId);
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={next => {
        setOpen(next);
        if (next) setQuery('');
      }}
      align='start'
      sideOffset={4}
      className='w-[260px] p-1'
      trigger={
        <Button
          variant='outline'
          size='sm'
          data-track-category={TRACK_CATEGORY}
          data-track-name='RepoFilterOpened'
        >
          <GitBranch className='text-muted-foreground' />
          {selected?.name ?? 'All repositories'}
          <ChevronDown className='size-3 text-muted-foreground' />
        </Button>
      }
    >
      <SearchInput
        value={query}
        onChange={setQuery}
        placeholder='Find repository'
        trackName='RepoFilterSearched'
        className='m-1'
      />
      <div className='flex max-h-60 flex-col overflow-y-auto'>
        {options.map(option => (
          <MenuItem
            key={option.id}
            active={option.id === value}
            onClick={() => pick(option.id)}
            trackName='RepoFilterPicked'
          >
            {option.name}
          </MenuItem>
        ))}
      </div>
      <div className='mt-1 border-t border-border pt-1'>
        <MenuItem
          onClick={() => {
            setOpen(false);
            onConfigure();
          }}
          trackName='ConfigureAnotherRepository'
        >
          + Configure another repository
        </MenuItem>
      </div>
    </Popover>
  );
}

function EmptyState({
  icon,
  title,
  description,
  action,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
  children?: ReactNode;
}): ReactElement {
  return (
    <div className='flex flex-1 items-center justify-center px-8 pb-24 pt-12'>
      <div className='flex max-w-[440px] flex-col items-center gap-3.5 text-center'>
        <span className='flex size-11 items-center justify-center rounded-xl border border-border bg-muted text-muted-foreground'>
          {icon}
        </span>
        <div className='flex flex-col gap-1.5'>
          <h2 className='text-[17px] font-semibold text-foreground'>{title}</h2>
          <p className='text-sm leading-normal text-muted-foreground'>{description}</p>
        </div>
        {children}
        {action}
      </div>
    </div>
  );
}
