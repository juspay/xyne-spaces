import { ReactElement, useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { SearchDefault as Search, CheckTickSingle as Check, Tag } from '@xyne/icons';
import Input from '../../../../ui/Input/Input';

interface TagsSubmenuProps {
  selectedTags: string[];
  onChange: (tags: string[]) => void;
  availableTags?: string[];
  className?: string;
  /** Callback to load more tags */
  onLoadMore?: (() => void) | undefined;
  /** Whether there are more tags to load */
  hasMore?: boolean | undefined;
}

export const TagsSubmenu = ({
  selectedTags,
  onChange,
  availableTags = [],
  className = '',
  onLoadMore,
  hasMore = false,
}: TagsSubmenuProps): ReactElement => {
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listContainerRef = useRef<HTMLDivElement>(null);

  // Focus search input when component mounts
  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  // Scroll detection for infinite loading (only when not searching)
  const handleScroll = useCallback(() => {
    if (!listContainerRef.current || !onLoadMore || !hasMore || searchQuery.trim()) return;

    const { scrollTop, scrollHeight, clientHeight } = listContainerRef.current;
    // Load more when scrolled to within 50px of bottom
    if (scrollHeight - scrollTop - clientHeight < 50) {
      onLoadMore();
    }
  }, [onLoadMore, hasMore, searchQuery]);

  useEffect(() => {
    const container = listContainerRef.current;
    if (!container) return;

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  const finalResults = useMemo(() => {
    if (!availableTags || availableTags.length === 0) {
      return [];
    }

    // Filter by search query if present
    let filtered = availableTags;
    if (searchQuery.trim()) {
      const lower = searchQuery.toLowerCase();
      filtered = availableTags.filter(tag => tag.toLowerCase().includes(lower));
    }

    // Sort selected items to top
    const selectedSet = new Set(selectedTags);
    return [...filtered].sort((a, b) => {
      const aSel = selectedSet.has(a) ? 1 : 0;
      const bSel = selectedSet.has(b) ? 1 : 0;
      return bSel - aSel;
    });
  }, [availableTags, searchQuery, selectedTags]);

  const handleTagToggle = (tag: string) => {
    const isSelected = selectedTags.includes(tag);
    onChange(isSelected ? selectedTags.filter(t => t !== tag) : [...selectedTags, tag]);
  };

  const visibleTagNames = finalResults.map(t => t);
  const allVisibleSelected =
    visibleTagNames.length > 0 && visibleTagNames.every(t => selectedTags.includes(t));

  const handleSelectAllToggle = (): void => {
    if (allVisibleSelected) {
      onChange(selectedTags.filter(t => !visibleTagNames.includes(t)));
    } else {
      const merged = new Set([...selectedTags, ...visibleTagNames]);
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
            placeholder='Search labels...'
            className='pl-9 h-9'
          />
        </div>
      </div>
      <div
        ref={listContainerRef}
        className='max-h-80 overflow-y-auto p-1'
        role='listbox'
        aria-multiselectable='true'
      >
        {!availableTags || availableTags.length === 0 ? (
          <div className='p-8 text-center text-sm text-muted-foreground'>No labels available</div>
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
              data-track-category='Tickets'
              data-track-name='ToggleSelectAllTags'
            >
              <span className='flex-1 text-left text-sm font-medium text-primary'>
                {allVisibleSelected ? 'Deselect all' : 'Select all'}
              </span>
              {allVisibleSelected && (
                <Check className='w-4 h-4 text-primary shrink-0' aria-hidden='true' />
              )}
            </button>
            {finalResults.map(tag => {
              const isSelected = selectedTags.includes(tag);
              return (
                <button
                  key={tag}
                  type='button'
                  onClick={() => handleTagToggle(tag)}
                  className={`
                    w-full flex items-center gap-3 px-3 py-2 rounded-md transition-all outline-none
                    ${isSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-muted text-foreground'}
                    focus-visible:ring-2 focus-visible:ring-ring
                  `}
                  data-track-category='Tickets'
                  data-track-name='ToggleTagFilter'
                  data-track-metadata={JSON.stringify({ tag, selected: !isSelected })}
                >
                  <div className='flex items-center justify-center w-5 h-5 shrink-0'>
                    <Tag className='w-4 h-4 text-muted-foreground' />
                  </div>
                  <span className='flex-1 text-left text-sm truncate'>{tag}</span>
                  {isSelected && (
                    <Check className='w-4 h-4 text-primary shrink-0' aria-hidden='true' />
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          <div className='p-8 text-center text-sm text-muted-foreground'>No labels found</div>
        )}
      </div>
      {selectedTags.length > 0 && (
        <div className='p-3 border-t bg-muted'>
          <div className='text-xs text-muted-foreground'>
            {selectedTags.length} label{selectedTags.length !== 1 ? 's' : ''} selected
          </div>
        </div>
      )}
    </div>
  );
};
