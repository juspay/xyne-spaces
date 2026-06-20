import React, { useEffect, useRef } from 'react';
import { cn } from '../../../utils/classNames';
import { Search, X } from 'lucide-react';

interface SearchFieldV2Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
  ariaLabel?: string;
}

export const SearchFieldV2: React.FC<SearchFieldV2Props> = ({
  value,
  onChange,
  placeholder = 'Search',
  autoFocus,
  className,
  ariaLabel,
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect((): void => {
    if (autoFocus) {
      inputRef.current?.focus();
    }
  }, [autoFocus]);

  return (
    <div className={cn('relative flex items-center', className)}>
      <Search
        className='pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-muted-foreground'
        aria-hidden
        strokeWidth={1.75}
      />
      <input
        ref={inputRef}
        type='search'
        value={value}
        onChange={e => {
          onChange(e.target.value);
        }}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        className='h-8 w-full rounded-full border border-border bg-secondary pl-7 pr-7 text-[12.5px] text-foreground placeholder:text-muted-foreground focus:border-ring focus:bg-background focus:outline-none [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden'
        data-track-category='knowledge-base'
        data-track-name='search-files'
      />
      {value !== '' ? (
        <button
          type='button'
          aria-label='Clear search'
          onClick={() => {
            onChange('');
          }}
          className='absolute right-2 grid h-4 w-4 place-items-center rounded-full text-muted-foreground transition hover:text-foreground'
          data-track-category='knowledge-base'
          data-track-name='clear-search'
        >
          <X className='h-3 w-3' aria-hidden strokeWidth={2} />
        </button>
      ) : null}
    </div>
  );
};
