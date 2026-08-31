import { ReactElement, useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import * as Popover from '@radix-ui/react-popover';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  Circle,
  ExternalLink,
  Headset,
  LucideCommand,
  Search,
  CircleHelp,
  Share2,
  Square,
} from 'lucide-react';
import { invokeShortcut } from '../../shortcuts';
import { useSearchMode } from '../../hooks/useSearchMode';
import { toast } from 'sonner';
import { hasAnySearchState } from '../../hooks/useSearchResultsScreen';
import { Tooltip } from '../ui/Tooltip';
import GlobalCommandMenu from '../GlobalCommandMenu/GlobalCommandMenu';
import type { MentionData } from '../Chat/ChatDirectory/ChannelCommandMenu.types';
import { formatElapsedTime } from '../../utils/recordingUtils';
import { queries } from '../../zero/queries';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { WorkspaceJoinPolicy } from '@xyne/shared';

interface GlobalTopBarProps {
  onOpenErrorReport?: () => void;
  onViewMyTickets?: () => void;
  isRecording?: boolean;
  recordingSeconds?: number;
  onStopRecording?: () => void;
}

const NavigationAndSearch = (): ReactElement => {
  const navigate = useNavigate();
  const location = useLocation();
  const { searchMode } = useSearchMode();
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const maxIndexRef = useRef(0);
  const [searchOpen, setSearchOpen] = useState(false);
  // Restore the previous query only when the overlay is opened by clicking the
  // header search bar on the results screen — the global Cmd+K shortcut and the
  // empty-state still open with a blank input.
  const [restoreQuery, setRestoreQuery] = useState(false);
  // Cmd+F (screen mode) opens this bar pre-scoped with an in:<channel> chip; the
  // event carries the mention so the input renders cursor-ready with the chip.
  const [pendingMention, setPendingMention] = useState<MentionData | null>(null);
  // Cmd+/ (screen mode) opens this bar seeded with `/` so it lands in slash-command discovery.
  const [pendingCommand, setPendingCommand] = useState(false);
  const openedAtHrefRef = useRef('');
  useEffect(() => {
    if (searchOpen) {
      openedAtHrefRef.current = window.location.pathname + window.location.search;
    }
  }, [searchOpen]);

  useEffect(() => {
    const historyState = window.history.state as { idx?: number } | null;
    const currentIndex = historyState?.idx ?? 0;
    maxIndexRef.current = Math.max(maxIndexRef.current, currentIndex);

    setCanGoBack(currentIndex > 0);
    setCanGoForward(currentIndex < maxIndexRef.current);
  }, [location]);

  // Listen for the screen-mode search-bar activation event. Cmd+K dispatches it
  // with no detail (empty bar); Cmd+F dispatches it with an in:<channel> mention
  // so the bar opens pre-scoped; Cmd+/ dispatches it with `command: true` so the bar
  // opens seeded with `/`. Either way it opens with no query restore.
  useEffect(() => {
    const handler = (event: Event): void => {
      const detail = (event as CustomEvent<{ mention?: MentionData; command?: boolean }>).detail;
      setPendingMention(detail?.mention ?? null);
      setPendingCommand(detail?.command ?? false);
      setRestoreQuery(false);
      setSearchOpen(true);
    };
    window.addEventListener('xyne:activate-search-bar', handler);
    return () => window.removeEventListener('xyne:activate-search-bar', handler);
  }, []);

  const handleGoBack = (): void => {
    if (canGoBack) void navigate(-1);
  };

  const handleGoForward = (): void => {
    if (canGoForward) void navigate(1);
  };

  const isOnSearchScreen = location.pathname.endsWith('/search-results');
  const searchScreenParams = new URLSearchParams(location.search);
  const searchScreenQuery = isOnSearchScreen
    ? (searchScreenParams.get('display') ?? searchScreenParams.get('query') ?? '')
    : '';

  const handleSearchClick = (): void => {
    if (searchMode === 'screen') {
      // Clicking the header bar on the results screen restores the active query;
      // elsewhere the overlay opens empty.
      // Restore whenever the results URL holds any search — a filters-only search
      // (`in:#eng status:todo`, no words) has no query text but is still worth restoring.
      setRestoreQuery(isOnSearchScreen && hasAnySearchState(searchScreenParams));
      setSearchOpen(true);
      return;
    }
    const success = invokeShortcut('mod+k');
    if (!success) toast.error('Search unavailable');
  };

  return (
    <div className='flex items-center gap-4'>
      <div
        className='flex items-center gap-1'
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        onDoubleClick={e => e.stopPropagation()}
      >
        <button
          onClick={handleGoBack}
          onDoubleClick={e => e.stopPropagation()}
          disabled={!canGoBack}
          className={`p-1 ${canGoBack ? 'cursor-pointer' : 'cursor-not-allowed'}`}
          aria-label='go-back'
          data-track-category='GLOBAL_TOP_BAR'
          data-track-name='GoBack'
        >
          <ArrowLeft
            style={{ color: canGoBack ? 'var(--nav-active-icon)' : 'var(--nav-disabled-icon)' }}
            size={16}
          />
        </button>
        <span className='text-[12px]' style={{ color: 'var(--nav-icon-seperator)' }}>
          |
        </span>
        <button
          onClick={handleGoForward}
          onDoubleClick={e => e.stopPropagation()}
          disabled={!canGoForward}
          className={`p-1 ${canGoForward ? 'cursor-pointer' : 'cursor-not-allowed'}`}
          aria-label='go-next'
          data-track-category='GLOBAL_TOP_BAR'
          data-track-name='GoForward'
        >
          <ArrowRight
            style={{ color: canGoForward ? 'var(--nav-active-icon)' : 'var(--nav-disabled-icon)' }}
            size={16}
          />
        </button>
      </div>
      <div
        className='flex items-center gap-2'
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        onDoubleClick={e => e.stopPropagation()}
      >
        <Popover.Root
          open={searchMode === 'screen' && searchOpen}
          onOpenChange={open => {
            if (!open) {
              setSearchOpen(false);
              setRestoreQuery(false);
              setPendingMention(null);
              setPendingCommand(false);
            }
          }}
        >
          <Popover.Anchor asChild>
            <button
              id='global-search-bar'
              onClick={handleSearchClick}
              style={{
                backgroundColor: 'var(--nav-search-btn-bg)',
                color: 'var(--nav-search-btn-text)',
              }}
              className='flex sm:w-[220px] md:w-[280px] lg:w-[420px] xl:w-[480px] h-[28px] px-2 items-center gap-3 text-[12px] rounded-lg cursor-pointer'
              data-track-category='GLOBAL_TOP_BAR'
              data-track-name='OpenSearch'
            >
              <Search size={14} className='shrink-0' />
              {isOnSearchScreen && searchScreenQuery ? (
                <span className='truncate'>
                  <span style={{ color: 'var(--nav-search-btn-text)', opacity: 0.6 }}>
                    Search:{' '}
                  </span>
                  {searchScreenQuery}
                </span>
              ) : (
                <div className='flex gap-2 items-center'>
                  <span>Search</span>
                  <div className='flex items-center gap-1'>
                    <span>(</span>
                    <LucideCommand size={14} />
                    <span>+</span>
                    <span>K</span>
                    <span>)</span>
                  </div>
                </div>
              )}
            </button>
          </Popover.Anchor>

          <Popover.Portal>
            {/* sideOffset=-28 pulls the panel up so its top edge aligns with the search pill,
                creating the "overlay" effect. max-w-3xl matches the existing Command.Dialog width. */}
            <Popover.Content
              side='bottom'
              align='start'
              sideOffset={-28}
              onOpenAutoFocus={e => e.preventDefault()}
              onCloseAutoFocus={e => {
                const href = window.location.pathname + window.location.search;
                if (href !== openedAtHrefRef.current) e.preventDefault();
              }}
              onInteractOutside={() => {
                setSearchOpen(false);
                setPendingMention(null);
                setPendingCommand(false);
              }}
              className='z-[9999] bg-background border border-border rounded-2xl shadow-[0px_7px_15px_0px_#0000000D,0px_28px_28px_0px_#00000017,0px_62px_37px_0px_#0000000D] overflow-hidden max-h-[80vh]'
              style={{
                width: 'calc(var(--radix-popper-anchor-width) + 96px)',
                minWidth: '560px',
                marginLeft: '-8px',
              }}
            >
              <GlobalCommandMenu
                inline
                open={searchOpen}
                onOpenChange={open => {
                  if (!open) {
                    setSearchOpen(false);
                    setRestoreQuery(false);
                    setPendingMention(null);
                    setPendingCommand(false);
                  }
                }}
                hideTabs
                initialMention={pendingMention}
                restoreQueryFromUrl={restoreQuery}
                seedCommand={pendingCommand}
              />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>

        <button
          onClick={() => void navigate('/guide')}
          style={{ color: 'var(--nav-search-btn-text)' }}
          className='flex items-center justify-center h-[28px] w-[28px] rounded-lg cursor-pointer hover:bg-[var(--nav-search-btn-bg)]'
          aria-label='User Guide'
          title='User Guide'
          data-track-category='GLOBAL_TOP_BAR'
          data-track-name='OpenUserGuide'
        >
          <CircleHelp size={16} />
        </button>
      </div>
    </div>
  );
};

