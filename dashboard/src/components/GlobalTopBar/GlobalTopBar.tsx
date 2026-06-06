import { ReactElement, useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Circle,
  ExternalLink,
  Headset,
  LucideCommand,
  RefreshCw,
  Search,
  CircleHelp,
  Square,
} from 'lucide-react';
import { ZeroConnectionStatus } from '../ZeroConnectionStatus/ZeroConnectionStatus';
import { invokeShortcut } from '../../shortcuts';
import { toast } from 'sonner';
import { Tooltip } from '../ui/Tooltip';
import { WorkspaceSwitcher } from '../AppSidebar/WorkspaceSwitcher';

import { useCanCreateWorkspace } from '../../hooks/usePermissions';

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
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const maxIndexRef = useRef(0);

  useEffect(() => {
    const historyState = window.history.state as { idx?: number } | null;
    const currentIndex = historyState?.idx ?? 0;
    maxIndexRef.current = Math.max(maxIndexRef.current, currentIndex);

    setCanGoBack(currentIndex > 0);
    setCanGoForward(currentIndex < maxIndexRef.current);
  }, [location]);

  const handleGoBack = (): void => {
    if (canGoBack) {
      void navigate(-1);
    }
  };

  const handleGoForward = (): void => {
    if (canGoForward) {
      void navigate(1);
    }
  };

  const handleSearchClick = (): void => {
    // Programmatically invoke the global search shortcut (Cmd+K)
    const success = invokeShortcut('mod+k');
    if (!success) {
      toast.error('Search unavailable');
    }
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
        <button
          onClick={handleSearchClick}
          style={{
            backgroundColor: 'var(--nav-search-btn-bg)',
            color: 'var(--nav-search-btn-text)',
          }}
          className='flex sm:w-[220px] md:w-[280px] lg:w-[420px] xl:w-[480px] h-[28px] px-2 items-center gap-3 text-[12px] rounded-lg cursor-pointer'
          data-track-category='GLOBAL_TOP_BAR'
          data-track-name='OpenSearch'
        >
          <Search size={14} className='' />
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
        </button>
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

const GlobalTopBar = ({
  onOpenErrorReport,
  onViewMyTickets,
  isRecording,
  recordingSeconds = 0,
  onStopRecording,
}: GlobalTopBarProps): ReactElement => {
  const [supportMenuOpen, setSupportMenuOpen] = useState(false);
  const menuTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState<{
    currentVersion: string;
    latestVersion: string;
    loadType: 'manual' | 'auto';
  } | null>(null);

  // Listen for app update available event from Electron
  useEffect(() => {
    if (!window.electronAPI?.onAppUpdateAvailable) return;

    const cleanup = window.electronAPI.onAppUpdateAvailable(data => {
      // Validate the data structure
      if (
        !data ||
        typeof data !== 'object' ||
        typeof data.currentVersion !== 'string' ||
        typeof data.latestVersion !== 'string' ||
        (data.loadType !== 'manual' && data.loadType !== 'auto')
      ) {
        console.warn('Invalid app update data received:', data);
        return;
      }

      if (data.loadType === 'auto') {
        window.location.reload();
      }
      setUpdateAvailable(data);
    });

    return cleanup;
  }, []);

  const handleApplyUpdate = (): void => {
    window.electronAPI?.applyAppUpdate?.();
  };

  const openSupportMenu = (): void => {
    if (menuTimerRef.current) clearTimeout(menuTimerRef.current);
    setSupportMenuOpen(true);
  };

  const scheduleSupportMenuClose = (): void => {
    if (menuTimerRef.current) clearTimeout(menuTimerRef.current);
    menuTimerRef.current = setTimeout(() => setSupportMenuOpen(false), 150);
  };

  const canCreateWorkspace = useCanCreateWorkspace();

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
        // no-drag so the button is clickable
      >
        <div style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties} className='ml-1 mt-1'>
          {canCreateWorkspace && <WorkspaceSwitcher />}
        </div>
      </div>
      <div className='absolute left-1/2 -translate-x-1/2 flex items-center'>
        <NavigationAndSearch />
      </div>
      <div className='flex items-center'>
        <div
          className='flex items-center gap-1'
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {/* Pills collapse from the left as the bar narrows: Connected first
              (below 1100px), then Support (below 950px). Update always stays. */}
          <div className='flex items-center max-[1100px]:hidden'>
            <ZeroConnectionStatus />
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
                <span className='font-mono'>
                  {String(Math.floor(recordingSeconds / 60)).padStart(2, '0')}:
                  {String(recordingSeconds % 60).padStart(2, '0')}
                </span>
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
          {updateAvailable && (
            <Tooltip
              content={`Update available: ${updateAvailable.currentVersion} → ${updateAvailable.latestVersion}`}
              side='bottom'
              delayDuration={300}
            >
              <button
                type='button'
                onClick={handleApplyUpdate}
                className='flex h-6 items-center gap-2 rounded-md px-2 font-sans font-semibold text-xs leading-none tracking-normal bg-[var(--update-btn-bg)] text-[var(--update-btn-text)] hover:opacity-80 transition-opacity cursor-pointer'
                aria-label='apply-update'
                data-track-category='MetricsBar'
                data-track-name='ApplyUpdate'
                data-track-metadata={JSON.stringify({
                  currentVersion: updateAvailable.currentVersion,
                  latestVersion: updateAvailable.latestVersion,
                })}
              >
                <RefreshCw className='w-4 h-4' />
                <span>Update</span>
              </button>
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  );
};

export default GlobalTopBar;
