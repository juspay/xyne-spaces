import { ReactElement, useEffect, useRef } from 'react';
import { SearchDefault as Search } from '@xyne/icons';
import { cn } from '../../../utils/classNames';
import { TURN_OFF_EXACT_SEARCH, TURN_ON_EXACT_SEARCH } from '../../../utils/exactSearch';
import { Tooltip } from '../../ui/Tooltip';

interface TicketSearchInputProps {
  value: string;
  onChange: (value: string) => void;
  isExactSearch: boolean;
  onExactSearchChange: (exact: boolean) => void;
  className?: string;
}

export const TicketSearchInput = ({
  value,
  onChange,
  isExactSearch,
  onExactSearchChange,
  className = 'min-w-[96px] max-w-[220px] flex-[0_1_220px]',
}: TicketSearchInputProps): ReactElement => {
  const searchRef = useRef<HTMLInputElement>(null);
  const pendingCaretRef = useRef(false);
  useEffect(() => {
    if (!pendingCaretRef.current || value !== '""') return;
    pendingCaretRef.current = false;
    searchRef.current?.focus();
    searchRef.current?.setSelectionRange(1, 1);
  }, [value]);

  return (
    <div
      className={cn(
        'flex h-[30px] items-center gap-2 rounded-lg border px-2.5 text-muted-foreground/80 transition-colors focus-within:border-muted-foreground/40 hover:border-muted-foreground/40',
        value ? 'border-muted-foreground/40' : 'border-border',
        className,
      )}
    >
      <Search className='size-[14px] shrink-0' />
      <input
        ref={searchRef}
        type='text'
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder='Search'
        aria-label='Search Tickets'
        className='min-w-0 flex-1 bg-transparent text-[12.5px] text-foreground outline-none placeholder:text-muted-foreground/60'
        data-track-category='Tickets'
        data-track-name='SearchTickets'
      />
      {value && (
        <button
          type='button'
          onClick={() => onChange('')}
          aria-label='Clear search'
          data-track-category='Tickets'
          data-track-name='ClearTicketSearch'
          className='text-[13px] leading-none text-muted-foreground/60 hover:text-foreground'
        >
          ×
        </button>
      )}
      <Tooltip content={isExactSearch ? TURN_OFF_EXACT_SEARCH : TURN_ON_EXACT_SEARCH}>
        <button
          type='button'
          onClick={() => {
            const next = !isExactSearch;
            pendingCaretRef.current = next && !value.trim();
            onExactSearchChange(next);
            searchRef.current?.focus();
          }}
          aria-pressed={isExactSearch}
          aria-label={isExactSearch ? TURN_OFF_EXACT_SEARCH : TURN_ON_EXACT_SEARCH}
          className={cn(
            'shrink-0 rounded px-1 text-[11px] font-semibold leading-[18px] transition-colors',
            isExactSearch
              ? 'bg-[var(--desk-accent-badge-bg)] text-[var(--ticket-accent)]'
              : 'text-muted-foreground/60 hover:text-foreground',
          )}
          data-track-category='Tickets'
          data-track-name='ToggleExactTicketSearch'
          data-track-metadata={JSON.stringify({ exact: !isExactSearch })}
        >
          &quot;ab&quot;
        </button>
      </Tooltip>
    </div>
  );
};
