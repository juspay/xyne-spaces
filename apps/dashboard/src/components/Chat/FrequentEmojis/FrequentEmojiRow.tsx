import type { ReactElement } from 'react';
import { useFrequentEmojis } from '../../../hooks/useFrequentEmojis';
import { getEmojiDisplayName, renderEmoji } from '../../../utils/customEmojiUtils';
import { cn } from '../../../utils/classNames';

interface FrequentEmojiRowProps {
  /** Receives the stored reaction token — unicode char, or `custom:<emojiId>:<name>`. */
  onSelect: (emoji: string) => void;
  /** Message the row reacts to — carried on the analytics event. */
  messageId?: string | undefined;
}

/**
 * "Frequently Used" strip rendered above an emoji picker, so the emojis a user actually
 * reacts with are one click away instead of a search away. Renders nothing until the user
 * has reacted at least once, which keeps the picker unchanged for new users.
 */
export const FrequentEmojiRow = ({
  onSelect,
  messageId,
}: FrequentEmojiRowProps): ReactElement | null => {
  const frequentEmojis = useFrequentEmojis();

  if (frequentEmojis.length === 0) return null;

  const trackMetadata = messageId ? JSON.stringify({ messageId }) : undefined;

  return (
    <div
      className={cn('flex flex-col gap-1 border-b border-border px-3 py-2')}
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
            data-track-category='HOVER_ACTIONS_TOOLBAR'
            data-track-name='FREQUENT_EMOJI_SELECTED'
            data-track-metadata={trackMetadata}
            className={cn(
              'flex size-7 items-center justify-center rounded',
              'hover:bg-accent focus-visible:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            )}
          >
            {renderEmoji(emoji, 'w-5 h-5', 'text-lg')}
          </button>
        ))}
      </div>
    </div>
  );
};

export default FrequentEmojiRow;
