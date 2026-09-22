import { ReactElement, useMemo } from 'react';
import { Loader2, ScrollText, X } from 'lucide-react';
import { motion } from 'framer-motion';
import { Button } from '../../ui/Button';
import Tooltip from '../../ui/Tooltip';
import { cn } from '../../../utils/classNames';
import { MarkdownMessageRenderer } from '../../ui/MessageBubble/MarkdownMessageRenderer';
import { createMarkdownComponents } from '../../../utils/markdownComponents';

const dropdownVariants = {
  initial: { opacity: 0, y: -28 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] },
  },
  exit: {
    opacity: 0,
    y: -28,
    transition: { duration: 0.2, ease: [0.4, 0, 1, 1] },
  },
} as const;

interface ThreadCatchupSummaryButtonProps {
  isRecommended: boolean;
  loading: boolean;
  onClick: () => void;
}

export function ThreadCatchupSummaryButton({
  isRecommended,
  loading,
  onClick,
}: ThreadCatchupSummaryButtonProps): ReactElement {
  return (
    <Tooltip content={loading ? 'Generating summary…' : 'Thread summary'}>
      <Button
        size='sm'
        variant='outline'
        onClick={onClick}
        disabled={loading}
        aria-label='Show thread summary'
        data-track-category='THREAD_PANEL'
        data-track-name='TOGGLE_CATCHUP_SUMMARY'
        className={cn(
          'relative flex items-center justify-between gap-2 border rounded-lg !p-2 transition-all duration-100 text-foreground bg-background border-border',
          isRecommended && 'ring-2 ring-pink-400',
        )}
      >
        {loading ? (
          <Loader2 size={18} className='text-pink-500 animate-spin' />
        ) : (
          <ScrollText size={18} className={isRecommended ? 'text-pink-500' : undefined} />
        )}
        {isRecommended && !loading && (
          <span className='absolute -top-1 -right-1 h-2 w-2 rounded-full bg-pink-500 animate-pulse' />
        )}
      </Button>
    </Tooltip>
  );
}

interface ThreadCatchupSummaryPanelProps {
  content: string | undefined;
  loading: boolean;
  onClose: () => void;
}

export function ThreadCatchupSummaryPanel({
  content,
  loading,
  onClose,
}: ThreadCatchupSummaryPanelProps): ReactElement {
  const markdownComponents = useMemo(() => createMarkdownComponents('thread-catchup-summary'), []);

  return (
    <motion.div variants={dropdownVariants} initial='initial' animate='animate' exit='exit'>
      <div className='flex items-start justify-between gap-2 px-4 py-3'>
        <ScrollText size={16} className='text-muted-foreground shrink-0 mt-0.5' />
        <div className='flex-1 min-w-0 max-h-64 overflow-y-auto'>
          <div className='text-sm font-medium text-muted-foreground'>Thread Summary</div>
          <div className='text-sm italic text-muted-foreground opacity-70'>
            {content ? (
              <MarkdownMessageRenderer content={content} markdownComponents={markdownComponents} />
            ) : loading ? (
              <span className='flex items-center gap-2'>
                <Loader2 size={14} className='animate-spin' />
                Generating summary…
              </span>
            ) : (
              <span>No thread summary available for this thread yet.</span>
            )}
          </div>
        </div>
        <Button
          size='sm'
          variant='ghost'
          className='h-6 w-6 p-0 shrink-0 text-muted-foreground hover:text-muted-foreground'
          onClick={onClose}
          data-track-category='THREAD_PANEL'
          data-track-name='DISMISS_CATCHUP_SUMMARY'
          aria-label='Dismiss summary'
        >
          <X size={14} />
        </Button>
      </div>
    </motion.div>
  );
}
