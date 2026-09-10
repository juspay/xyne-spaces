import { ReactElement, useState, useEffect, useMemo, useRef } from 'react';
import {
  SearchDefault as Search,
  CheckTickSingle as Check,
  ChevronRight,
  ArrowLeft,
} from '@xyne/icons';
import { tagsConfigApi } from '../../../../../api/tagsConfigApi';
import { usePlatform } from '../../../../../hooks/usePlatform';
import Input from '../../../../ui/Input/Input';

interface GeneratedTagsSubmenuProps {
  selectedTags: string[];
  onChange: (tags: string[]) => void;
  channelId: string | null;
}

export const GeneratedTagsSubmenu = ({
  selectedTags,
  onChange,
  channelId,
}: GeneratedTagsSubmenuProps): ReactElement => {
  // null = level 1 (category list), string = level 2 (tags for that category)
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [categorySearchQuery, setCategorySearchQuery] = useState('');
  const [categorySearchTerm, setCategorySearchTerm] = useState('');
  const [tagSearchQuery, setTagSearchQuery] = useState('');
  const [tagSearchTerm, setTagSearchTerm] = useState('');

  const [categories, setCategories] = useState<string[]>([]);
  const [tagsForCategory, setTagsForCategory] = useState<string[]>([]);
  const [isLoadingCategories, setIsLoadingCategories] = useState(false);
  const [isLoadingTags, setIsLoadingTags] = useState(false);

  // Cache fetched tags per category so back-navigation doesn't re-fetch
  const tagCache = useRef<Record<string, string[]>>({});

  const searchInputRef = useRef<HTMLInputElement>(null);
  const { isMobile } = usePlatform();

  // Auto-focus search input on mount and on level transitions
  useEffect(() => {
    if (isMobile) return;
    const rafId = requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
    return () => cancelAnimationFrame(rafId);
  }, [isMobile, activeCategory]);

  // Debounce category search (level 1)
  useEffect(() => {
    const timer = setTimeout(() => setCategorySearchTerm(categorySearchQuery), 300);
    return () => clearTimeout(timer);
  }, [categorySearchQuery]);

  // Debounce tag search (level 2)
  useEffect(() => {
    const timer = setTimeout(() => setTagSearchTerm(tagSearchQuery), 300);
    return () => clearTimeout(timer);
  }, [tagSearchQuery]);

  // Load categories on mount; clear cache when channel changes
  useEffect(() => {
    if (!channelId) return;
    tagCache.current = {};
    setCategories([]);
    setActiveCategory(null);
    setIsLoadingCategories(true);
    tagsConfigApi
      .getGeneratedTagCategories(channelId)
      .then(setCategories)
      .catch(() => setCategories([]))
      .finally(() => setIsLoadingCategories(false));
  }, [channelId]);

  // Load tags for the active category (uses cache)
  useEffect(() => {
    if (!channelId || activeCategory === null) return;
    if (tagCache.current[activeCategory]) {
      setTagsForCategory(tagCache.current[activeCategory]);
      return;
    }
    setIsLoadingTags(true);
    tagsConfigApi
      .getGeneratedTagsByCategory(channelId, activeCategory)
      .then(tags => {
        tagCache.current[activeCategory] = tags;
        setTagsForCategory(tags);
      })
      .catch(() => setTagsForCategory([]))
      .finally(() => setIsLoadingTags(false));
  }, [channelId, activeCategory]);

  // Category list filtered by search
  const filteredCategories = useMemo(() => {
    const lower = categorySearchTerm.trim().toLowerCase();
    if (!lower) return categories;
    return categories.filter(c => c.toLowerCase().includes(lower));
  }, [categories, categorySearchTerm]);

  // Tags for active category filtered by search
  const filteredTagKeys = useMemo(() => {
    if (activeCategory === null) return [];
    const lower = tagSearchTerm.trim().toLowerCase();
    const tagKeys = tagsForCategory.map(tag => `${activeCategory}:${tag}`);
    if (!lower) return tagKeys;
    return tagKeys.filter(key => {
      const tagValue = key.slice(activeCategory.length + 1);
      return tagValue.toLowerCase().includes(lower);
    });
  }, [tagsForCategory, activeCategory, tagSearchTerm]);

  // Selected count per category — derives from selectedTags, unaffected by lazy loading
  const selectedCountByCategory = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const tagKey of selectedTags) {
      const colonIdx = tagKey.indexOf(':');
      if (colonIdx === -1) continue;
      const cat = tagKey.slice(0, colonIdx);
      counts[cat] = (counts[cat] ?? 0) + 1;
    }
    return counts;
  }, [selectedTags]);

  const handleToggle = (tagKey: string): void => {
    if (selectedTags.includes(tagKey)) {
      onChange(selectedTags.filter(t => t !== tagKey));
    } else {
      onChange([...selectedTags, tagKey]);
    }
  };

  const handleCategoryClick = (category: string): void => {
    setActiveCategory(category);
    setTagSearchQuery('');
    setTagSearchTerm('');
  };

  const handleBack = (): void => {
    setActiveCategory(null);
    setTagSearchQuery('');
    setTagSearchTerm('');
  };

  // ── Level 2: tags for the selected category ──────────────────────────────
  if (activeCategory !== null) {
    const count = selectedCountByCategory[activeCategory] ?? 0;
    return (
      <div className='w-80 border border-border flex flex-col rounded-lg shadow-lg bg-background overflow-hidden'>
        <div className='flex items-center gap-2 px-3 py-2.5 border-b bg-background'>
          <button
            type='button'
            onClick={handleBack}
            className='flex items-center justify-center rounded-md p-1 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors'
            aria-label='Back to categories'
            data-track-category='Tickets'
            data-track-name='BackToGeneratedTagCategories'
          >
            <ArrowLeft className='w-4 h-4' />
          </button>
          <span className='text-sm font-medium text-foreground truncate'>{activeCategory}</span>
        </div>

        <div className='p-3 border-b bg-background'>
          <div className='relative'>
            <Search className='absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none' />
            <Input
              ref={searchInputRef}
              type='text'
              value={tagSearchQuery}
              onChange={e => setTagSearchQuery(e.target.value)}
              placeholder='Search tags...'
              className='pl-9 h-9'
            />
          </div>
        </div>

        <div className='max-h-72 overflow-y-auto p-1' role='listbox' aria-multiselectable='true'>
          {isLoadingTags ? (
            <div className='p-8 text-center text-sm text-muted-foreground'>Loading…</div>
          ) : tagsForCategory.length === 0 ? (
            <div className='p-8 text-center text-sm text-muted-foreground'>No tags available</div>
          ) : filteredTagKeys.length === 0 ? (
            <div className='p-8 text-center text-sm text-muted-foreground'>No tags found</div>
          ) : (
            <div className='space-y-0.5'>
              {filteredTagKeys.map(tagKey => {
                const isSelected = selectedTags.includes(tagKey);
                const tagValue = tagKey.slice(activeCategory.length + 1);
                return (
                  <button
                    key={tagKey}
                    type='button'
                    onClick={() => handleToggle(tagKey)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-md transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      isSelected
                        ? 'bg-accent text-accent-foreground'
                        : 'hover:bg-muted text-foreground'
                    }`}
                    data-track-category='Tickets'
                    data-track-name='ToggleGeneratedTagFilter'
                    data-track-metadata={JSON.stringify({ tag: tagKey, selected: !isSelected })}
                  >
                    <span className='text-sm truncate'>{tagValue}</span>
                    {isSelected && (
                      <Check className='w-4 h-4 text-primary shrink-0' aria-hidden='true' />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {count > 0 && (
          <div className='p-3 border-t bg-muted'>
            <div className='text-xs text-muted-foreground'>
              {count} tag{count !== 1 ? 's' : ''} selected in this category
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Level 1: category list ────────────────────────────────────────────────
  return (
    <div className='w-80 border border-border flex flex-col rounded-lg shadow-lg bg-background overflow-hidden'>
      <div className='p-3 border-b bg-background'>
        <div className='relative'>
          <Search className='absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none' />
          <Input
            ref={searchInputRef}
            type='text'
            value={categorySearchQuery}
            onChange={e => setCategorySearchQuery(e.target.value)}
            placeholder='Search categories...'
            className='pl-9 h-9'
          />
        </div>
      </div>

      <div className='max-h-80 overflow-y-auto p-1' role='listbox'>
        {isLoadingCategories ? (
          <div className='p-8 text-center text-sm text-muted-foreground'>Loading…</div>
        ) : categories.length === 0 ? (
          <div className='p-8 text-center text-sm text-muted-foreground'>
            No AI tags available for this channel
          </div>
        ) : filteredCategories.length === 0 ? (
          <div className='p-8 text-center text-sm text-muted-foreground'>No categories found</div>
        ) : (
          <div className='space-y-0.5'>
            {filteredCategories.map(category => {
              const count = selectedCountByCategory[category] ?? 0;
              return (
                <button
                  key={category}
                  type='button'
                  onClick={() => handleCategoryClick(category)}
                  className='w-full flex items-center justify-between px-3 py-2 rounded-md transition-all outline-none hover:bg-muted text-foreground focus-visible:ring-2 focus-visible:ring-ring'
                  data-track-category='Tickets'
                  data-track-name='OpenGeneratedTagCategory'
                  data-track-metadata={JSON.stringify({ category })}
                >
                  <span className='text-sm truncate'>{category}</span>
                  <div className='flex items-center gap-1.5 shrink-0'>
                    {count > 0 && (
                      <span className='flex items-center justify-center min-w-[20px] h-5 rounded-full bg-primary px-1.5 text-[11px] font-medium text-primary-foreground'>
                        {count}
                      </span>
                    )}
                    <ChevronRight className='w-4 h-4 text-muted-foreground' />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {selectedTags.length > 0 && (
        <div className='p-3 border-t bg-muted'>
          <div className='text-xs text-muted-foreground'>
            {selectedTags.length} tag{selectedTags.length !== 1 ? 's' : ''} selected across all
            categories
          </div>
        </div>
      )}
    </div>
  );
};
