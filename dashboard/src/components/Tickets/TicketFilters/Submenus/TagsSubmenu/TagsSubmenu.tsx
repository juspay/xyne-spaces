import { ReactElement, useState, useEffect, useMemo } from 'react';
import { Search, Check, Tag } from 'lucide-react';
import Input from '../../../../ui/Input/Input';

interface TagsSubmenuProps {
  selectedTags: string[];
  onChange: (tags: string[]) => void;
  availableTags?: string[];
  className?: string;
}

export const TagsSubmenu = ({
  selectedTags,
  onChange,
  availableTags = [],
  className = '',
}: TagsSubmenuProps): ReactElement => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  // Debounced Search
  useEffect(() => {
    const timer = setTimeout(() => setSearchTerm(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const finalResults = useMemo(() => {
    if (!availableTags || availableTags.length === 0) return [];

    let list = [...availableTags];

    // Filter by search term
    if (searchTerm.trim()) {
      const lower = searchTerm.toLowerCase();
      list = list.filter(tag => tag.toLowerCase().includes(lower));
    }

    // Sort selected items to top
    const selectedSet = new Set(selectedTags);
    return list
      .sort((a, b) => {
        const aSel = selectedSet.has(a) ? 1 : 0;
        const bSel = selectedSet.has(b) ? 1 : 0;
        return bSel - aSel;
      })
      .slice(0, 50); // Limit to 50 tags for performance
  }, [availableTags, searchTerm, selectedTags]);

  const handleTagToggle = (tag: string) => {
    const isSelected = selectedTags.includes(tag);
    onChange(isSelected ? selectedTags.filter(t => t !== tag) : [...selectedTags, tag]);
  };

  return (
    <div
      className={`w-80 border border-gray-200 flex flex-col rounded-lg shadow-lg bg-white overflow-hidden ${className}`}
    >
      <div className='p-3 border-b sticky top-0 bg-white z-10'>
        <div className='relative'>
          <Search className='absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none' />
          <Input
            type='text'
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder='Search tags...'
            className='pl-9 h-9'
          />
        </div>
      </div>
      <div className='max-h-80 overflow-y-auto p-1' role='listbox' aria-multiselectable='true'>
        {!availableTags || availableTags.length === 0 ? (
          <div className='p-8 text-center text-sm text-gray-400'>No tags available</div>
        ) : finalResults.length > 0 ? (
          <div className='space-y-0.5'>
            {finalResults.map(tag => {
              const isSelected = selectedTags.includes(tag);
              return (
                <button
                  key={tag}
                  type='button'
                  onClick={() => handleTagToggle(tag)}
                  className={`
                    w-full flex items-center gap-3 px-3 py-2 rounded-md transition-all outline-none
                    ${isSelected ? 'bg-[#F2F2F3] text-black' : 'hover:bg-gray-50 text-gray-700'}
                    focus-visible:ring-2 focus-visible:ring-[#F2F2F3]
                  `}
                >
                  <div className='flex items-center justify-center w-5 h-5 shrink-0'>
                    <Tag className='w-4 h-4 text-gray-400' />
                  </div>
                  <span className='flex-1 text-left text-sm truncate'>{tag}</span>
                  {isSelected && (
                    <Check className='w-4 h-4 text-blue-600 shrink-0' aria-hidden='true' />
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          <div className='p-8 text-center text-sm text-gray-400'>No tags found</div>
        )}
      </div>
      {selectedTags.length > 0 && (
        <div className='p-3 border-t bg-gray-50'>
          <div className='text-xs text-gray-500'>
            {selectedTags.length} tag{selectedTags.length !== 1 ? 's' : ''} selected
          </div>
        </div>
      )}
    </div>
  );
};
