import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { CheckIcon, ChevronDownIcon } from 'lucide-react';
import { cn } from '../../../utils/classNames';
import { useUserSearch } from '../../../hooks/useUsers';
import Avatar from '../Avatar/Avatar';
import type { User } from '@xyne/shared';

interface UserFilterTriggerProps {
  selectedUsers: User[];
  onUsersChange: (users: User[]) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  excludeUserIds?: string[];
}

export const UserFilterTrigger: React.FC<UserFilterTriggerProps> = ({
  selectedUsers,
  onUsersChange,
  placeholder = 'Select...',
  disabled = false,
  className,
  excludeUserIds = [],
}) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const searchResults = useUserSearch(search, 10);

  const selectedIds = useMemo(() => new Set(selectedUsers.map(u => u.id)), [selectedUsers]);

  const filteredUsers = useMemo(() => {
    return searchResults.filter(u => !excludeUserIds.includes(u.id));
  }, [searchResults, excludeUserIds]);

  const toggle = useCallback(
    (user: User) => {
      if (disabled) return;
      if (selectedIds.has(user.id)) {
        onUsersChange(selectedUsers.filter(u => u.id !== user.id));
      } else {
        onUsersChange([...selectedUsers, user]);
      }
    },
    [disabled, selectedIds, selectedUsers, onUsersChange],
  );

  useEffect(() => {
    if (!open) {
      setSearch('');
      setFocusedIndex(-1);
    }
  }, [open]);

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (focusedIndex >= 0 && listRef.current) {
      const item = listRef.current.children[focusedIndex] as HTMLElement | undefined;
      item?.scrollIntoView({ block: 'nearest' });
    }
  }, [focusedIndex]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open || disabled) return;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setFocusedIndex(prev => Math.min(prev + 1, filteredUsers.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocusedIndex(prev => Math.max(prev - 1, 0));
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (
          focusedIndex >= 0 &&
          focusedIndex < filteredUsers.length &&
          filteredUsers[focusedIndex]
        ) {
          toggle(filteredUsers[focusedIndex]);
        }
        break;
      case 'Escape':
        setOpen(false);
        break;
    }
  };

  const triggerLabel = useMemo(() => {
    if (selectedUsers.length === 0) return null;
    if (selectedUsers.length === 1) return selectedUsers[0]?.name ?? '1 selected';
    return `${selectedUsers.length} selected`;
  }, [selectedUsers]);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type='button'
          disabled={disabled}
          data-slot='user-filter-trigger'
          className={cn(
            'flex h-8 w-fit items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none',
            'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
            'disabled:cursor-not-allowed disabled:opacity-50',
            '[&_svg]:pointer-events-none [&_svg]:shrink-0',
            className,
          )}
        >
          <span
            className={cn('truncate', triggerLabel ? 'text-foreground' : 'text-muted-foreground')}
          >
            {triggerLabel ?? placeholder}
          </span>
          <ChevronDownIcon
            className={cn(
              'size-4 text-muted-foreground opacity-50 transition-transform flex-shrink-0',
              open && 'rotate-180',
            )}
          />
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          side='bottom'
          align='start'
          sideOffset={4}
          className={cn(
            'z-50 min-w-[220px] max-w-[280px] rounded-md border bg-popover text-popover-foreground shadow-md',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
            'data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2',
          )}
          onOpenAutoFocus={e => {
            e.preventDefault();
            searchRef.current?.focus();
          }}
          onCloseAutoFocus={e => e.preventDefault()}
        >
          {/* Search */}
          <div className='border-b border-border p-1.5'>
            <input
              ref={searchRef}
              type='text'
              value={search}
              onChange={e => {
                setSearch(e.target.value);
                setFocusedIndex(-1);
              }}
              onKeyDown={handleKeyDown}
              placeholder='Search users...'
              className='w-full h-7 px-2 text-sm bg-transparent border border-input rounded-sm outline-none focus:border-ring placeholder:text-muted-foreground'
            />
          </div>

          {/* User list */}
          <div
            ref={listRef}
            className='max-h-[200px] overflow-y-auto p-1'
            role='listbox'
            aria-multiselectable='true'
          >
            {filteredUsers.length === 0 ? (
              <div className='px-2 py-4 text-center text-sm text-muted-foreground'>
                {search.trim() ? 'No users found' : 'Type to search'}
              </div>
            ) : (
              filteredUsers.map((user, index) => {
                const isSelected = selectedIds.has(user.id);
                const isFocused = index === focusedIndex;
                return (
                  <button
                    key={user.id}
                    type='button'
                    role='option'
                    aria-selected={isSelected}
                    onClick={() => toggle(user)}
                    onMouseEnter={() => setFocusedIndex(index)}
                    className={cn(
                      'relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none transition-colors',
                      isFocused
                        ? 'bg-accent text-accent-foreground'
                        : 'hover:bg-accent hover:text-accent-foreground',
                    )}
                  >
                    <Avatar userId={user.id} size='sm' showActiveStatus={false} />
                    <span className='truncate'>{user.name}</span>
                    {isSelected && (
                      <span className='absolute right-2 flex size-3.5 items-center justify-center'>
                        <CheckIcon className='size-4 text-foreground' />
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};
