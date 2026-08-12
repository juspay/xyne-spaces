import type { ReactElement } from 'react';
import { SearchDefault } from '@xyne/icons';
import { cn } from '@/utils/classNames';

export function AdminSearchField({
  value,
  onChange,
  placeholder,
  ariaLabel,
  trackName,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  ariaLabel: string;
  trackName: string;
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
        data-track-category='Claw Admin'
        data-track-name={trackName}
        className='h-7 w-full border-0 bg-transparent p-0 text-sm text-foreground outline-none placeholder:text-muted-foreground'
      />
    </div>
  );
}
