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

const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 300;

// Merchant ids are searched server-side (`q` + `limit`): the merchants table grows a row
// per distinct merchantId ever seen on a ticket and is never pruned, so it must not be
// downloaded whole. An id that is not in the list can still be added by hand (Enter),
// since the filter matches ticket.merchantId exactly and tickets can carry ids that never
// reached the merchants table.
export const MerchantIdSubmenu = ({
  selectedMerchantIds,
  onChange,
  className = '',
}: MerchantIdSubmenuProps): ReactElement => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const { isMobile } = usePlatform();

  useEffect(() => {
    const timer = setTimeout(() => setSearchTerm(searchQuery), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Refetched per open (the popover unmounts on close) so newly created merchants show up.
  // One bounded page, not the table.
  const { data, isFetching } = useQuery({
    queryKey: ['merchants', searchTerm],
    queryFn: () => getMerchants({ ...(searchTerm ? { q: searchTerm } : {}), limit: PAGE_SIZE }),
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

  // Selected ids first (they must stay visible even when the server page omits them),
  // then the server's own `mid ASC` order — so no client-side sort is needed.
  const { visibleIds, selectedSet } = useMemo(() => {
    const selected = new Set(selectedMerchantIds);
    const query = searchTerm.trim().toLowerCase();
    const out = selectedMerchantIds.filter(mid => !query || mid.toLowerCase().includes(query));
    for (const merchant of data?.merchants ?? []) {
      if (selected.has(merchant.mid)) continue;
      out.push(merchant.mid);
    }
    return { visibleIds: out, selectedSet: selected };
  }, [data, searchTerm, selectedMerchantIds]);

  const typedId = searchQuery.trim();
  const canAddTyped = typedId.length > 0 && !visibleIds.includes(typedId);

  const handleToggle = (merchantId: string): void => {
    onChange(
      selectedSet.has(merchantId)
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
              const isSelected = selectedSet.has(merchantId);
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
            {data?.hasMore && (
              <div className='px-3 py-2 text-xs text-muted-foreground'>
                Showing first {PAGE_SIZE} — type to narrow the search.
              </div>
            )}
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
