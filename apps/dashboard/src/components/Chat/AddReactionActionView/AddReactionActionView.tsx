import React, { useRef } from 'react';
import EmojiPicker, { EmojiStyle, Theme } from 'emoji-picker-react';
import { EmojiPickerEmoji } from '../../../hooks/useCustomEmojis';
import { useTheme } from '../../../hooks/useTheme';
import { FrequentEmojiRow } from '../FrequentEmojis/FrequentEmojiRow';
import { toEmojiToken } from '../../../utils/customEmojiUtils';
import { EMOJI_PICKER_CATEGORIES } from '../../../utils/emojiPickerCategories';

interface AddReactionActionViewProps {
  /** Receives the stored reaction token — unicode char, or `custom:<emojiId>:<name>`. */
  handleEmojiSelect: (emoji: string) => void;
  customEmojis: EmojiPickerEmoji[] | undefined;
  /** Message the picker reacts to — carried on the analytics event. */
  messageId?: string | undefined;
}

const AddReactionActionView = ({
  handleEmojiSelect,
  customEmojis,
  messageId,
}: AddReactionActionViewProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();
  const emojiPickerTheme = theme === 'midnight' ? Theme.DARK : Theme.LIGHT;

  // Blur search input on touch outside to dismiss mobile keyboard.
  const handleTouchStart = (e: React.TouchEvent) => {
    const target = e.target as HTMLElement;
    if (!target.closest('.epr-search-container')) {
      const searchInput = containerRef.current?.querySelector(
        '.epr-search-container input',
      ) as HTMLInputElement;
      if (searchInput && document.activeElement === searchInput) {
        searchInput.blur();
      }
    }
  };

  return (
    <div ref={containerRef} className='flex h-full flex-col' onTouchStart={handleTouchStart}>
      <FrequentEmojiRow onSelect={handleEmojiSelect} messageId={messageId} />
      <EmojiPicker
        emojiStyle={EmojiStyle.NATIVE}
        theme={emojiPickerTheme}
        style={{
          ['--epr-emoji-size' as string]: '22px',
          ['--epr-emoji-gap' as string]: '4px',
        }}
        onEmojiClick={emoji => handleEmojiSelect(toEmojiToken(emoji))}
        categories={EMOJI_PICKER_CATEGORIES}
        customEmojis={customEmojis || []}
        previewConfig={{ showPreview: true }}
        autoFocusSearch={false}
        className='!w-full !min-h-0 !flex-1 !rounded-[inherit] ![--epr-picker-border-color:transparent]'
      />
    </div>
  );
};

export default AddReactionActionView;
