import { ReactElement } from 'react';
import { Hash, X } from 'lucide-react';
import { cn } from '../../../utils/classNames';

/**
 * PaneSourceBar — a slim provenance strip rendered at the top of the channel
 * secondary ("third") pane. It tells the user WHERE the item they just opened
 * came from, so opening a canvas / ticket / desk ticket in the pane never feels
 * context-less ("I am lost").
 *
 * The channel shell (ConversationPanelV2 + its tab strip) stays mounted on the
 * left; this bar is the pane's own lightweight header that names:
 *   - the channel the user is browsing (the shell), and
 *   - the tab the item was opened from (Canvas / Tickets / Desk).
 *
 * When the opened item actually LIVES in a different channel (e.g. a ticket on a
 * shared board owned by another channel), pass `sourceChannelName` so the bar can
 * say "Opened from #payments-core · in #refunds" — making the cross-channel
 * origin explicit WITHOUT the shell silently switching channels.
 *
 * This component is intentionally presentational and side-effect free. The owner
 * (ChatView) supplies the labels and the close handler, which keeps the URL /
 * routing signal in one place.
 */
export interface PaneSourceBarProps {
  /** Display name of the channel the user is browsing (the shell). */
  channelName: string;
  /** Human label of the tab the item was opened from, e.g. "Canvas", "Tickets". */
  tabLabel: string;
  /**
   * When the opened item lives in a DIFFERENT channel than the shell (shared
   * board tickets), the name of that owning channel. Rendered as "in #<name>".
   */
  sourceChannelName?: string;
  /** Optional close affordance — removes the pane signal and returns to the list. */
  onClose?: () => void;
  className?: string;
}

export const PaneSourceBar = ({
  channelName,
  tabLabel,
  sourceChannelName,
  onClose,
  className,
}: PaneSourceBarProps): ReactElement => {
  return (
    <div
      data-component='PaneSourceBar'
      className={cn(
        'flex items-center gap-1.5 px-3 h-9 flex-shrink-0 border-b border-border bg-muted/40 text-xs text-muted-foreground select-none',
        className,
      )}
    >
      <span className='shrink-0'>Opened from</span>
      <span className='inline-flex items-center gap-0.5 font-medium text-foreground min-w-0'>
        <Hash size={12} className='shrink-0 opacity-70' />
        <span className='truncate'>{channelName}</span>
      </span>
      <span className='shrink-0 opacity-70'>·</span>
      <span className='shrink-0 font-medium text-foreground'>{tabLabel}</span>
      {sourceChannelName && sourceChannelName !== channelName && (
        <>
          <span className='shrink-0 opacity-70'>·</span>
          <span className='inline-flex items-center gap-0.5 min-w-0'>
            <span className='shrink-0'>in</span>
            <Hash size={12} className='shrink-0 opacity-70' />
            <span className='truncate'>{sourceChannelName}</span>
          </span>
        </>
      )}
      {onClose && (
        <button
          type='button'
          onClick={onClose}
          aria-label='Close panel'
          data-track-category='ChannelPane'
          data-track-name='CloseSourcePane'
          className='ml-auto shrink-0 p-1 -mr-1 rounded-md hover:text-foreground hover:bg-muted transition-colors'
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
};

export default PaneSourceBar;
