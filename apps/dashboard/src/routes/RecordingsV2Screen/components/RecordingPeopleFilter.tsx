import { useMemo, useState, type ReactElement } from 'react';
import { ChevronDown, MultipleCrossCancelDefault } from '@xyne/icons';
import type { User } from '@xyne/shared/machines';
import Avatar from '../../../components/ui/Avatar/Avatar';
import { Button } from '../../../components/ui/Button/Button';
import { EntitySelector } from '../../../components/ui/EntitySelector/EntitySelector';
import type { SelectorOption } from '../../../components/ui/EntitySelector/EntitySelector.types';
import { useRankedActivePeople } from '../../../hooks/useRankedPeopleSearch';
import { useActiveUsers, useUser } from '../../../hooks/useUsers';
import { cn } from '../../../utils/classNames';
import { getUserDisplayName } from '../../../utils/userDisplayName';

/**
 * Rows actually offered per keystroke. The filter targets a participant id that
 * the recordings query resolves server-side, so the candidate pool is the whole
 * workspace — but only the top-ranked slice ever becomes an option.
 */
const PEOPLE_LIMIT = 20;

interface RecordingPeopleFilterProps {
  currentUserId?: string | undefined;
  selectedUserId: string | null;
  onUserChange: (userId: string | null) => void;
}

/**
 * Participant filter for the recordings list.
 *
 * Candidates come from `useRankedActivePeople` — the same token-match → MFU
 * affinity → DM-recency recipe the recording share modal and the call pickers
 * use — capped at `PEOPLE_LIMIT` *before* anything is decorated.
 *
 * That ordering is the fix. This filter used to be handed the complete workspace
 * roster and, on every keystroke, substring-filter it and map every survivor into
 * an option object carrying its own `<Avatar>` element — thousands of React
 * elements per character typed, rendered into an unvirtualized dropdown. Ranking
 * and slicing first means the work per keystroke is bounded by what is on screen,
 * and the browse state now opens on frequent contacts instead of raw roster order.
 */
export function RecordingPeopleFilter({
  currentUserId,
  selectedUserId,
  onUserChange,
}: RecordingPeopleFilterProps): ReactElement {
  const [searchValue, setSearchValue] = useState('');

  const rankedPeople = useRankedActivePeople(searchValue.trim(), PEOPLE_LIMIT);
  // Resolved from the full roster (not the ranked slice): the trigger label and
  // the checkmark must survive a query the selected person does not match, and a
  // participant may since have been deactivated.
  const selectedUser = useUser(selectedUserId ?? '');
  const hasPeople = useActiveUsers().length > 0;

  const options = useMemo<SelectorOption[]>(() => {
    const toOption = (user: User): SelectorOption => ({
      value: user.id,
      label: `${getUserDisplayName(user)}${user.id === currentUserId ? ' (you)' : ''}`,
      icon: (
        <Avatar
          userId={user.id}
          size='sm'
          showActiveStatus={false}
          className='size-4 rounded-md flex items-center justify-center'
        />
      ),
      subtitle: user.email ?? null,
    });

    const rows = rankedPeople.map(toOption);
    if (selectedUser && !rankedPeople.some(person => person.id === selectedUser.id)) {
      rows.unshift(toOption(selectedUser));
    }
    return rows;
  }, [rankedPeople, selectedUser, currentUserId]);

  if (!hasPeople) {
    return (
      <Button
        type='button'
        variant='outline'
        disabled
        className='h-9 gap-1 rounded-xl border-border px-3 font-medium shadow-none'
        aria-label='People filter unavailable because there are no people to filter by'
      >
        People
        <ChevronDown className='size-4' aria-hidden='true' />
      </Button>
    );
  }

  return (
    <div className='relative inline-flex'>
      <EntitySelector
        options={options}
        selectedValue={selectedUserId}
        onSelect={onUserChange}
        placeholder='People'
        searchPlaceholder='Search people...'
        inputClassName={cn(
          'h-9 max-w-[9rem] rounded-xl pl-3 pr-7 text-sm font-medium shadow-sm',
          '[&>span]:min-w-0 [&>span]:overflow-hidden [&>span]:text-ellipsis [&>span]:!whitespace-nowrap',
          selectedUserId && '!border-foreground',
        )}
        onSearchChange={setSearchValue}
        disableClientFiltering
        showIndicator={false}
        testId='recordings-people-filter'
      />

      {selectedUserId ? (
        <Button
          type='button'
          variant='ghost'
          size='iconSm'
          onPointerDown={event => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={event => {
            event.stopPropagation();
            onUserChange(null);
          }}
          className='absolute right-2 top-1/2 z-10 size-5 -translate-y-1/2 rounded p-0 text-muted-foreground hover:text-foreground'
          aria-label='Clear people filter'
          data-track-category='RecordingsV2'
          data-track-name='clear_people_filter'
        >
          <MultipleCrossCancelDefault className='size-3' />
        </Button>
      ) : (
        <ChevronDown
          className='pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground'
          aria-hidden='true'
        />
      )}
    </div>
  );
}
