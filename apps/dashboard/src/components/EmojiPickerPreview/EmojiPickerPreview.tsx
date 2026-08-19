import { useEffect, useState, type ReactNode, type RefObject } from 'react';
import { usePlatform } from '../../hooks/usePlatform';
import type { EmojiPickerEmoji } from '../../hooks/useCustomEmojis';
import {
  findUnicodeEmojiNameByUnified,
  preloadEmojiData,
  unifiedToEmoji,
} from '../../utils/emojiLookup';

interface EmojiPickerPreviewProps {
  containerRef: RefObject<HTMLElement | null>;
  customEmojis?: EmojiPickerEmoji[] | null | undefined;
  children?: ReactNode;
}

interface HoveredEmoji {
  char?: string;
  imgUrl?: string;
  name: string;
}

/**
 * Picker footer showing the hovered emoji's name and `:name:`, falling back to `children`
 * while nothing is hovered — the same row Slack swaps between a preview and its Add Emoji
 * button. Replaces the picker's own `previewConfig` footer, which renders a single line
 * with no way to customise the label.
 */
export function EmojiPickerPreview({
  containerRef,
  customEmojis,
  children,
}: EmojiPickerPreviewProps) {
  const { isMobile } = usePlatform();
  const [hovered, setHovered] = useState<HoveredEmoji | null>(null);

  useEffect(() => {
    preloadEmojiData();
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    // No hover on touch, so the footer stays on its children.
    if (isMobile || !container) return;

    const handleEnter = (event: Event) => {
      const target = event.target;
      const button = target instanceof Element ? target.closest('button.epr-emoji') : null;
      const unified = button instanceof HTMLElement ? button.dataset['unified'] : undefined;
      if (!unified) return;

      const custom = customEmojis?.find(emoji => emoji.id.toLowerCase() === unified);
      const name = custom ? custom.names[0] : findUnicodeEmojiNameByUnified(unified);
      if (!name) return;

      setHovered(
        custom ? { imgUrl: custom.imgUrl, name } : { char: unifiedToEmoji(unified), name },
      );
    };
    const handleLeave = () => setHovered(null);

    // Leaving the scrollable list clears the preview. Binding to the container instead would
    // never fire when the cursor moves from the grid onto this footer, which sits inside it.
    const list = container.querySelector('.epr-body') ?? container;

    container.addEventListener('mouseover', handleEnter, true);
    list.addEventListener('mouseleave', handleLeave);
    container.addEventListener('mouseleave', handleLeave);

    return () => {
      container.removeEventListener('mouseover', handleEnter, true);
      list.removeEventListener('mouseleave', handleLeave);
      container.removeEventListener('mouseleave', handleLeave);
    };
  }, [containerRef, customEmojis, isMobile]);

  const preview = isMobile ? null : hovered;
  if (!preview && !children) return null;

  return (
    <div className='flex h-14 shrink-0 items-center gap-3 border-t border-border px-3'>
      {preview ? (
        <>
          {preview.imgUrl ? (
            <img src={preview.imgUrl} alt='' className='size-7 shrink-0 object-contain' />
          ) : (
            <span className='shrink-0 text-[28px] leading-none'>{preview.char}</span>
          )}
          <div className='flex min-w-0 flex-col'>
            <span className='truncate text-sm font-medium text-foreground'>{preview.name}</span>
            <span className='truncate text-xs text-muted-foreground'>:{preview.name}:</span>
          </div>
        </>
      ) : (
        children
      )}
    </div>
  );
}
