import type { ReactElement } from 'react';
import { useFrequentEmojis } from '../../../hooks/useFrequentEmojis';
import { getEmojiDisplayName, renderEmoji } from '../../../utils/customEmojiUtils';

interface FrequentEmojiRowProps {
  /** Receives the stored reaction token — unicode char, or `custom:<emojiId>:<name>`. */
  onSelect: (emoji: string) => void;
  /** How many to show. Defaults to the shared display limit. */
  limit?: number;
  className?: string;
}

/**
 * "Frequently Used" strip rendered above an emoji picker, so the emojis a user actually
 * reacts with are one click away instead of a search away. Renders nothing until the user
 * has reacted at least once, which keeps the picker unchanged for new users.
 */
export const FrequentEmojiRow = ({
  onSelect,
  limit,
  className = '',
}: FrequentEmojiRowProps): ReactElement | null => {
  const frequentEmojis = useFrequentEmojis(limit);

  if (frequentEmojis.length === 0) return null;

  return (
    <div
      className={`flex flex-col gap-1 border-b border-border px-3 py-2 ${className}`}
      data-testid='frequent-emoji-row'
    >
      <span className='text-[11px] font-medium uppercase tracking-wide text-muted-foreground'>
        Frequently Used
      </span>
      <div className='flex flex-wrap items-center gap-1'>
        {frequentEmojis.map(emoji => (
          <button
            key={emoji}
            type='button'
            onClick={() => onSelect(emoji)}
            title={getEmojiDisplayName(emoji)}
            aria-label={getEmojiDisplayName(emoji)}
            data-track-category='MESSAGE'
            data-track-name='FREQUENT_EMOJI_SELECTED'
            className='flex size-7 items-center justify-center rounded hover:bg-accent'
          >
            {renderEmoji(emoji, 'w-5 h-5', 'text-lg')}
          </button>
        ))}
      </div>
    </div>
  );
};

export default FrequentEmojiRow;
