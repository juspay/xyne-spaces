import { ReactElement, useEffect, useRef, useState } from 'react';
import { useSelector } from '@xstate/react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, SearchBig } from '@xyne/icons';
import { invokeShortcut } from '../../shortcuts';
import { ShortcutTooltip } from '../ui/ShortcutTooltip';
import { cn } from '../../utils/classNames';
import { APP_DRAG_STYLE, APP_NO_DRAG_STYLE } from '../../utils/electronApp';
import { roomActor } from '../../machines/roomMachine';

const buttonClass = cn(
  'size-7 flex items-center justify-center rounded-[10px] border border-transparent transition-colors',
  'text-sidebar-secondary-foreground hover:text-sidebar-accent-foreground hover:bg-sidebar-accent',
);

const disabledButtonClass = cn(
  buttonClass,
  'cursor-not-allowed opacity-50 hover:bg-transparent hover:text-sidebar-secondary-foreground',
);

const getHistoryIndex = (): number => {
  const historyState = window.history.state as { idx?: unknown } | null;
  const index = historyState?.idx;
  return typeof index === 'number' ? index : 0;
};

/**
 * Top-bar navigation cluster: history back/forward and the global (cmd+k) search.
 * Matches the Agent Hub navigator frame — back and forward sit adjacent, with the
 * search button separated to the right.
 */
const AppNavigator = (): ReactElement => {
  const navigate = useNavigate();
  const location = useLocation();
  const [historyIndex, setHistoryIndex] = useState(getHistoryIndex);
  const maxHistoryIndexRef = useRef(historyIndex);
  const shouldHideForFullCall = useSelector(
    roomActor,
    state => state.matches('connected') && state.context.viewMode === 'full',
  );

  useEffect(() => {
    const nextHistoryIndex = getHistoryIndex();
    maxHistoryIndexRef.current = Math.max(maxHistoryIndexRef.current, nextHistoryIndex);
    setHistoryIndex(nextHistoryIndex);
  }, [location.key]);

  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex < maxHistoryIndexRef.current;

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

  if (shouldHideForFullCall) {
    return <></>;
  }

  return (
    <div
      className='h-full w-full flex items-center justify-between gap-2 px-4'
      style={APP_DRAG_STYLE}
    >
      <div className='flex items-center' style={APP_NO_DRAG_STYLE}>
        <ShortcutTooltip label='Back' shortcut='global.goBack' side='bottom'>
          <button
            type='button'
            aria-label='Back'
            onClick={handleGoBack}
            disabled={!canGoBack}
            className={canGoBack ? buttonClass : disabledButtonClass}
            data-track-category='APP_NAVIGATOR'
            data-track-name='GO_BACK'
          >
            <ArrowLeft size={16} />
          </button>
        </ShortcutTooltip>
        <ShortcutTooltip label='Forward' shortcut='global.goForward' side='bottom'>
          <button
            type='button'
            aria-label='Forward'
            onClick={handleGoForward}
            disabled={!canGoForward}
            className={canGoForward ? buttonClass : disabledButtonClass}
            data-track-category='APP_NAVIGATOR'
            data-track-name='GO_FORWARD'
          >
            <ArrowRight size={16} />
          </button>
        </ShortcutTooltip>
      </div>
      <div className='flex items-center' style={APP_NO_DRAG_STYLE}>
        <ShortcutTooltip label='Search' shortcut='global.search' side='bottom'>
          <button
            type='button'
            aria-label='Search'
            onClick={() => invokeShortcut('mod+k')}
            className={buttonClass}
            data-track-category='APP_NAVIGATOR'
            data-track-name='OPEN_SEARCH'
          >
            <SearchBig size={16} />
          </button>
        </ShortcutTooltip>
      </div>
    </div>
  );
};

export default AppNavigator;
