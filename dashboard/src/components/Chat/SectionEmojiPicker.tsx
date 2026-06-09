import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Smile } from 'lucide-react';
import EmojiPicker, { EmojiStyle, Theme } from 'emoji-picker-react';
import { useTheme } from '../../hooks/useTheme';

interface SectionEmojiPickerProps {
  value: string;
  onChange: (emoji: string) => void;
  trackName: string;
}

// Absolute, not a portal — so it scrolls inside the modal and isn't offset by the dialog transform.
export const SectionEmojiPicker = ({
  value,
  onChange,
  trackName,
}: SectionEmojiPickerProps): ReactElement => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();
  const pickerTheme = theme === 'midnight' ? Theme.DARK : Theme.LIGHT;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return (): void => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  return (
    <div ref={ref} className='relative shrink-0'>
      <button
        type='button'
        onClick={() => setOpen(o => !o)}
        aria-label='Section emoji'
        data-track-category='CHAT_SIDEBAR'
        data-track-name={trackName}
        className='flex w-7 items-center justify-center rounded text-base text-muted-foreground outline-none hover:text-foreground'
      >
        {value ? value : <Smile className='size-4' />}
      </button>
      {open && (
        <div className='absolute left-0 top-full z-[60] mt-1 overflow-hidden rounded-lg shadow-lg'>
          <EmojiPicker
            emojiStyle={EmojiStyle.NATIVE}
            theme={pickerTheme}
            onEmojiClick={emojiData => {
              onChange(emojiData.emoji);
              setOpen(false);
            }}
            width={320}
            height={400}
            lazyLoadEmojis
            searchPlaceHolder='Search emoji...'
            previewConfig={{ showPreview: false }}
          />
        </div>
      )}
    </div>
  );
};

export default SectionEmojiPicker;
