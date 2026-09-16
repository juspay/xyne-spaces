import { useMemo, useState, type ReactElement } from 'react';
import { ChevronDown, ChevronUp } from '@xyne/icons';
import Avatar from '../../components/ui/Avatar/Avatar';
import { Button } from '../../components/ui/Button/Button';
import { SearchableMultiSelect } from '../../components/ui/SearchableMultiSelect/SearchableMultiSelect';
import type { SearchableMultiSelectOption } from '../../components/ui/SearchableMultiSelect/SearchableMultiSelect.types';
import { cn } from '../../utils/classNames';
import { getUserDisplayName } from '../../utils/userDisplayName';

export interface CallParticipantFilterUser {
  id: string;
  name?: string | null;
  email?: string | null;
  displayName?: string | null;
}

interface CallParticipantFilterProps {
  users: CallParticipantFilterUser[];
  selectedUserIds: string[];
  onSelectedUserIdsChange: (userIds: string[]) => void;
}

/** Sized to sit level with the Labels and Recents dropdowns beside it. */
const TRIGGER_CLASS_NAME =
  'h-7 gap-1 rounded-lg border-border px-2.5 text-sm font-medium shadow-none';
const LIST_INHERITS_POPOVER_CLASS_NAME =
  '[[data-theme=midnight]_&_[role=listbox][aria-multiselectable]]:!bg-transparent';

/**
 * Participant filter for the Recents list. Selections are handed to the call search
 * as `with:` chips, so the existing Vespa participant filter does the matching.
 */
export function CallParticipantFilter({
  users,
  selectedUserIds,
  onSelectedUserIdsChange,
}: CallParticipantFilterProps): ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  // Who was already selected when the list opened. Re-sorting on every toggle would
  // slide the row under the cursor away mid-selection, so the order is frozen for the
  // life of one opening and regrouped on the next.
  const [pinnedUserIds, setPinnedUserIds] = useState<string[]>([]);

  const handleOpenChange = (open: boolean): void => {
    if (open) setPinnedUserIds(selectedUserIds);
    setIsOpen(open);
  };

  // Values stay user ids — what the search filter is keyed by — while the display
  // name drives both the row text and SearchableMultiSelect's own search filtering.
  const options = useMemo<SearchableMultiSelectOption[]>(() => {
    const pinned = new Set(pinnedUserIds);
    return users
      .map(user => ({
        value: user.id,
        label: getUserDisplayName(user),
        icon: <Avatar userId={user.id} size='sm' showActiveStatus={false} />,
      }))
      .sort((left, right) => {
        const isLeftPinned = pinned.has(left.value);
        const isRightPinned = pinned.has(right.value);
        if (isLeftPinned !== isRightPinned) return isLeftPinned ? -1 : 1;
        return left.label.localeCompare(right.label);
      });
  }, [users, pinnedUserIds]);

  if (options.length === 0) {
    return (
      <Button
        type='button'
        variant='outline'
        disabled
        className={TRIGGER_CLASS_NAME}
        aria-label='Participant filter unavailable because no users are available'
      >
        Participants
        <ChevronDown className='size-4' aria-hidden='true' />
      </Button>
    );
  }

  return (
    <SearchableMultiSelect
      options={options}
      selectedValues={selectedUserIds}
      onSelectedValuesChange={onSelectedUserIdsChange}
      isOpen={isOpen}
      onOpenChange={handleOpenChange}
      searchPlaceholder='Search people...'
      searchAriaLabel='Search participants'
      listAriaLabel='Participants'
      emptyMessage='No people found'
      trackCategory='CallHistory'
      trackName='toggle_participant_filter'
      className={LIST_INHERITS_POPOVER_CLASS_NAME}
      trigger={
        <Button
          type='button'
          variant='outline'
          className={cn(
            selectedUserIds.length === 0 ? 'text-muted-foreground' : '!border-foreground',
            TRIGGER_CLASS_NAME,
          )}
          aria-label={
            selectedUserIds.length > 0
              ? `Participants, ${selectedUserIds.length} selected`
              : 'Filter calls by participant'
          }
          data-track-category='CallHistory'
          data-track-name='open_participant_filter'
        >
          Participants
          {selectedUserIds.length > 0 && (
            <span className='flex h-4 min-w-4 items-center justify-center rounded-full bg-foreground px-1 text-xs font-semibold leading-none tabular-nums text-background'>
              {selectedUserIds.length}
            </span>
          )}
          {isOpen ? (
            <ChevronUp className='size-4 text-muted-foreground' aria-hidden='true' />
          ) : (
            <ChevronDown className='size-4 text-muted-foreground' aria-hidden='true' />
          )}
        </Button>
      }
    />
  );
}
