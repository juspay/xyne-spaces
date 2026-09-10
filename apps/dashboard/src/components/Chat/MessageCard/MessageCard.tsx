import { type ReactElement, type ReactNode } from 'react';
import { cn } from '../../../utils/classNames';
import {
  MessageCardAttachmentThumbnails,
  type PanelAttachmentRow,
} from './MessageCardAttachmentThumbnails';

/**
 * Props for the MessageCard component.
 *
 * @property recipientAvatar - Avatar element displayed on the left side (e.g. UserAvatar or channel icon)
 * @property recipientName - Name of the recipient or channel (e.g. "Alice Cooper" for DMs, "#general" for channels)
 * @property contentPreview - Truncated message content shown below the recipient name
 * @property timestamp - Formatted time string displayed on the right side
 * @property actions - Action buttons revealed on hover (e.g. edit, delete, send)
 * @property onClick - Click handler for the entire card
 * @property className - Optional additional CSS classes
 * @property selected - Whether the card is in an active/selected state
 */
export interface MessageCardProps {
  recipientAvatar: ReactNode;
  recipientName: string;
  contentPreview: ReactNode;
  timestamp: ReactNode;
  /** Optional class override for the timestamp container. */
  timestampClassName?: string;
  /** Controls whether timestamp is in-row or floated top-right. */
  timestampLayout?: 'inline' | 'floating';
  actions: ReactNode;
  onClick: () => void;
  className?: string;
  selected?: boolean;
  /** Inner row inside a grouped list (no outer border; subtle hover) */
  variant?: 'default' | 'listRow';
  /** Activity tracking for card click (local-rules/require-tracking-on-click) */
  trackCategory?: string;
  trackName?: string;
  /** Optional draft / scheduled attachments (DRAFT or DELAYED_MESSAGE) for panel preview */
  attachments?: PanelAttachmentRow[];
}

/**
 * A reusable card component for displaying message items in a thread-style layout.
 * Used across SentPanel, DraftsPanel, and DelayedMessagesPanel.
 *
 * Features:
 * - Left-aligned recipient avatar (32x32; user avatars keep design-system shape, not forced circle)
 * - Recipient name and truncated content preview
 * - Timestamp on the right
 * - Hover-revealed action buttons
 * - Optional selected/active state
 * - Compatible with VirtualizedList (variable height)
 */
export function MessageCard({
  recipientAvatar,
  recipientName,
  contentPreview,
  timestamp,
  timestampClassName,
  timestampLayout = 'inline',
  actions,
  onClick,
  className,
  selected = false,
  variant = 'default',
  trackCategory = 'MESSAGE_CARD',
  trackName = 'MESSAGE_CARD_ROW_CLICK',
  attachments,
}: MessageCardProps): ReactElement {
  const hasActions = Boolean(actions);
  const isListRow = variant === 'listRow';
  const isTimestampFloating = timestampLayout === 'floating';

  return (
    <div
      role='button'
      tabIndex={0}
      onClick={onClick}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      data-track-category={trackCategory}
      data-track-name={trackName}
      className={cn(
        'group relative flex items-start gap-3 p-3 transition-all duration-200 cursor-pointer',
        isListRow
          ? 'rounded-none border-0 bg-transparent hover:bg-muted/30'
          : 'rounded-md border bg-card border-border hover:border-border/80',
        !isListRow && selected && 'border-primary/50 bg-primary/5',
        className,
      )}
    >
      <div className='flex h-8 w-8 flex-shrink-0 items-center justify-center overflow-visible'>
        {recipientAvatar}
      </div>

      <div className={cn('flex-1 min-w-0', isTimestampFloating && 'pr-36')}>
        <div className='flex items-start justify-between gap-2'>
          <p className='text-sm font-medium text-foreground truncate min-w-0'>{recipientName}</p>
          {!isTimestampFloating && (
            <div
              className={cn(
                'flex-shrink-0 text-xs text-muted-foreground ml-2 transition-opacity duration-150',
                hasActions && 'group-hover:opacity-0 group-focus-within:opacity-0',
                timestampClassName,
              )}
            >
              {timestamp}
            </div>
          )}
        </div>
        <p className='text-sm text-muted-foreground truncate mt-0.5'>{contentPreview}</p>
        {attachments && attachments.length > 0 && (
          <MessageCardAttachmentThumbnails
            attachments={attachments}
            className='mt-1.5'
            trackCategory={trackCategory}
          />
        )}
      </div>

      {isTimestampFloating && (
        <div
          className={cn(
            'absolute right-3 z-[1] text-xs text-muted-foreground transition-opacity duration-150',
            hasActions && 'group-hover:opacity-0 group-focus-within:opacity-0',
            timestampClassName,
          )}
        >
          {timestamp}
        </div>
      )}

      {hasActions && (
        // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- island stops propagation so nested controls do not trigger the card's role="button" handler
        <div
          className='absolute right-2.5 top-2.5 z-10 flex items-center gap-0.5 rounded-md border border-border bg-background px-1 py-0.5 shadow-sm opacity-0 pointer-events-none transition-opacity duration-150 group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto'
          onClick={e => e.stopPropagation()}
          onKeyDown={e => e.stopPropagation()}
          data-track-category={trackCategory}
          data-track-name='MESSAGE_CARD_ACTIONS_ISLAND'
        >
          {actions}
        </div>
      )}
    </div>
  );
}