const WorkspaceInviteButton = (): ReactElement | null => {
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const [copied, setCopied] = useState(false);
  const [workspace] = useCachedQuery(queries.getWorkspaceById({ workspaceId: workspaceId ?? '' }), {
    enabled: !!workspaceId,
  });

  if (!workspaceId) {
    return null;
  }

  const joinPolicy = workspace?.joinPolicy ?? WorkspaceJoinPolicy.INVITE_ONLY;
  if (joinPolicy === WorkspaceJoinPolicy.INVITE_ONLY) {
    return null;
  }

  const handleCopyInviteLink = async (): Promise<void> => {
    const inviteUrl = `${window.location.origin}/community/join?workspaceId=${encodeURIComponent(workspaceId)}`;

    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      toast.success('Invite link copied');
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error('Failed to copy invite link');
    }
  };

  return (
    <Tooltip
      content={workspace?.name ? `Invite to ${workspace.name} workspace` : 'Invite to workspace'}
      side='bottom'
      delayDuration={300}
    >
      <button
        type='button'
        onClick={() => void handleCopyInviteLink()}
        className='flex h-6 items-center gap-1.5 rounded-md px-2 font-sans font-medium text-xs leading-none tracking-normal text-[var(--metrics-bar-color)] hover:bg-[var(--metrics-bar-hover-bg)]/80 transition-colors cursor-pointer'
        aria-label='copy-workspace-invite-link'
        data-track-category='GLOBAL_TOP_BAR'
        data-track-name='CopyCommunityWorkspaceInvite'
        data-track-metadata={JSON.stringify({ workspaceId })}
      >
        {copied ? <Check className='size-3.5 text-emerald-500' /> : <Share2 className='size-3.5' />}
        <span>{copied ? 'Copied' : 'Invite'}</span>
      </button>
    </Tooltip>
  );
};

