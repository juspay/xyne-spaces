import React, { useRef, useState } from 'react';
import EmojiPicker, { EmojiStyle } from 'emoji-picker-react';
import { Drawer } from 'vaul';
import { parseReactionsMd } from '@xyne/shared';
import { MobileAddReactionDrawerProps } from './types';

const AddReactionDrawerMobile = ({
  messageId,
  user,
  reactionsMd,
  toggleReaction,
  customEmojis,
}: MobileAddReactionDrawerProps) => {
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const emojiPickerContainerRef = useRef<HTMLDivElement>(null);
  const reactionsData = parseReactionsMd(reactionsMd);

  // Blur search input on touch outside to dismiss mobile keyboard.
  const handleEmojiPickerTouchStart = (e: React.TouchEvent) => {
    const target = e.target as HTMLElement;
    if (!target.closest('.epr-search-container')) {
      const searchInput = emojiPickerContainerRef.current?.querySelector(
        '.epr-search-container input',
      ) as HTMLInputElement;
      if (searchInput && document.activeElement === searchInput) {
        searchInput.blur();
      }
    }
  };

  return (
    <Drawer.Root open={emojiPickerOpen} onOpenChange={setEmojiPickerOpen}>
      <Drawer.Trigger asChild>
        <button
          type='button'
          className='inline-flex items-center justify-center w-6 h-6 rounded-full text-muted-foreground bg-muted hover:bg-accent cursor-pointer transition-all duration-150'
          onClick={e => e.stopPropagation()}
          data-track-category='MESSAGE'
          data-track-name='OPEN_ADD_REACTION_DRAWER'
          data-track-metadata={JSON.stringify({ messageId })}
        >
          <span className='text-sm font-medium'>+</span>
        </button>
      </Drawer.Trigger>
      <Drawer.Portal>
        <Drawer.Overlay
          className='fixed inset-0 z-[100] bg-black/30'
          onClick={() => setEmojiPickerOpen(false)}
          data-track-category='MESSAGE'
          data-track-name='CLOSE_ADD_REACTION_DRAWER_BACKDROP'
          onTouchStart={e => e.stopPropagation()}
          onTouchMove={e => e.stopPropagation()}
          onTouchEnd={e => e.stopPropagation()}
          onTouchCancel={e => e.stopPropagation()}
        />
        <Drawer.Content
          className='fixed bottom-0 z-[110] w-full rounded-t-[20px] bg-background p-2 overflow-hidden h-[75dvh]'
          onTouchStart={e => e.stopPropagation()}
          onTouchMove={e => e.stopPropagation()}
          onTouchEnd={e => e.stopPropagation()}
          onTouchCancel={e => e.stopPropagation()}
        >
          <Drawer.Handle className='mt-2 !h-2 !w-[100px] !bg-gray-300 !dark:bg-gray-600' />
          <div
            ref={emojiPickerContainerRef}
            className='h-full'
            onTouchStart={handleEmojiPickerTouchStart}
          >
            <EmojiPicker
              emojiStyle={EmojiStyle.NATIVE}
              style={{
                ['--epr-emoji-size' as string]: '22px',
                ['--epr-emoji-gap' as string]: '4px',
              }}
              onEmojiClick={emoji => {
                const emojiName = emoji.isCustom
                  ? `custom:${emoji.emoji}:${emoji.names[0] || 'custom'}`
                  : emoji.emoji;
                const hasReacted = !!user && (reactionsData[emojiName] || []).includes(user.id);

                toggleReaction({
                  messageId,
                  emoji: emojiName,
                  hasReacted,
                });
                setEmojiPickerOpen(false);
              }}
              customEmojis={customEmojis || []}
              previewConfig={{ showPreview: true }}
              autoFocusSearch={false}
              className='!w-full !h-full !rounded-[inherit] ![--epr-picker-border-color:transparent]'
            />
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
};

export default AddReactionDrawerMobile;
