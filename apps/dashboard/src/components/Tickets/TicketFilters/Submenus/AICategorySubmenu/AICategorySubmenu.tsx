import { ReactElement, useState, useEffect, useMemo, useRef } from 'react';
import { Search, Check } from 'lucide-react';
import { usePlatform } from '../../../../../hooks/usePlatform';
import Input from '../../../../ui/Input/Input';

interface AICategorySubmenuProps {
  selectedCategories: string[];
  onChange: (categories: string[]) => void;
  availableCategories: string[];
}

export const AICategorySubmenu = ({
  selectedCategories,
  onChange,
  availableCategories,
}: AICategorySubmenuProps): ReactElement => {
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

  const filteredCategories = useMemo(() => {
    if (!availableCategories || availableCategories.length === 0) return [];

    let list = [...availableCategories];

    if (searchTerm.trim()) {
      const lower = searchTerm.toLowerCase();
      list = list.filter(category => category.toLowerCase().includes(lower));
    }

    const selectedSet = new Set(selectedCategories);
    return list.sort((a, b) => {
      const aSel = selectedSet.has(a) ? 1 : 0;
      const bSel = selectedSet.has(b) ? 1 : 0;
      return bSel - aSel;
    });
  }, [availableCategories, searchTerm, selectedCategories]);

  const handleToggle = (category: string): void => {
    const isSelected = selectedCategories.includes(category);
    if (isSelected) {
      onChange(selectedCategories.filter(c => c !== category));
    } else {
      onChange([...selectedCategories, category]);
    }
  };

  const allVisibleSelected =
    filteredCategories.length > 0 && filteredCategories.every(c => selectedCategories.includes(c));

  const handleSelectAllToggle = (): void => {
    if (allVisibleSelected) {
      onChange(selectedCategories.filter(c => !filteredCategories.includes(c)));
    } else {
      const merged = new Set([...selectedCategories, ...filteredCategories]);
      onChange([...merged]);
    }
  };

  return (
    <div className='w-80 border border-border flex flex-col rounded-lg shadow-lg bg-background overflow-hidden'>
      <div className='p-3 border-b sticky top-0 bg-background z-10'>
        <div className='relative'>
          <Search className='absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none' />
          <Input
            ref={searchInputRef}
            type='text'
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder='Search categories...'
            className='pl-9 h-9'
          />
        </div>
      </div>
      <div className='max-h-80 overflow-y-auto p-1' role='listbox' aria-multiselectable='true'>
        {availableCategories.length === 0 ? (
          <div className='p-8 text-center text-sm text-muted-foreground'>
            No categories available
          </div>
        ) : filteredCategories.length > 0 ? (
          <div className='space-y-0.5'>
            <button
              type='button'
              onClick={handleSelectAllToggle}
              className={`
                w-full flex items-center gap-2 px-3 py-2 rounded-md transition-all outline-none
                ${allVisibleSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-muted text-foreground'}
                focus-visible:ring-2 focus-visible:ring-ring border-b border-border/50
              `}
              data-track-category='Tickets'
              data-track-name='ToggleSelectAllAICategories'
            >
              <span className='flex-1 text-left text-sm font-medium text-primary'>
                {allVisibleSelected ? 'Deselect all' : 'Select all'}
              </span>
              {allVisibleSelected && (
                <Check className='w-4 h-4 text-primary shrink-0' aria-hidden='true' />
              )}
            </button>
            {filteredCategories.map(category => {
              const isSelected = selectedCategories.includes(category);

              return (
                <button
                  key={category}
                  onClick={() => handleToggle(category)}
                  type='button'
                  className={`
                    w-full flex items-center justify-between px-3 py-2 rounded-md transition-all outline-none
                    ${isSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-muted text-foreground'}
                    focus-visible:ring-2 focus-visible:ring-ring
                  `}
                  data-track-category='Tickets'
                  data-track-name='ToggleAICategoryFilter'
                  data-track-metadata={JSON.stringify({ category, selected: !isSelected })}
                  data-testid={`ai-category-filter-${category.toLowerCase()}`}
                >
                  <div className='flex items-center gap-2'>
                    <div className='w-2 h-2 rounded-full bg-blue-500' />
                    <span className='text-sm font-medium truncate'>{category}</span>
                  </div>
                  {isSelected && (
                    <Check className='w-4 h-4 text-primary shrink-0' aria-hidden='true' />
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          <div className='p-8 text-center text-sm text-muted-foreground'>No categories found</div>
        )}
      </div>
      {selectedCategories.length > 0 && (
        <div className='p-3 border-t bg-muted'>
          <div className='text-xs text-muted-foreground'>
            {selectedCategories.length} categor{selectedCategories.length !== 1 ? 'ies' : 'y'}{' '}
            selected
          </div>
        </div>
      )}
    </div>
  );
};
