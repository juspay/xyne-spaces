import React, { useState, useEffect, useMemo, useRef } from 'react';
import { queries } from '../../../zero/queries';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { User } from '@xyne/shared';
import Avatar from '../Avatar/Avatar';
import Input from '../Input/Input';
import { Badge } from '../Badge';
import { cn } from '../../../utils/classNames';
import { Search, X } from 'lucide-react';
import * as Popover from '@radix-ui/react-popover';
import { useActiveUserSearch, useSelf } from '../../../hooks/useUsers';
import { getUserDisplayName, isUserDeactivated } from '../../../utils/userDisplayName';
import { renderEmoji } from '../../../utils/customEmojiUtils';
import { isStatusExpired } from '../../../utils/statusUtils';

interface SearchUserProps {
  excludeUserIds?: string[];
  selectedUsers: User[];
  onUsersChange: (users: User[]) => void;
  placeholder?: string;
  label?: string;
  hintText?: string;
  width?: string;
  disabled?: {
    value: boolean;
    reason?: string;
  };
  channelId?: string;
  autoFocus?: boolean;
  /** When set, only users whose id is in this set are shown (e.g. project members for share collection) */
  allowedUserIds?: Set<string> | null;
}

export const SearchUser: React.FC<SearchUserProps> = ({
  excludeUserIds = [],
  selectedUsers,
  onUsersChange,
  placeholder = 'Search and add users...',
  label = 'Add Users',
  hintText = 'Search user by email or name',
  width = '100%',
  disabled = { value: false, reason: undefined },
  channelId,
  autoFocus = false,
  allowedUserIds,
}) => {
  const [searchValue, setSearchValue] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Get active users matching search query from Zero (deactivated users are excluded)
  const searchResults = useActiveUserSearch(searchValue, 10);
  const selfUser = useSelf();

  // Get channel participants if channelId is provided
  const [channelParticipantsData] = useCachedQuery(
    queries.channelParticipants({ channelId: channelId || '' }),
    { enabled: !!channelId },
  );

  // Get channel participant user IDs
  const channelUserIds = useMemo(() => {
    if (!channelId || !channelParticipantsData) return null;
    return new Set(channelParticipantsData.map(p => p.userId));
  }, [channelId, channelParticipantsData]);

  // Filter users based on exclusions, channel participants, and allowedUserIds (e.g. project members)
  // searchUsers already handles: name/email filtering, active status, and result limit
  const availableUsers = useMemo(() => {
    if (!searchResults) return [];

    return searchResults.filter(user => {
      // If channelId is provided, only show users who are channel participants
      if (channelUserIds && !channelUserIds.has(user.id)) {
        return false;
      }

      // If allowedUserIds is provided (e.g. project members for share collection), only show those users
      if (allowedUserIds && !allowedUserIds.has(user.id)) {
        return false;
      }

      // Exclude users that are already selected or in the exclude list
      const isExcluded =
        excludeUserIds?.includes(user.id) ||
        selectedUsers.some(selected => selected.id === user.id);

      return !isExcluded;
    });
  }, [searchResults, excludeUserIds, selectedUsers, channelUserIds, allowedUserIds]);

  // Get filtered users (limit to 10)
  const filteredUsers = availableUsers.slice(0, 10);

  // Update dropdown visibility when search changes
  useEffect(() => {
    const shouldShow = searchValue.trim().length > 0 && !disabled.value;
    setIsOpen(shouldShow);
    if (!shouldShow) {
      setSelectedIndex(-1);
    }
  }, [searchValue, disabled.value]);

  // Scroll selected item into view
  useEffect(() => {
    if (selectedIndex >= 0 && listRef.current) {
      const selectedElement = listRef.current.children[selectedIndex] as HTMLElement;
      if (selectedElement) {
        selectedElement.scrollIntoView({
          block: 'nearest',
        });
      }
    }
  }, [selectedIndex]);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    setSearchValue(e.target.value);
    setIsOpen(true);
    setSelectedIndex(-1);
  };

  const handleUserSelect = (user: User): void => {
    if (!selectedUsers.some(selected => selected.id === user.id)) {
      onUsersChange([...selectedUsers, user]);
    }
    setSearchValue('');
    setIsOpen(false);
    setSelectedIndex(-1);
    inputRef.current?.focus();
  };

  const handleTagRemove = (user: User): void => {
    const updatedUsers = selectedUsers.filter(u => u.id !== user.id);
    onUsersChange(updatedUsers);
  };

  // Handle keyboard navigation
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
        setSelectedIndex(prev => (prev < filteredUsers.length - 1 ? prev + 1 : prev));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev => (prev > 0 ? prev - 1 : -1));
        break;
      case 'Enter':
        e.preventDefault();
        if (selectedIndex >= 0 && filteredUsers[selectedIndex]) {
          handleUserSelect(filteredUsers[selectedIndex]);
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
    if (!disabled.value && searchValue.trim().length > 0) {
      setIsOpen(true);
    }
  };

  return (
    <div style={{ width }} className='w-full'>
      {label && <label className='block text-sm font-medium text-foreground mb-1.5'>{label}</label>}

      {/* Selected users as badges */}
      {selectedUsers.length > 0 && (
        <div className='flex flex-wrap gap-2 mb-2'>
          {selectedUsers.map(user => (
            <Badge key={user.id} variant='primary' className='flex items-center gap-1.5 pr-1'>
              <span className='text-xs'>{getUserDisplayName(user)}</span>
              {!disabled.value && (
                <button
                  type='button'
                  onClick={() => handleTagRemove(user)}
                  data-track-category='ENTITY_PICKER'
                  data-track-name='REMOVE_USER_CHIP'
                  className='rounded-full p-0.5 transition-colors'
                  aria-label={`Remove ${getUserDisplayName(user)}`}
                >
                  <X className='h-3 w-3' />
                </button>
              )}
            </Badge>
          ))}
        </div>
      )}

      <Popover.Root open={isOpen && !disabled.value} onOpenChange={setIsOpen}>
        <Popover.Anchor asChild>
          <div className='relative'>
            <Search className='absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground pointer-events-none z-10' />
            <Input
              id='dm-user-search-input'
              ref={inputRef}
              type='text'
              role='combobox'
              aria-expanded={isOpen}
              aria-controls='search-listbox'
              aria-autocomplete='list'
              aria-activedescendant={
                selectedIndex >= 0 ? `search-option-${selectedIndex}` : undefined
              }
              className={cn('pl-10', disabled.value && 'cursor-not-allowed opacity-50')}
              placeholder={placeholder}
              data-testid='user-search-input'
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
            data-testid='user-search-results'
            side='bottom'
            align='start'
            sideOffset={4}
            className={cn(
              'z-[9999] min-w-[var(--radix-popover-trigger-width)] max-h-[250px] overflow-y-auto',
              'rounded-md border border-border bg-popover shadow-lg',
              'data-[state=open]:animate-in data-[state=closed]:animate-out',
              'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
              'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
              'data-[side=bottom]:slide-in-from-top-2',
              'scroll-smooth',
              'touch-action-pan-y overscroll-contain',
            )}
            style={{
              WebkitOverflowScrolling: 'touch',
              touchAction: 'pan-y',
              overscrollBehavior: 'contain',
            }}
            onOpenAutoFocus={e => e.preventDefault()}
            collisionPadding={8}
            avoidCollisions={true}
            onWheel={e => {
              e.stopPropagation();
            }}
            onTouchStart={e => {
              // Prevent long-press from triggering parent context menus
              e.stopPropagation();
            }}
            onTouchMove={e => {
              // Allow touch scrolling within the popover on mobile
              e.stopPropagation();
            }}
            onInteractOutside={() => {
              setIsOpen(false);
              setSelectedIndex(-1);
            }}
          >
            {filteredUsers.length > 0 ? (
              <ul ref={listRef} id='search-listbox' role='listbox' className='py-1'>
                {filteredUsers.map((user, index) => (
                  <li
                    key={user.id}
                    id={`search-option-${index}`}
                    role='option'
                    aria-selected={index === selectedIndex}
                    className={cn(
                      'relative flex cursor-pointer select-none items-center gap-3 px-3 py-2 text-sm outline-none transition-colors',
                      index === selectedIndex
                        ? 'bg-accent text-accent-foreground'
                        : 'hover:bg-accent hover:text-accent-foreground',
                    )}
                    onClick={() => handleUserSelect(user)}
                    data-track-category='ENTITY_PICKER'
                    data-track-name='SELECT_USER'
                    onMouseEnter={() => setSelectedIndex(index)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleUserSelect(user);
                      }
                    }}
                    tabIndex={-1}
                  >
                    <div className='size-6 flex items-center justify-center shrink-0'>
                      <Avatar userId={user.id} size='sm' showActiveStatus={false} />
                    </div>
                    <div className='flex flex-col min-w-0 flex-1'>
                      <div className='flex items-center gap-1.5'>
                        <span
                          className={`font-medium truncate flex items-center gap-1 ${isUserDeactivated(user) ? 'text-muted-foreground' : ''}`}
                        >
                          {getUserDisplayName(user)}
                          {selfUser && user.id === selfUser.id && <span>(you)</span>}
                          {user.statusEmoji &&
                            (!user.statusExpiryAt || !isStatusExpired(user.statusExpiryAt)) && (
                              <span className='inline-flex'>{renderEmoji(user.statusEmoji)}</span>
                            )}
                        </span>
                        {isUserDeactivated(user) && (
                          <span className='inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground shrink-0'>
                            Deactivated
                          </span>
                        )}
                      </div>
                      <span className='text-xs text-muted-foreground truncate'>{user.email}</span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className='px-4 py-4 text-center text-sm text-muted-foreground'>
                {searchValue.trim()
                  ? `No users found matching "${searchValue}"`
                  : 'Start typing to search...'}
              </div>
            )}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      {hintText && !disabled.value && (
        <p className='text-xs text-muted-foreground mt-1.5'>{hintText}</p>
      )}
      {disabled.reason && <p className='text-red-600 text-sm mt-1'>{disabled.reason}</p>}
    </div>
  );
};

export default SearchUser;
