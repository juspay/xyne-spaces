import { ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, SearchBig } from '@xyne/icons';
import { invokeShortcut } from '../../shortcuts';
import { cn } from '../../utils/classNames';
import { APP_DRAG_STYLE, APP_NO_DRAG_STYLE } from '../../utils/electronApp';

const buttonClass = cn(
  'size-7 flex items-center justify-center rounded-[10px] border border-transparent transition-colors',
  'text-sidebar-secondary-foreground hover:text-sidebar-accent-foreground hover:bg-sidebar-accent hover:border-sidebar-border',
);

/**
 * Top-bar navigation cluster: history back/forward and the global (cmd+k) search.
 * Matches the Agent Hub navigator frame — back and forward sit adjacent, with the
 * search button separated to the right.
 */
const AppNavigator = (): ReactElement => {
  const navigate = useNavigate();

  return (
    <div className='h-full w-full flex items-center justify-end gap-2 px-4' style={APP_DRAG_STYLE}>
      <div className='flex items-center' style={APP_NO_DRAG_STYLE}>
        <button
          type='button'
          aria-label='Back'
          onClick={() => void navigate(-1)}
          className={buttonClass}
          data-track-category='APP_NAVIGATOR'
          data-track-name='GO_BACK'
        >
          <ArrowLeft size={16} />
        </button>
        <button
          type='button'
          aria-label='Forward'
          onClick={() => void navigate(1)}
          className={buttonClass}
          data-track-category='APP_NAVIGATOR'
          data-track-name='GO_FORWARD'
        >
          <ArrowRight size={16} />
        </button>
      </div>
      <button
        type='button'
        aria-label='Search'
        onClick={() => invokeShortcut('mod+k')}
        className={buttonClass}
        style={APP_NO_DRAG_STYLE}
        data-track-category='APP_NAVIGATOR'
        data-track-name='OPEN_SEARCH'
      >
        <SearchBig size={16} />
      </button>
    </div>
  );
};

export default AppNavigator;
