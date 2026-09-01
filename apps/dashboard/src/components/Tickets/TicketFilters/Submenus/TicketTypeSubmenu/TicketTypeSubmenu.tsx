import { ReactElement, useState, useEffect, useMemo, useRef } from 'react';
import { Search, Check } from 'lucide-react';
import Input from '../../../../ui/Input/Input';
import { usePlatform } from '../../../../../hooks/usePlatform';

interface TicketTypeSubmenuProps {
  selectedTypes: string[];
  onChange: (types: string[]) => void;
  availableTypes: string[];
  className?: string;
}

export const TicketTypeSubmenu = ({
  selectedTypes,
  onChange,
  availableTypes = [],
  className = '',
}: TicketTypeSubmenuProps): ReactElement => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const { isMobile } = usePlatform();

  useEffect(() => {
    if (isMobile) return;
    const rafId = requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
    return () => cancelAnimationFrame(rafId);
  }, [isMobile]);

  useEffect(() => {
    const timer = setTimeout(() => setSearchTerm(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const finalResults = useMemo(() => {
    if (!availableTypes || availableTypes.length === 0) return [];

    let list = [...availableTypes];

    if (searchTerm.trim()) {
      const lower = searchTerm.toLowerCase();
      list = list.filter(type => type.toLowerCase().includes(lower));
    }

    const selectedSet = new Set(selectedTypes);
    return list
      .sort((a, b) => {
        const aSel = selectedSet.has(a) ? 1 : 0;
        const bSel = selectedSet.has(b) ? 1 : 0;
        return bSel - aSel;
      })
      .slice(0, 50);
  }, [availableTypes, searchTerm, selectedTypes]);

  const handleTypeToggle = (type: string) => {
    const isSelected = selectedTypes.includes(type);
    onChange(isSelected ? selectedTypes.filter(t => t !== type) : [...selectedTypes, type]);
  };

  const visibleTypeNames = finalResults;
  const allVisibleSelected =
    visibleTypeNames.length > 0 && visibleTypeNames.every(t => selectedTypes.includes(t));

  const handleSelectAllToggle = (): void => {
    if (allVisibleSelected) {
      onChange(selectedTypes.filter(t => !visibleTypeNames.includes(t)));
    } else {
      const merged = new Set([...selectedTypes, ...visibleTypeNames]);
      onChange([...merged]);
    }
  };

  return (
    <div
      className={`w-80 border border-border flex flex-col rounded-lg shadow-lg bg-background overflow-hidden ${className}`}
    >
      <div className='p-3 border-b sticky top-0 bg-background z-10'>
        <div className='relative'>
          <Search className='absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none' />
          <Input
            ref={searchInputRef}
            type='text'
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder='Search types...'
            className='pl-9 h-9'
          />
        </div>
      </div>
      <div className='max-h-80 overflow-y-auto p-1' role='listbox' aria-multiselectable='true'>
        {!availableTypes || availableTypes.length === 0 ? (
          <div className='p-8 text-center text-sm text-muted-foreground'>No types available</div>
        ) : finalResults.length > 0 ? (
          <div className='space-y-0.5'>
            <button
              type='button'
              onClick={handleSelectAllToggle}
              className={`
                w-full flex items-center gap-3 px-3 py-2 rounded-md transition-all outline-none
                ${allVisibleSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-muted text-foreground'}
                focus-visible:ring-2 focus-visible:ring-ring border-b border-border/50
              `}
              data-track-category='TICKETS'
              data-track-name='ToggleSelectAllTypes'
            >
              <span className='flex-1 text-left text-sm font-medium text-primary'>
                {allVisibleSelected ? 'Deselect all' : 'Select all'}
              </span>
              {allVisibleSelected && (
                <Check className='w-4 h-4 text-primary shrink-0' aria-hidden='true' />
              )}
            </button>
            {finalResults.map(type => {
              const isSelected = selectedTypes.includes(type);
              return (
                <button
                  key={type}
                  type='button'
                  onClick={() => handleTypeToggle(type)}
                  className={`
                    w-full flex items-center gap-3 px-3 py-2 rounded-md transition-all outline-none
                    ${isSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-muted text-foreground'}
                    focus-visible:ring-2 focus-visible:ring-ring
                  `}
                  data-track-category='TICKETS'
                  data-track-name='ToggleTicketTypeFilter'
                  data-track-metadata={JSON.stringify({ type, selected: !isSelected })}
                >
                  <span className='flex-1 text-left text-sm truncate'>{type}</span>
                  {isSelected && (
                    <Check className='w-4 h-4 text-primary shrink-0' aria-hidden='true' />
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          <div className='p-8 text-center text-sm text-muted-foreground'>No types found</div>
        )}
      </div>
      {selectedTypes.length > 0 && (
        <div className='p-3 border-t bg-muted'>
          <div className='text-xs text-muted-foreground'>
            {selectedTypes.length} type{selectedTypes.length !== 1 ? 's' : ''} selected
          </div>
        </div>
      )}
    </div>
  );
};
