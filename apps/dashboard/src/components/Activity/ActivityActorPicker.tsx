import { ReactElement, ReactNode, useCallback, useMemo, useState } from 'react';
import { UserType } from '@xyne/shared';
import { CheckTickSingle, SearchDefault, UserUser02 } from '@xyne/icons';
import { Popover } from '../ui/Popover/Popover';
import Avatar from '../ui/Avatar/Avatar';
import { useActiveUsers } from '../../hooks/useUsers';
import { getUserDisplayName, matchesUserQuery } from '../../utils/userDisplayName';
import { cn } from '../../utils/classNames';

interface ActivityActorPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userTypes: UserType[];
  selectedUserId: string | null;
  onSelect: (userId: string | null) => void;
  anyoneLabel: string;
  searchPlaceholder: string;
  trigger: ReactNode;
}

const ROW_CLASS =
  'flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-foreground transition-colors hover:bg-foreground/[6%] focus-visible:outline-none focus-visible:bg-foreground/[6%]';

export const ActivityActorPicker = ({
  open,
  onOpenChange,
  userTypes,
  selectedUserId,
  onSelect,
  anyoneLabel,
  searchPlaceholder,
  trigger,
}: ActivityActorPickerProps): ReactElement => {
  const [query, setQuery] = useState('');
  const users = useActiveUsers();

  const candidates = useMemo(
    () =>
      users
        .filter(user => userTypes.includes(user.userType))
        .filter(user => matchesUserQuery(user, query))
        .sort((a, b) => getUserDisplayName(a).localeCompare(getUserDisplayName(b))),
    [users, userTypes, query],
  );

  const handleOpenChange = useCallback(
    (next: boolean): void => {
      if (!next) setQuery('');
      onOpenChange(next);
    },
    [onOpenChange],
  );

  const handleSelect = useCallback(
    (userId: string | null): void => {
      onSelect(userId);
      handleOpenChange(false);
    },
    [onSelect, handleOpenChange],
  );

  return (
    <Popover
      open={open}
      onOpenChange={handleOpenChange}
      trigger={trigger}
      side='bottom'
      align='start'
      sideOffset={6}
      className='w-[300px] rounded-xl border-border p-1.5 shadow-lg'
    >
      <div className='flex items-center gap-2 rounded-lg bg-foreground/[6%] px-2.5 py-2'>
        <SearchDefault size={14} className='shrink-0 text-muted-foreground' />
        <input
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          className='min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground'
          data-track-category='ACTIVITY'
          data-track-name='ACTOR_FILTER_SEARCH'
          data-testid='activity-actor-picker-search'
        />
      </div>

      <div className='mt-1 max-h-[280px] overflow-y-auto'>
        <button
          type='button'
          onClick={() => handleSelect(null)}
          className={ROW_CLASS}
          data-track-category='ACTIVITY'
          data-track-name='ACTOR_FILTER_PICK'
          data-track-metadata={JSON.stringify({ actor_id: null })}
          data-testid='activity-actor-picker-anyone'
        >
          <span className='flex size-[30px] shrink-0 items-center justify-center rounded-full border border-dashed border-foreground/30'>
            <UserUser02 size={14} className='text-muted-foreground' />
          </span>
          <span className='min-w-0 flex-1 truncate text-left'>{anyoneLabel}</span>
          {selectedUserId === null && (
            <CheckTickSingle size={14} className='shrink-0 text-primary' />
          )}
        </button>

        {candidates.length > 0 && <div className='my-1 h-px bg-border' />}

        {candidates.map(user => (
          <button
            key={user.id}
            type='button'
            onClick={() => handleSelect(user.id)}
            className={ROW_CLASS}
            data-track-category='ACTIVITY'
            data-track-name='ACTOR_FILTER_PICK'
            data-track-metadata={JSON.stringify({ actor_id: user.id })}
            data-testid={`activity-actor-picker-option-${user.id}`}
          >
            <Avatar userId={user.id} size='rg' className='shrink-0' />
            <span className='min-w-0 flex-1 truncate text-left'>{getUserDisplayName(user)}</span>
            {selectedUserId === user.id && (
              <CheckTickSingle size={14} className='shrink-0 text-primary' />
            )}
          </button>
        ))}

        {candidates.length === 0 && query.trim().length > 0 && (
          <div
            className={cn(ROW_CLASS, 'justify-center text-muted-foreground hover:bg-transparent')}
          >
            No results
          </div>
        )}
      </div>
    </Popover>
  );
};