const GlobalTopBar = ({
  onOpenErrorReport,
  onViewMyTickets,
  isRecording,
  recordingSeconds = 0,
  onStopRecording,
}: GlobalTopBarProps): ReactElement => {
  const [supportMenuOpen, setSupportMenuOpen] = useState(false);
  const menuTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openSupportMenu = (): void => {
    if (menuTimerRef.current) clearTimeout(menuTimerRef.current);
    setSupportMenuOpen(true);
  };

  const scheduleSupportMenuClose = (): void => {
    if (menuTimerRef.current) clearTimeout(menuTimerRef.current);
    menuTimerRef.current = setTimeout(() => setSupportMenuOpen(false), 150);
  };

  const handleDoubleClick = (): void => {
    if (typeof window.electronAPI?.toggleCompactMode === 'function') {
      window.electronAPI.toggleCompactMode();
    }
  };

  return (
    <div
      className='relative flex items-center justify-between min-[500px]:px-2 px-2 pt-[8px] pb-[2px]'
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      onDoubleClick={handleDoubleClick}
    >
      <div
        style={{ width: '12%', minWidth: '80px' } as React.CSSProperties}
        className='lg:w-[19%]'
      />
      <div className='absolute left-1/2 -translate-x-1/2 flex items-center'>
        <NavigationAndSearch />
      </div>
      <div className='flex items-center'>
        <div
          className='flex items-center gap-1'
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {/* Pills collapse from the left as the bar narrows: Invite first
              (below 1100px), then Support (below 950px). Update always stays.
              Connection status now lives in the sidebar rail. */}
          <div className='flex items-center gap-1 max-[1100px]:hidden'>
            <WorkspaceInviteButton />
          </div>
          {isRecording && onStopRecording && (
            <Tooltip content='Stop recording'>
              <button
                type='button'
                onClick={onStopRecording}
                className='flex h-6 items-center gap-1.5 rounded-md px-2 font-sans font-medium text-xs leading-none tracking-normal text-red-500 dark:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer max-[820px]:hidden'
                aria-label='stop-recording'
                data-track-category='ERROR_REPORT'
                data-track-name='StopRecordingTopBar'
              >
                <Circle className='size-2.5 fill-current animate-pulse' />
                <span className='font-mono'>{formatElapsedTime(recordingSeconds * 1000)}</span>
                <Square className='size-3 fill-current' />
              </button>
            </Tooltip>
          )}
          {!isRecording && onOpenErrorReport && (
            <div
              className='relative max-[820px]:hidden'
              onMouseEnter={openSupportMenu}
              onMouseLeave={scheduleSupportMenuClose}
            >
              <button
                type='button'
                className='flex h-6 items-center gap-2 rounded-md px-2 font-sans font-medium text-xs leading-none tracking-normal text-[var(--metrics-bar-color)] hover:bg-[var(--metrics-bar-hover-bg)]/80 transition-colors cursor-pointer'
                aria-label='support'
                aria-haspopup='true'
                aria-expanded={supportMenuOpen}
                data-track-category='ERROR_REPORT'
                data-track-name='OpenSupportMenu'
              >
                <Headset size={14} className='text-[var(--metrics-bar-color)]' />
                <span>Support</span>
              </button>
              {supportMenuOpen && (
                <div
                  role='menu'
                  className='absolute right-0 top-full mt-1 z-[60] min-w-[8rem] overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md whitespace-nowrap'
                >
                  <button
                    type='button'
                    role='menuitem'
                    className='relative flex w-full cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground'
                    onClick={() => {
                      onOpenErrorReport();
                      setSupportMenuOpen(false);
                    }}
                    data-track-category='ERROR_REPORT'
                    data-track-name='OpenModal'
                  >
                    <AlertCircle className='size-4 shrink-0' />
                    <span>Report issue</span>
                  </button>
                  {onViewMyTickets && (
                    <button
                      type='button'
                      role='menuitem'
                      className='relative flex w-full cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground'
                      onClick={() => {
                        onViewMyTickets();
                        setSupportMenuOpen(false);
                      }}
                      data-track-category='ERROR_REPORT'
                      data-track-name='ViewMyTickets'
                    >
                      <ExternalLink className='size-4 shrink-0' />
                      <span>View my tickets</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default GlobalTopBar;
