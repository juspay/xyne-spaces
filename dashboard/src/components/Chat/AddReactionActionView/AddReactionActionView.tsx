import React, { useRef } from 'react';
import EmojiPicker, { EmojiStyle } from 'emoji-picker-react';
import { EmojiPickerEmoji } from '../../../hooks/useCustomEmojis';

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
    <div ref={containerRef} className='h-full' onTouchStart={handleTouchStart}>
      <EmojiPicker
        emojiStyle={EmojiStyle.NATIVE}
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
        previewConfig={{ showPreview: false }}
        autoFocusSearch={false}
        className='!w-full !h-full !rounded-[inherit] ![--epr-picker-border-color:transparent]'
      />
    </div>
  );
};

export default AddReactionActionView;
