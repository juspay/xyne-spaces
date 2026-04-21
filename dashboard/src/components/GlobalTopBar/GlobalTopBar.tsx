import { ReactElement, useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import MetricsBar from '../MetricsBar/MetricsBar';
import { ArrowLeft, ArrowRight, LucideCommand, Search } from 'lucide-react';
import { ZeroConnectionStatus } from '../ZeroConnectionStatus/ZeroConnectionStatus';
import { invokeShortcut } from '../../shortcuts';
import { toast } from 'sonner';
import { WorkspaceSwitcher } from '../AppSidebar/WorkspaceSwitcher';

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
      </div>
    </div>
  );
};

const GlobalTopBar = (): ReactElement => {
  const handleDoubleClick = (): void => {
    if (typeof window.electronAPI?.toggleCompactMode === 'function') {
      window.electronAPI.toggleCompactMode();
    }
  };

  return (
    <div
      className='flex items-center justify-between min-[500px]:px-2 px-2 pt-[8px] pb-[2px]'
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      onDoubleClick={handleDoubleClick}
    >
      <div
        style={{ width: '12%', minWidth: '80px' } as React.CSSProperties}
        className='lg:w-[19%]'
        // no-drag so the button is clickable
      >
        <div style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties} className='ml-1 mt-1'>
          <WorkspaceSwitcher />
        </div>
      </div>
      <div className='flex-1 flex items-center justify-between'>
        <NavigationAndSearch />
        <div className='flex gap-1' style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <ZeroConnectionStatus />
          <div className='w-px h-4 bg-[var(--metrics-bar-divider)]' />
          <MetricsBar />
        </div>
      </div>
    </div>
  );
};

export default GlobalTopBar;
