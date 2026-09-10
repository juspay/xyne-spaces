import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { Smile } from 'lucide-react';
import EmojiPicker, { EmojiStyle, Theme } from 'emoji-picker-react';
import { useTheme } from '../../hooks/useTheme';
import { useCustomEmojis } from '../../hooks/useCustomEmojis';
import { renderEmoji } from '../../utils/customEmojiUtils';
import { cn } from '../../utils/classNames';

interface SectionEmojiPickerProps {
  value: string | null;
  onChange: (emoji: string) => void;
  trackName: string;
  trackCategory?: string;
  ariaLabel?: string;
  disabled?: boolean;
  triggerClassName?: string;
  iconClassName?: string;
  fallbackIcon?: ReactNode;
  allowCustomEmojis?: boolean;
}

interface SectionEmojiTriggerArgs {
  value: string | null;
  allowCustomEmojis: boolean;
  iconClassName: string | undefined;
  fallbackIcon: ReactNode;
}

const renderSectionEmojiTrigger = ({
  value,
  allowCustomEmojis,
  iconClassName,
  fallbackIcon,
}: SectionEmojiTriggerArgs): ReactNode => {
  if (!value) {
    return fallbackIcon || <Smile className='size-4' />;
  }

  if (allowCustomEmojis) {
    return renderEmoji(value, undefined, iconClassName);
  }

  return <span className={cn('leading-none', iconClassName)}>{value}</span>;
};

// Absolute, not a portal — so it scrolls inside the modal and isn't offset by the dialog transform.
export const SectionEmojiPicker = ({
  value,
  onChange,
  trackName,
  trackCategory = 'CHAT_SIDEBAR',
  ariaLabel = 'Section emoji',
  disabled = false,
  triggerClassName,
  iconClassName,
  fallbackIcon,
  allowCustomEmojis = true,
}: SectionEmojiPickerProps): ReactElement => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();
  const { data: customEmojis } = useCustomEmojis();
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
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        aria-label={ariaLabel}
        data-track-category={trackCategory}
        data-track-name={trackName}
        className={cn(
          'flex w-7 items-center justify-center rounded text-base text-muted-foreground outline-none hover:text-foreground disabled:cursor-default disabled:opacity-40',
          value && 'text-foreground',
          triggerClassName,
        )}
      >
        {renderSectionEmojiTrigger({ value, allowCustomEmojis, iconClassName, fallbackIcon })}
      </button>
      {open && (
        <div className='absolute left-0 top-full z-[60] mt-1 overflow-hidden rounded-lg shadow-lg'>
          <EmojiPicker
            emojiStyle={EmojiStyle.NATIVE}
            theme={pickerTheme}
            customEmojis={allowCustomEmojis ? customEmojis || [] : []}
            onEmojiClick={emojiData => {
              if (emojiData.isCustom && !allowCustomEmojis) return;
              onChange(
                emojiData.isCustom
                  ? `custom:${emojiData.emoji}:${emojiData.names[0] || emojiData.emoji}`
                  : emojiData.emoji,
              );
              setOpen(false);
            }}
            width={320}
            height={400}
            lazyLoadEmojis
            searchPlaceHolder='Search emoji...'
            previewConfig={{ showPreview: true }}
          />
        </div>
      )}
    </div>
  );
};
