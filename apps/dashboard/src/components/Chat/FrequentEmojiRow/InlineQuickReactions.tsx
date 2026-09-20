import type { ReactElement } from 'react';
import { useFrequentEmojis } from '../../../hooks/useFrequentEmojis';
import { DEFAULT_QUICK_REACTIONS } from '../../../utils/frequentEmojis';
import { getEmojiDisplayName, renderEmoji } from '../../../utils/customEmojiUtils';

interface InlineQuickReactionsProps {
  /** Receives the stored reaction token — unicode char, or `custom:<emojiId>:<name>`. */
  onSelect: (emoji: string) => void;
  /** How many inline buttons to show. Keep small — the toolbar is narrow. */
  limit?: number;
}

/**
 * The user's top emojis rendered inline in the message hover toolbar, left of the
 * picker trigger — Slack's one-click reaction strip. Falls back to a fixed default
 * set until the user has reacted, so the toolbar looks the same on day one and the
 * strip never collapses to nothing.
 */
export const InlineQuickReactions = ({
  onSelect,
  limit = 3,
}: InlineQuickReactionsProps): ReactElement | null => {
  const frequentEmojis = useFrequentEmojis(limit);
  const emojis =
    frequentEmojis.length > 0 ? frequentEmojis : DEFAULT_QUICK_REACTIONS.slice(0, limit);

  if (emojis.length === 0) return null;

  return (
    <div className='flex items-center gap-0.5' data-testid='inline-quick-reactions'>
      {emojis.map(emoji => (
        <button
          key={emoji}
          type='button'
          onClick={() => onSelect(emoji)}
          title={`React with ${getEmojiDisplayName(emoji)}`}
          aria-label={`React with ${getEmojiDisplayName(emoji)}`}
          data-testid={`inline-quick-reaction-${emoji}`}
          data-track-category='HOVER_ACTIONS_TOOLBAR'
          data-track-name='INLINE_QUICK_REACTION'
          className='flex size-7 items-center justify-center rounded hover:bg-accent'
        >
          {renderEmoji(emoji, 'w-4 h-4', 'text-base')}
        </button>
      ))}
    </div>
  );
};

export default InlineQuickReactions;
