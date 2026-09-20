import React, { useRef } from 'react';
import EmojiPicker, { EmojiStyle, Theme } from 'emoji-picker-react';
import { EmojiPickerEmoji } from '../../../hooks/useCustomEmojis';
import { useTheme } from '../../../hooks/useTheme';
import { FrequentEmojiRow } from '../FrequentEmojiRow/FrequentEmojiRow';
import { parseCustomEmoji } from '../../../utils/customEmojiUtils';

interface AddReactionActionViewProps {
  handleEmojiSelect: (emoji: {
    emoji: string;
    isCustom: boolean;
    imageUrl?: string;
    names?: string[];
  }) => void;
  customEmojis: EmojiPickerEmoji[] | undefined;
}

const AddReactionActionView = ({ handleEmojiSelect, customEmojis }: AddReactionActionViewProps) => {
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

  // The row hands back a stored reaction token; split it back into the shape the
  // parent already serialises, so both paths produce the identical `custom:` string.
  const handleFrequentSelect = (emoji: string): void => {
    const custom = parseCustomEmoji(emoji);

    handleEmojiSelect(
      custom
        ? { emoji: custom.emojiId, isCustom: true, names: [custom.name] }
        : { emoji, isCustom: false },
    );
  };

  return (
    <div ref={containerRef} className='flex h-full flex-col' onTouchStart={handleTouchStart}>
      <FrequentEmojiRow onSelect={handleFrequentSelect} />
      <EmojiPicker
        emojiStyle={EmojiStyle.NATIVE}
        theme={emojiPickerTheme}
        style={{
          ['--epr-emoji-size' as string]: '22px',
          ['--epr-emoji-gap' as string]: '4px',
        }}
        onEmojiClick={emoji => {
          handleEmojiSelect({
            emoji: emoji.emoji,
            isCustom: emoji.isCustom,
            imageUrl: emoji.imageUrl,
            names: emoji.names,
          });
        }}
        customEmojis={customEmojis || []}
        previewConfig={{ showPreview: true }}
        autoFocusSearch={false}
        className='!w-full !min-h-0 !flex-1 !rounded-[inherit] ![--epr-picker-border-color:transparent]'
      />
    </div>
  );
};

export default AddReactionActionView;
