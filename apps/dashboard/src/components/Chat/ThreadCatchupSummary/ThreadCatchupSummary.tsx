import { ReactElement, useMemo } from 'react';
import { Loader2, ScrollText, X } from 'lucide-react';
import { motion } from 'framer-motion';
import { Button } from '../../ui/Button';
import Tooltip from '../../ui/Tooltip';
import { cn } from '../../../utils/classNames';
import { MarkdownMessageRenderer } from '../../ui/MessageBubble/MarkdownMessageRenderer';
import { createMarkdownComponents } from '../../../utils/markdownComponents';

// Slides straight down from the header and fades in — no `scale`. Scaling a
// full-width, edge-to-edge panel from slightly-shrunk to 100% reads as a
// "pop"/zoom (its left and right edges visibly snap outward), not a
// dropdown. A pure vertical slide is what actually looks like something
// unfurling downward from the header bar above it.
//
// A tween with an explicit duration (not a spring) — a fast/stiff spring
// settles too quickly to read as "dropping," and a spring's effective
// duration is hard to reason about directly. -28px of travel over 0.35s
// with a decelerating ease gives it enough distance and time to actually
// look like it's coming down and settling, not just fading in place.
//
// Deliberately does NOT animate `height`. Framer Motion resolves 'auto' to a
// measured px value under the hood (render once to measure, snap back,
// then interpolate) — on a panel whose natural size can itself change right
// after mount (loading -> content), that measurement step keeps producing a
// visible second jump no matter how the height transition is tuned. Since
// opacity/y are plain scalars with no layout measurement involved, animating
// only those is glitch-proof regardless of content or timing.
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

/** Header button — present once the feature is enabled; glows if a summary was already ready when the viewer opened the thread. */
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

/**
 * The summary display — auto-shown (no Yes/No ask) for someone who was just
 * added to the thread, or opened manually via the header button. Deliberately
 * minimal: an icon + light-weight "Thread Summary" label directly above
 * muted/italic body text, plus a dismiss X — no card chrome, no separate
 * header row, no avatar. Same component/style for both the automatic and
 * manual cases, so there's one consistent look regardless of how it opened.
 */
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
        {/* "Thread Summary" label sits above the content (light weight,
            upright) — the summary itself reads as muted/italic body copy
            below it. Capped + internally scrollable so a long summary
            can't push the actual thread messages out of view. */}
        <div className='flex-1 min-w-0 max-h-64 overflow-y-auto'>
          <div className='text-sm font-medium text-muted-foreground'>Thread Summary</div>
          {/* opacity-* (not text-muted-foreground/N) — the markdown
              renderer's own elements (e.g. <strong> for bold names) set
              their own explicit color, which wins over inherited text
              color from this wrapper. `opacity` is a compositing property
              applied to the whole rendered subtree regardless of each
              child's own color, so it actually lightens everything. */}
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
          aria-label='Dismiss summary'
        >
          <X size={14} />
        </Button>
      </div>
    </motion.div>
  );
}
