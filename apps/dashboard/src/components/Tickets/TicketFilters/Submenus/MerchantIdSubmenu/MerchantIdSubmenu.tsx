import { ReactElement, useState, useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SearchDefault as Search, CheckTickSingle as Check, Spinner as Loader2 } from '@xyne/icons';
import Input from '../../../../ui/Input/Input';
import { usePlatform } from '../../../../../hooks/usePlatform';
import { getMerchants } from '../../../../../services/ticketService';

interface MerchantIdSubmenuProps {
  selectedMerchantIds: string[];
  onChange: (merchantIds: string[]) => void;
  className?: string;
}

// The merchant list is small and static enough to fetch once when the submenu opens;
// typing then searches that list locally. An id that is not in the list can still be
// added by hand (Enter), since the filter matches ticket.merchantId exactly and
// tickets can carry ids that never reached the merchants table.
export const MerchantIdSubmenu = ({
  selectedMerchantIds,
  onChange,
  className = '',
}: MerchantIdSubmenuProps): ReactElement => {
  const [searchQuery, setSearchQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const { isMobile } = usePlatform();

  // Refetched every time the submenu opens: merchants appear as tickets are created,
  // so a cached list goes stale quickly. The list is shown only once the response is in
  // (isFetching, not isLoading) — a cached page of a few thousand rows would otherwise
  // read as current while the real one is still loading.
  const { data: merchants, isFetching } = useQuery({
    queryKey: ['merchants'],
    queryFn: getMerchants,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  useEffect(() => {
    if (isMobile) return;
    const rafId = requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => cancelAnimationFrame(rafId);
  }, [isMobile]);

  // Selected ids first, then the rest of the fetched list; both filtered by the query.
  const visibleIds = useMemo(() => {
    const all = new Set<string>(selectedMerchantIds);
    (merchants ?? []).forEach(merchant => all.add(merchant.mid));

    const query = searchQuery.trim().toLowerCase();
    const matches = [...all].filter(mid => !query || mid.toLowerCase().includes(query));

    const selected = new Set(selectedMerchantIds);
    return matches
      .sort((a, b) => {
        const bySelected = Number(selected.has(b)) - Number(selected.has(a));
        return bySelected !== 0 ? bySelected : a.localeCompare(b);
      })
      .slice(0, 100);
  }, [merchants, searchQuery, selectedMerchantIds]);

  const typedId = searchQuery.trim();
  const canAddTyped = typedId.length > 0 && !visibleIds.includes(typedId);

  const handleToggle = (merchantId: string): void => {
    onChange(
      selectedMerchantIds.includes(merchantId)
        ? selectedMerchantIds.filter(id => id !== merchantId)
        : [...selectedMerchantIds, merchantId],
    );
  };

  const addTypedId = (): void => {
    if (!canAddTyped) return;
    onChange([...new Set([...selectedMerchantIds, typedId])]);
    setSearchQuery('');
  };

  return (
    <div
      className={`w-80 border border-border flex flex-col rounded-lg shadow-lg bg-background overflow-hidden ${className}`}
    >
      <div className='p-3 border-b sticky top-0 bg-background z-10'>
        <div className='relative'>
          <Search className='absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none' />
          <Input
            ref={inputRef}
            type='text'
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addTypedId();
              }
            }}
            placeholder='Search merchant IDs...'
            className='pl-9 h-9'
          />
        </div>
      </div>
      <div className='max-h-80 overflow-y-auto p-1' role='listbox' aria-multiselectable='true'>
        {isFetching ? (
          <div
            className='flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground'
            role='status'
            aria-live='polite'
          >
            <Loader2 className='w-4 h-4 animate-spin' aria-hidden='true' />
            Loading merchants...
          </div>
        ) : visibleIds.length === 0 && !canAddTyped ? (
          <div className='p-8 text-center text-sm text-muted-foreground'>No merchants found</div>
        ) : (
          <div className='space-y-0.5'>
            {canAddTyped && (
              <button
                type='button'
                onClick={addTypedId}
                className='w-full flex items-center gap-3 px-3 py-2 rounded-md transition-all outline-none hover:bg-muted text-foreground focus-visible:ring-2 focus-visible:ring-ring border-b border-border/50'
                data-track-category='Tickets'
                data-track-name='AddCustomMerchantIdFilter'
              >
                <span className='flex-1 text-left text-sm truncate'>
                  Use &ldquo;{typedId}&rdquo;
                </span>
              </button>
            )}
            {visibleIds.map(merchantId => {
              const isSelected = selectedMerchantIds.includes(merchantId);
              return (
                <button
                  key={merchantId}
                  type='button'
                  onClick={() => handleToggle(merchantId)}
                  className={`
                    w-full flex items-center gap-3 px-3 py-2 rounded-md transition-all outline-none
                    ${isSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-muted text-foreground'}
                    focus-visible:ring-2 focus-visible:ring-ring
                  `}
                  data-track-category='Tickets'
                  data-track-name='ToggleMerchantIdFilter'
                  data-track-metadata={JSON.stringify({ merchantId, selected: !isSelected })}
                >
                  <span className='flex-1 text-left text-sm truncate'>{merchantId}</span>
                  {isSelected && (
                    <Check className='w-4 h-4 text-primary shrink-0' aria-hidden='true' />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
      {selectedMerchantIds.length > 0 && (
        <div className='p-3 border-t bg-muted flex items-center justify-between'>
          <div className='text-xs text-muted-foreground'>
            {selectedMerchantIds.length} merchant ID{selectedMerchantIds.length !== 1 ? 's' : ''}{' '}
            selected
          </div>
          <button
            type='button'
            onClick={() => onChange([])}
            className='text-xs text-primary hover:underline'
            data-track-category='Tickets'
            data-track-name='ClearMerchantIdFilter'
          >
            Clear
          </button>
        </div>
      )}
    </div>
  );
};
