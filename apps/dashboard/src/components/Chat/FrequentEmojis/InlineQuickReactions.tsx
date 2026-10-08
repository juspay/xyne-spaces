import { useState, type ReactElement } from 'react';
import { useInlineQuickReactions } from '../../../hooks/useFrequentEmojis';
import { getEmojiDisplayName, renderEmoji } from '../../../utils/customEmojiUtils';
import { cn } from '../../../utils/classNames';

interface InlineQuickReactionsProps {
  /** Receives the stored reaction token — unicode char, or `custom:<emojiId>:<name>`. */
  onSelect: (emoji: string) => void;
  /** Whether this user already reacted to the message with the given emoji. */
  hasReacted?: ((emoji: string) => boolean) | undefined;
  /** Message the strip reacts to — carried on the analytics event. */
  messageId?: string | undefined;
}

/**
 * The user's top emojis rendered inline in the message hover toolbar, left of the picker
 * trigger — Slack's one-click reaction strip. The list is frozen for the lifetime of the
 * toolbar: recording a use re-ranks the store, and a strip that re-sorted live would move
 * the next button out from under the cursor mid-click. The toolbar unmounts when the
 * pointer leaves the row, so the next hover already shows the new ranking.
 */
export const InlineQuickReactions = ({
  onSelect,
  hasReacted,
  messageId,
}: InlineQuickReactionsProps): ReactElement | null => {
  const emojis = useInlineQuickReactions();
  const [frozenEmojis] = useState(emojis);

  if (frozenEmojis.length === 0) return null;

  const trackMetadata = messageId ? JSON.stringify({ messageId }) : undefined;

  return (
    <div className='flex items-center gap-0.5' data-testid='inline-quick-reactions'>
      {frozenEmojis.map(emoji => {
        const reacted = hasReacted?.(emoji) ?? false;
        const label = reacted
          ? `Remove ${getEmojiDisplayName(emoji)} reaction`
          : `React with ${getEmojiDisplayName(emoji)}`;

        return (
          <button
            key={emoji}
            type='button'
            onClick={() => onSelect(emoji)}
            title={label}
            aria-label={label}
            aria-pressed={reacted}
            data-testid={`inline-quick-reaction-${emoji}`}
            data-track-category='HOVER_ACTIONS_TOOLBAR'
            data-track-name='INLINE_QUICK_REACTION'
            data-track-metadata={trackMetadata}
            className={cn(
              'flex size-7 items-center justify-center rounded',
              'hover:bg-accent focus-visible:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
              // Mirrors the reaction chip so an already-applied reaction reads as "on"
              // rather than silently toggling off on the next click.
              reacted && 'border border-action-primary bg-accent',
            )}
          >
            {renderEmoji(emoji, 'w-4 h-4', 'text-base')}
          </button>
        );
      })}
    </div>
  );
};

export default InlineQuickReactions;
