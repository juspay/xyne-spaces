import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X, UsersRound } from 'lucide-react';
import * as Popover from '@radix-ui/react-popover';
import Input from '../Input/Input';
import { Badge } from '../Badge';
import { cn } from '../../../utils/classNames';
import { useUserGroupSearch } from '@xyne/shared/hooks';

export type SearchUserGroupItem = {
  id: string;
  name: string;
};

/** `useUserGroupSearch` returns all groups when the query is empty; never query with empty string. */
const EMPTY_QUERY_SENTINEL = '\uFFFC';

const SEARCH_LIMIT = 10;

export interface SearchUserGroupsProps {
  excludeGroupIds?: string[];
  selectedGroups: SearchUserGroupItem[];
  onGroupsChange: (groups: SearchUserGroupItem[]) => void;
  placeholder?: string;
  label?: string;
  hintText?: string;
  width?: string;
  disabled?: { value: boolean; reason?: string };
  autoFocus?: boolean;
  inputTestId?: string;
  /** Merged into `data-track-metadata` for list item clicks (e.g. `{ canvasId }`). */
  trackMetadata?: Record<string, unknown>;
}

export const SearchUserGroups: React.FC<SearchUserGroupsProps> = ({
  excludeGroupIds = [],
  selectedGroups,
  onGroupsChange,
  placeholder = 'Search user groups...',
  label = '',
  hintText = '',
  width = '100%',
  disabled = { value: false, reason: undefined },
  autoFocus = false,
  inputTestId = 'user-group-search-input',
  trackMetadata = {},
}) => {
  const [searchValue, setSearchValue] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const groupSearchResults = useUserGroupSearch(
    searchValue.trim().length > 0 ? searchValue : EMPTY_QUERY_SENTINEL,
    SEARCH_LIMIT,
  );

  const exclude = useMemo(() => new Set(excludeGroupIds), [excludeGroupIds]);
  const selectedIds = useMemo(() => new Set(selectedGroups.map(g => g.id)), [selectedGroups]);

  const filteredGroups = useMemo(
    () => groupSearchResults.filter(g => !exclude.has(g.id) && !selectedIds.has(g.id)),
    [groupSearchResults, exclude, selectedIds],
  );

  useEffect(() => {
    const shouldShow = searchValue.trim().length > 0 && !disabled.value;
    setIsOpen(shouldShow);
    if (!shouldShow) setSelectedIndex(-1);
  }, [searchValue, disabled.value]);

  useEffect(() => {
    if (selectedIndex >= 0 && listRef.current) {
      const el = listRef.current.children[selectedIndex] as HTMLElement;
      el?.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    setSearchValue(e.target.value);
    setIsOpen(true);
    setSelectedIndex(-1);
  };

  const handleSelect = (g: { id: string; name: string }): void => {
    if (selectedIds.has(g.id)) return;
    onGroupsChange([...selectedGroups, { id: g.id, name: g.name }]);
    setSearchValue('');
    setIsOpen(false);
    setSelectedIndex(-1);
    inputRef.current?.focus();
  };

  const handleTagRemove = (g: SearchUserGroupItem): void => {
    onGroupsChange(selectedGroups.filter(x => x.id !== g.id));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (disabled.value) return;

    if (!isOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      setIsOpen(true);
      return;
    }
    if (!isOpen) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(prev => (prev < filteredGroups.length - 1 ? prev + 1 : prev));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev => (prev > 0 ? prev - 1 : -1));
        break;
      case 'Enter':
        e.preventDefault();
        if (selectedIndex >= 0 && filteredGroups[selectedIndex]) {
          handleSelect(filteredGroups[selectedIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setIsOpen(false);
        setSelectedIndex(-1);
        inputRef.current?.blur();
        break;
    }
  };

  const handleFocus = (): void => {
    if (!disabled.value && searchValue.trim().length > 0) setIsOpen(true);
  };

  return (
    <div style={{ width }} className='w-full'>
      {label ? (
        <label className='block text-sm font-medium text-foreground mb-1.5'>{label}</label>
      ) : null}

      {selectedGroups.length > 0 ? (
        <div className='flex flex-wrap gap-2 mb-2'>
          {selectedGroups.map(g => (
            <Badge key={g.id} variant='primary' className='flex items-center gap-1.5 pr-1'>
              <span className='text-xs truncate max-w-[200px]'>{g.name}</span>
              {!disabled.value ? (
                <button
                  type='button'
                  onClick={() => handleTagRemove(g)}
                  data-track-category='ENTITY_PICKER'
                  data-track-name='REMOVE_GROUP_CHIP'
                  className='rounded-full p-0.5 transition-colors'
                  aria-label={`Remove ${g.name}`}
                >
                  <X className='h-3 w-3' />
                </button>
              ) : null}
            </Badge>
          ))}
        </div>
      ) : null}

      <Popover.Root open={isOpen && !disabled.value} onOpenChange={setIsOpen}>
        <Popover.Anchor asChild>
          <div className='relative'>
            <Search className='absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground pointer-events-none z-10' />
            <Input
              ref={inputRef}
              type='text'
              role='combobox'
              aria-expanded={isOpen}
              aria-controls='search-user-groups-listbox'
              className={cn('pl-10', disabled.value && 'cursor-not-allowed opacity-50')}
              placeholder={placeholder}
              data-testid={inputTestId}
              value={searchValue}
              onChange={handleSearchChange}
              onKeyDown={handleKeyDown}
              onFocus={handleFocus}
              disabled={disabled.value}
              autoFocus={autoFocus}
            />
          </div>
        </Popover.Anchor>

        <Popover.Portal>
          <Popover.Content
            data-testid='user-group-search-results'
            side='bottom'
            align='start'
            sideOffset={4}
            className={cn(
              'z-[9999] min-w-[var(--radix-popover-trigger-width)] max-h-[250px] overflow-y-auto',
              'rounded-md border border-border bg-popover shadow-lg',
            )}
            onOpenAutoFocus={e => e.preventDefault()}
            collisionPadding={8}
            onInteractOutside={() => {
              setIsOpen(false);
              setSelectedIndex(-1);
            }}
          >
            {filteredGroups.length > 0 ? (
              <ul ref={listRef} id='search-user-groups-listbox' role='listbox' className='py-1'>
                {filteredGroups.map((g, index) => (
                  <li
                    key={g.id}
                    id={`search-user-group-option-${index}`}
                    role='option'
                    aria-selected={index === selectedIndex}
                    className={cn(
                      'relative flex cursor-pointer select-none items-center gap-3 px-3 py-2 text-sm outline-none transition-colors',
                      index === selectedIndex
                        ? 'bg-accent text-accent-foreground'
                        : 'hover:bg-accent hover:text-accent-foreground',
                    )}
                    onClick={() => handleSelect(g)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleSelect(g);
                      }
                    }}
                    onMouseEnter={() => setSelectedIndex(index)}
                    tabIndex={-1}
                    data-track-category='CANVAS'
                    data-track-name='SHARE_MODAL_SELECT_GROUP'
                    data-track-metadata={JSON.stringify({
                      ...trackMetadata,
                      userGroupId: g.id,
                    })}
                  >
                    <UsersRound className='size-4 shrink-0 text-muted-foreground' />
                    <span className='font-medium truncate'>{g.name}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className='px-4 py-4 text-center text-sm text-muted-foreground'>
                {searchValue.trim()
                  ? `No groups found matching "${searchValue}"`
                  : 'Start typing to search...'}
              </div>
            )}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      {hintText && !disabled.value ? (
        <p className='text-xs text-muted-foreground mt-1.5'>{hintText}</p>
      ) : null}
      {disabled.reason ? <p className='text-red-600 text-sm mt-1'>{disabled.reason}</p> : null}
    </div>
  );
};
