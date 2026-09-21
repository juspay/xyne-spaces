import { ReactElement, useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  SearchDefault as Search,
  CheckTickSingle as Check,
  Tag,
  PlusDefault as Plus,
} from '@xyne/icons';
import Input from '../../ui/Input/Input';

export interface TagsListContentProps {
  selectedTags: string[];
  onChange: (tags: string[]) => void;
  availableTags?: string[] | undefined;
  /** Callback to load more tags */
  onLoadMore?: (() => void) | undefined;
  /** Whether there are more tags to load */
  hasMore?: boolean | undefined;
  /** Whether to show the "Select All" button (default: true) */
  showSelectAll?: boolean | undefined;
  /** Whether to allow creating new tags (default: false) */
  allowCreate?: boolean | undefined;
  /** Callback when creating a new tag */
  onCreateTag?: ((tagName: string) => void) | undefined;
  /** Callback after a tag is toggled (e.g., to close the popover) */
  onTagToggled?: (() => void) | undefined;
  /** Keyboard event handler for search input */
  onKeyDown?: ((e: React.KeyboardEvent) => void) | undefined;
  /** Callback for server-side search (debounced internally) */
  onSearch?: ((query: string) => void) | undefined;
}

export const TagsListContent = ({
  selectedTags,
  onChange,
  availableTags = [],
  onLoadMore,
  hasMore = false,
  showSelectAll = true,
  allowCreate = false,
  onCreateTag,
  onTagToggled,
  onKeyDown,
  onSearch,
}: TagsListContentProps): ReactElement => {
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listContainerRef = useRef<HTMLDivElement>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Focus search input when component mounts
  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  // Debounced search callback
  useEffect(() => {
    if (!onSearch) return;

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      onSearch(searchQuery);
    }, 300);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [searchQuery, onSearch]);

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

  // Check if we can create a new tag
  const canCreate = useMemo(() => {
    if (!allowCreate) return false;
    const trimmed = searchQuery.trim();
    return trimmed && !availableTags.some(t => t.toLowerCase() === trimmed.toLowerCase());
  }, [searchQuery, availableTags, allowCreate]);

  const handleTagToggle = (tag: string) => {
    const isSelected = selectedTags.includes(tag);
    onChange(isSelected ? selectedTags.filter(t => t !== tag) : [...selectedTags, tag]);
    onTagToggled?.();
  };

  const handleCreateTag = () => {
    const trimmed = searchQuery.trim();
    if (canCreate) {
      onCreateTag?.(trimmed);
      onChange([...selectedTags, trimmed]);
      setSearchQuery('');
      onTagToggled?.();
    }
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
    <>
      <div className='p-3 border-b sticky top-0 bg-background z-10'>
        <div className='relative'>
          <Search className='absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none' />
          <Input
            ref={searchInputRef}
            type='text'
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={onKeyDown}
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
            {showSelectAll && (
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
            )}
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

        {canCreate && (
          <div className='border-t border-border mt-1 pt-1'>
            <button
              type='button'
              onClick={handleCreateTag}
              className='flex items-center gap-2 w-full px-3 py-2 text-sm rounded font-medium text-blue-600 hover:bg-blue-50'
              data-track-category='Tickets'
              data-track-name='CreateTag'
              data-track-metadata={JSON.stringify({ tagName: searchQuery.trim() })}
            >
              <Plus className='size-4' />
              Create {searchQuery.trim()}
            </button>
          </div>
        )}
      </div>
    </>
  );
};
