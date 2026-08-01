import { ReactElement, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, SearchBig, Share01, CheckTickSingle } from '@xyne/icons';
import { invokeShortcut } from '../../shortcuts';
import { cn } from '../../utils/classNames';
import { APP_DRAG_STYLE, APP_NO_DRAG_STYLE } from '../../utils/electronApp';
import { toast } from 'sonner';

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
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const [copied, setCopied] = useState(false);

  const handleShareWorkspace = async (): Promise<void> => {
    if (!workspaceId) return;

    const shareUrl = `${window.location.origin}/auth?workspaceId=${encodeURIComponent(workspaceId)}`;

    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      toast.success('Workspace link copied to clipboard');
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error('Failed to copy workspace link');
    }
  };

  return (
    <div className='h-full w-full flex items-center justify-end gap-2 px-4' style={APP_DRAG_STYLE}>
      <div className='flex items-center' style={APP_NO_DRAG_STYLE}>
        {workspaceId && (
          <button
            type='button'
            aria-label='Share workspace link'
            onClick={() => void handleShareWorkspace()}
            className={buttonClass}
            data-track-category='APP_NAVIGATOR'
            data-track-name='SHARE_WORKSPACE'
          >
            {copied ? <CheckTickSingle size={16} /> : <Share01 size={16} />}
          </button>
        )}
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
      </div>
    </div>
  );
};

export default AppNavigator;
