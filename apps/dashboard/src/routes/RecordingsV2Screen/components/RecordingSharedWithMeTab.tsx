import { useMemo, useState, type ReactElement } from 'react';
import { ChevronDown, ChevronUp } from '@xyne/icons';
import type { User } from '@xyne/shared/machines';
import { SearchableMultiSelect } from '../../../components/ui/SearchableMultiSelect/SearchableMultiSelect';
import type { SearchableMultiSelectOption } from '../../../components/ui/SearchableMultiSelect/SearchableMultiSelect.types';
import Avatar from '../../../components/ui/Avatar/Avatar';
import { cn } from '../../../utils/classNames';
import { getUserDisplayName } from '../../../utils/userDisplayName';
import { LIST_TAB_CLASS_NAME } from '../utils/RecordingsV2.utils';

interface RecordingSharedWithMeTabProps {
  isActive: boolean;
  /** Called when the tab should become the active ownership scope. */
  onActivate: () => void;
  /** People who shared the currently loaded recordings. */
  sharers: User[];
  selectedSharerIds: string[];
  onSelectedSharerIdsChange: (sharerIds: string[]) => void;
}

/**
 * Ownership tab that doubles as a "shared by" picker: it looks like a plain tab
 * until it is selected, and only then reveals the chevron and selection count.
 */
export function RecordingSharedWithMeTab({
  isActive,
  onActivate,
  sharers,
  selectedSharerIds,
  onSelectedSharerIdsChange,
}: RecordingSharedWithMeTabProps): ReactElement {
  const [isOpen, setIsOpen] = useState(false);

  const options = useMemo<SearchableMultiSelectOption[]>(
    () =>
      sharers.map(sharer => ({
        value: sharer.id,
        label: getUserDisplayName(sharer),
        icon: (
          <Avatar
            userId={sharer.id}
            size='sm'
            showActiveStatus={false}
            className='size-5 shrink-0 rounded-full'
          />
        ),
      })),
    [sharers],
  );

  /** The first click switches scope and opens the picker; later clicks just toggle it. */
  const handleOpenChange = (open: boolean): void => {
    if (open) onActivate();
    setIsOpen(open);
  };

  return (
    <SearchableMultiSelect
      options={options}
      selectedValues={selectedSharerIds}
      onSelectedValuesChange={onSelectedSharerIdsChange}
      isOpen={isOpen}
      onOpenChange={handleOpenChange}
      searchAriaLabel='Search people who shared recordings with you'
      listAriaLabel='People who shared recordings with you'
      emptyMessage='No people found'
      trackCategory='RecordingsV2'
      trackName='toggle_shared_by_filter'
      trigger={
        <button
          type='button'
          aria-pressed={isActive}
          className={cn(
            LIST_TAB_CLASS_NAME,
            'gap-1.5',
            isActive
              ? 'bg-background text-foreground font-medium'
              : 'text-muted-foreground/80 hover:text-foreground',
          )}
          aria-label={
            isActive && selectedSharerIds.length > 0
              ? `Shared with me, ${selectedSharerIds.length} people selected`
              : 'Shared with me'
          }
          data-track-category='RecordingsV2'
          data-track-name='show_shared_with_me'
        >
          Shared with me
          {isActive && selectedSharerIds.length > 0 && (
            <span className='flex h-5 w-5 items-center justify-center rounded-full bg-foreground text-xs font-semibold leading-none tabular-nums text-background pt-0.5'>
              {selectedSharerIds.length}
            </span>
          )}
          {/* The tab must not advertise itself as a dropdown until it is selected. */}
          {isActive &&
            (isOpen ? (
              <ChevronUp className='size-4 text-muted-foreground' aria-hidden='true' />
            ) : (
              <ChevronDown className='size-4 text-muted-foreground' aria-hidden='true' />
            ))}
        </button>
      }
    />
  );
}
