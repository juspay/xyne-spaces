import { memo, type ReactElement, useEffect, useId, useMemo, useRef, useState } from 'react';
import { LockClose, MultipleCrossCancelDefault, UserTwo } from '@xyne/icons';
import { CalendarVisibility } from '@xyne/shared';
import type { User } from '../../../machines/authMachine';
import type { OtherUserCalls } from '../../../hooks/useOtherUserCalls';
import { searchUsers, useActiveUsers } from '../../../hooks/useUsers';
import Avatar from '../../ui/Avatar/Avatar';
import { cn } from '../../../utils/classNames';
import { getUserDisplayName } from '../../../utils/userDisplayName';

const MAX_SUGGESTIONS = 6;
const PENDING_COLOR = '#94a3b8';

interface XyneCalendarMeetWithProps {
  currentUserId: string | undefined;
  selectedUsers: User[];
  otherUsersCalls: Map<string, OtherUserCalls>;
  onAddUser: (user: User) => void;
  onRemoveUser: (userId: string) => void;
}

export const XyneCalendarMeetWith = memo(
  ({
    currentUserId,
    selectedUsers,
    otherUsersCalls,
    onAddUser,
    onRemoveUser,
  }: XyneCalendarMeetWithProps): ReactElement => {
    const listboxId = useId();
    const [query, setQuery] = useState('');
    const [isOpen, setIsOpen] = useState(false);
    const [activeIndex, setActiveIndex] = useState(0);
    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const activeOptionRef = useRef<HTMLButtonElement>(null);

    const activeUsers = useActiveUsers();
    const trimmedQuery = query.trim();
    const suggestions = useMemo(() => {
      const excludedIds = new Set(selectedUsers.map(selected => selected.id));
      if (currentUserId) excludedIds.add(currentUserId);

      return searchUsers(
        activeUsers.filter(candidate => !excludedIds.has(candidate.id)),
        trimmedQuery,
        MAX_SUGGESTIONS,
      );
    }, [activeUsers, currentUserId, selectedUsers, trimmedQuery]);

    useEffect(() => setActiveIndex(0), [trimmedQuery, suggestions.length]);

    useEffect(() => {
      if (!isOpen) return;
      const handlePointerDown = (event: PointerEvent): void => {
        if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false);
      };
      document.addEventListener('pointerdown', handlePointerDown);
      return (): void => document.removeEventListener('pointerdown', handlePointerDown);
    }, [isOpen]);

    useEffect(() => {
      if (isOpen) activeOptionRef.current?.scrollIntoView({ block: 'nearest' });
    }, [activeIndex, isOpen]);

    const addUser = (user: (typeof suggestions)[number]): void => {
      onAddUser(user as unknown as User);
      setQuery('');
      inputRef.current?.focus();
    };

    const clearAll = (): void => {
      selectedUsers.forEach(selected => onRemoveUser(selected.id));
      setIsOpen(false);
    };

    const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setIsOpen(true);
        if (suggestions.length === 0) return;
        const step = event.key === 'ArrowDown' ? 1 : -1;
        setActiveIndex(index => (index + step + suggestions.length) % suggestions.length);
      } else if (event.key === 'Enter') {
        const activeSuggestion = isOpen ? suggestions[activeIndex] : undefined;
        if (!activeSuggestion) return;
        event.preventDefault();
        addUser(activeSuggestion);
      } else if (event.key === 'Backspace' && query === '') {
        const lastSelected = selectedUsers[selectedUsers.length - 1];
        if (lastSelected) onRemoveUser(lastSelected.id);
      } else if (event.key === 'Escape' && isOpen) {
        event.stopPropagation();
        setIsOpen(false);
      }
    };

    const hasSelection = selectedUsers.length > 0;
    const activeSuggestionId = suggestions[activeIndex]
      ? `${listboxId}-${suggestions[activeIndex].id}`
      : undefined;

    return (
      <div
        ref={containerRef}
        className='relative z-20 shrink-0 border-b border-border px-3 py-2'
        aria-label='Search for people'
      >
        {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- the input inside is the keyboard target; this only widens its click area */}
        <div
          className={cn(
            'flex min-h-9 cursor-text flex-wrap items-center gap-1.5 rounded-xl border bg-background px-2 py-1 transition-shadow',
            isOpen ? 'border-primary/50 ring-2 ring-primary/15' : 'border-border hover:bg-muted/40',
          )}
          onClick={() => inputRef.current?.focus()}
          data-track-category='Calendar'
          data-track-name='MEET_WITH_FOCUS'
        >
          <UserTwo className='ml-0.5 size-4 shrink-0 text-muted-foreground' aria-hidden='true' />

          {selectedUsers.map(selected => {
            const data = otherUsersCalls.get(selected.id);
            const color = data?.color ?? PENDING_COLOR;
            const displayName = getUserDisplayName(selected) ?? selected.email ?? 'Unknown';
            const isPrivate = data?.calendarVisibility === CalendarVisibility.PRIVATE;

            return (
              <span
                key={selected.id}
                title={
                  isPrivate ? `${displayName} · Private calendar, busy times only` : displayName
                }
                className='group/chip inline-flex h-6 max-w-40 shrink-0 items-center gap-1 rounded-full border py-0.5 pl-1 pr-1 text-xs font-medium text-foreground'
                style={{ borderColor: `${color}80`, backgroundColor: `${color}1a` }}
              >
                <Avatar userId={selected.id} size='xs' className='shrink-0' />
                <span className='truncate pl-0.5'>{displayName.split(' ')[0]}</span>
                {isPrivate && (
                  <LockClose className='size-3 shrink-0 text-muted-foreground' aria-hidden='true' />
                )}
                <button
                  type='button'
                  aria-label={`Remove ${displayName}`}
                  onClick={event => {
                    event.stopPropagation();
                    onRemoveUser(selected.id);
                  }}
                  data-track-category='Calendar'
                  data-track-name='MEET_WITH_REMOVE'
                  className='flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground'
                >
                  <MultipleCrossCancelDefault size={10} aria-hidden='true' />
                </button>
              </span>
            );
          })}

          <input
            ref={inputRef}
            role='combobox'
            aria-expanded={isOpen}
            aria-controls={listboxId}
            aria-autocomplete='list'
            aria-activedescendant={isOpen ? activeSuggestionId : undefined}
            className='h-6 min-w-16 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground'
            placeholder={hasSelection ? '' : 'Search for people'}
            value={query}
            onChange={event => {
              setQuery(event.target.value);
              setIsOpen(true);
            }}
            onFocus={() => setIsOpen(true)}
            onKeyDown={handleKeyDown}
            data-track-category='Calendar'
            data-track-name='MEET_WITH_SEARCH'
          />

          {selectedUsers.length > 1 && (
            <button
              type='button'
              onClick={event => {
                event.stopPropagation();
                clearAll();
              }}
              data-track-category='Calendar'
              data-track-name='MEET_WITH_CLEAR'
              className='shrink-0 rounded-md px-1.5 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
            >
              Clear
            </button>
          )}
        </div>

        {hasSelection && !isOpen && (
          <p className='mt-1.5 px-1 text-xs text-muted-foreground'>
            Showing their busy times. Pick a free slot to schedule with{' '}
            {selectedUsers.length === 1 ? 'them' : `all ${selectedUsers.length}`}.
          </p>
        )}

        {isOpen && (
          <div
            id={listboxId}
            role='listbox'
            aria-label='People'
            className='absolute left-3 right-3 top-full z-50 -mt-1 max-h-72 overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-lg'
          >
            {suggestions.length === 0 ? (
              <p className='px-3 py-4 text-center text-sm text-muted-foreground'>
                {trimmedQuery ? `No people match "${trimmedQuery}"` : 'No more people to add'}
              </p>
            ) : (
              <>
                <p className='px-2 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70'>
                  {trimmedQuery ? 'People' : 'Add people'}
                </p>
                {suggestions.map((candidate, index) => {
                  const isActive = index === activeIndex;
                  const displayName = getUserDisplayName(candidate) ?? candidate.email;
                  return (
                    <button
                      key={candidate.id}
                      ref={isActive ? activeOptionRef : undefined}
                      id={`${listboxId}-${candidate.id}`}
                      type='button'
                      role='option'
                      aria-selected={isActive}
                      tabIndex={-1}
                      // Keep focus in the input so several people can be added in a row.
                      onMouseDown={event => event.preventDefault()}
                      onClick={() => addUser(candidate)}
                      onMouseMove={() => setActiveIndex(index)}
                      data-track-category='Calendar'
                      data-track-name='MEET_WITH_ADD'
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors',
                        isActive && 'bg-muted',
                      )}
                    >
                      <Avatar userId={candidate.id} size='md' />
                      <span className='flex min-w-0 flex-1 flex-col'>
                        <span className='truncate text-sm font-medium text-foreground'>
                          {displayName}
                        </span>
                        {candidate.email && candidate.email !== displayName && (
                          <span className='truncate text-xs text-muted-foreground'>
                            {candidate.email}
                          </span>
                        )}
                      </span>
                      {isActive && (
                        <kbd className='shrink-0 rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] leading-none text-muted-foreground'>
                          ↵
                        </kbd>
                      )}
                    </button>
                  );
                })}
              </>
            )}
          </div>
        )}
      </div>
    );
  },
);

XyneCalendarMeetWith.displayName = 'XyneCalendarMeetWith';
