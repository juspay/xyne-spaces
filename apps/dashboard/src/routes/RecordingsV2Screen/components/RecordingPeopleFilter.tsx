import { useMemo, useState, type ReactElement } from 'react';
import { ChevronDown, MultipleCrossCancelDefault } from '@xyne/icons';
import type { User } from '@xyne/shared/machines';
import Avatar from '../../../components/ui/Avatar/Avatar';
import { Button } from '../../../components/ui/Button/Button';
import { EntitySelector } from '../../../components/ui/EntitySelector/EntitySelector';
import type { SelectorOption } from '../../../components/ui/EntitySelector/EntitySelector.types';
import { cn } from '../../../utils/classNames';
import { getUserDisplayName, matchesUserQuery } from '../../../utils/userDisplayName';

interface RecordingPeopleFilterProps {
  creators: User[];
  currentUserId?: string | undefined;
  selectedUserId: string | null;
  onUserChange: (userId: string | null) => void;
}

export function RecordingPeopleFilter({
  creators,
  currentUserId,
  selectedUserId,
  onUserChange,
}: RecordingPeopleFilterProps): ReactElement {
  const [searchValue, setSearchValue] = useState('');

  const options = useMemo<SelectorOption[]>(() => {
    const query = searchValue.trim().toLowerCase();
    const matchedCreators = query
      ? creators.filter(creator => matchesUserQuery(creator, searchValue))
      : creators;

    const creatorOptions = matchedCreators.map(creator => ({
      value: creator.id,
      label: `${getUserDisplayName(creator)}${creator.id === currentUserId ? ' (you)' : ''}`,
      icon: (
        <Avatar
          userId={creator.id}
          size='sm'
          showActiveStatus={false}
          className='size-4 rounded-md flex items-center justify-center'
        />
      ),
      subtitle: creator.email ?? null,
    }));

    const selectedCreator = creators.find(creator => creator.id === selectedUserId);
    if (selectedCreator && !creatorOptions.some(option => option.value === selectedCreator.id)) {
      return [
        {
          value: selectedCreator.id,
          label: `${getUserDisplayName(selectedCreator)}${selectedCreator.id === currentUserId ? ' (you)' : ''}`,
          icon: (
            <Avatar
              userId={selectedCreator.id}
              size='sm'
              showActiveStatus={false}
              className='size-4 rounded-md flex items-center justify-center'
            />
          ),
          subtitle: selectedCreator.email ?? null,
        },
        ...creatorOptions,
      ];
    }

    return creatorOptions;
  }, [creators, currentUserId, searchValue, selectedUserId]);

  if (creators.length === 0) {
    return (
      <Button
        type='button'
        variant='outline'
        disabled
        className='h-9 gap-1 rounded-xl border-border px-3 font-medium shadow-none'
        aria-label='People filter unavailable because there are no recordings'
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
