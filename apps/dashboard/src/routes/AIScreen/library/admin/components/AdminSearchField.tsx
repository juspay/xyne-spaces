import type { ReactElement } from 'react';
import { MultipleCrossCancelDefault, SearchDefault } from '@xyne/icons';
import { cn } from '@/utils/classNames';

export function AdminSearchField({
  value,
  onChange,
  placeholder,
  ariaLabel,
  trackName,
  trackCategory = 'Claw Admin',
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  ariaLabel: string;
  trackName: string;
  trackCategory?: string;
  className?: string;
}): ReactElement {
  return (
    <div
      className={cn(
        'flex min-w-[12rem] items-center gap-2 border-b border-border pb-1 pt-1 focus-within:border-foreground',
        className,
      )}
    >
      <SearchDefault className='size-4 shrink-0 text-muted-foreground' aria-hidden />
      <input
        type='text'
        value={value}
        onChange={event => onChange(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Escape') onChange('');
        }}
        placeholder={placeholder}
        aria-label={ariaLabel}
        name='admin-search'
        autoComplete='off'
        spellCheck={false}
        data-1p-ignore
        data-lpignore='true'
        data-bwignore='true'
        data-track-category={trackCategory}
        data-track-name={trackName}
        className='h-7 w-full border-0 bg-transparent p-0 text-sm text-foreground outline-none placeholder:text-muted-foreground'
      />
      {value && (
        <button
          type='button'
          onClick={() => onChange('')}
          aria-label={`Clear ${ariaLabel.toLowerCase()}`}
          data-track-category={trackCategory}
          data-track-name={`${trackName}: clear`}
          className='flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground'
        >
          <MultipleCrossCancelDefault className='size-3.5' aria-hidden />
        </button>
      )}
    </div>
  );
}
