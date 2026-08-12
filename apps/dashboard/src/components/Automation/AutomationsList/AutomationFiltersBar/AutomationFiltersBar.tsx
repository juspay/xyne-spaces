import { forwardRef, useMemo, useState } from 'react';
import { ChannelType } from '@xyne/shared';
import {
  Check,
  ChevronDown,
  Radio,
  CircleDot,
  Hash,
  Mail,
  User as UserIcon,
  X,
} from 'lucide-react';
import { Button } from '../../../ui/Button/Button';
import { Popover } from '../../../ui/Popover/Popover';
import { DateRangeFilter } from '../../../ui/DateRangeFilter/DateRangeFilter';
import { EntityMultiSelector } from '../../../ui/EntitySelector/EntityMultiSelector';
import type { SelectorOption } from '../../../ui/EntitySelector/EntitySelector.types';
import UserAvatar, { AvatarShape, AvatarSize } from '../../../UserAvatar/UserAvatar';
import { cn } from '../../../../utils/classNames';
import { getUserDisplayName, isUserDeactivated } from '../../../../utils/userDisplayName';
import { useAllChannels } from '../../../../hooks/useChannels';
import { useUserSearch, useUsersById } from '../../../../hooks/useUsers';
import {
  TRIGGER_TYPE_OPTIONS,
  STATUS_OPTIONS,
  EMPTY_AUTOMATION_FILTERS,
  hasActiveFilters,
  type AutomationDateField,
  type AutomationFilters,
} from './filters';

interface AutomationFiltersBarProps {
  query: string;
  filters: AutomationFilters;
  onChange: (next: AutomationFilters) => void;
  onClearQuery: () => void;
}

const DATE_FIELD_OPTIONS: { value: AutomationDateField; label: string }[] = [
  { value: 'createdAt', label: 'Created' },
  { value: 'updatedAt', label: 'Updated' },
];

interface TriggerButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: React.ReactNode;
  label: string;
  count: number;
}

/** Shared compact trigger for the fixed-option filter popovers (Trigger/Status). */
const FilterTriggerButton = forwardRef<HTMLButtonElement, TriggerButtonProps>(
  ({ icon, label, count, className, ...rest }, ref) => (
    <button
      ref={ref}
      type='button'
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-full border border-border px-3 text-xs font-medium transition-colors',
        count > 0
          ? 'border-foreground/40 bg-foreground/5 text-foreground'
          : 'text-muted-foreground hover:text-foreground hover:bg-accent/40',
        className,
      )}
      {...rest}
    >
      {icon}
      {label}
      {count > 0 && (
        <span className='rounded-full bg-foreground px-1.5 text-[10px] font-semibold text-background'>
          {count}
        </span>
      )}
      <ChevronDown className='size-3' aria-hidden='true' />
    </button>
  ),
);
FilterTriggerButton.displayName = 'FilterTriggerButton';

/** Multi-select checklist popover body, for the small fixed-option filters (Trigger/Status). */
function OptionsChecklist<T extends string>({
  options,
  selectedValues,
  onChange,
}: {
  options: { value: T; label: string }[];
  selectedValues: T[];
  onChange: (values: T[]) => void;
}): React.ReactElement {
  return (
    <div className='w-56 py-1' role='listbox' aria-multiselectable='true'>
      {options.map(option => {
        const isSelected = selectedValues.includes(option.value);
        return (
          <button
            key={option.value}
            type='button'
            onClick={() =>
              onChange(
                isSelected
                  ? selectedValues.filter(v => v !== option.value)
                  : [...selectedValues, option.value],
              )
            }
            data-track-category='automations-list'
            data-track-name={`filter-toggle-${option.value}`}
            className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors outline-none ${isSelected ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-muted'}`}
          >
            <span className='truncate'>{option.label}</span>
            {isSelected && <Check className='size-4 shrink-0 text-muted-foreground' />}
          </button>
        );
      })}
    </div>
  );
}

function channelIcon(type: string | null | undefined): React.ReactElement {
  return type === ChannelType.EMAIL ? (
    <Mail className='size-4 text-muted-foreground' />
  ) : (
    <Hash className='size-4 text-muted-foreground' />
  );
}

// Synthetic row for "no channels selected" — never persisted into filter state.
const ALL_CHANNELS_VALUE = '__all_channels__';

/**
 * Channel multi-picker — same EntityMultiSelector pattern the trigger builder
 * uses to pick `channelIds`. An empty selection means "all channels" (no
 * filter applied), shown as a pinned, checked-by-default "All channels" row;
 * picking any real channel replaces it.
 */
function ChannelsField({
  value,
  onChange,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
}): React.ReactElement {
  const [search, setSearch] = useState('');
  const channels = useAllChannels();
  const isSearching = search.trim().length > 0;

  const options: SelectorOption[] = useMemo(() => {
    const lower = search.trim().toLowerCase();
    const base = channels
      .filter(c => (lower ? (c.name ?? '').toLowerCase().includes(lower) : true))
      .map(c => ({ value: c.id, label: c.name || '(unnamed channel)', icon: channelIcon(c.type) }));
    const present = new Set(base.map(o => o.value));
    const selectedExtra: SelectorOption[] = value
      .filter(id => !present.has(id))
      .map(id => {
        const c = channels.find(ch => ch.id === id);
        return { value: id, label: c?.name || id, icon: channelIcon(c?.type) };
      });
    const allOption: SelectorOption = {
      value: ALL_CHANNELS_VALUE,
      label: 'All channels',
      icon: <Hash className='size-4 text-muted-foreground' />,
    };
    return isSearching ? [...selectedExtra, ...base] : [allOption, ...selectedExtra, ...base];
  }, [channels, search, value, isSearching]);

  // "All channels" is implicitly checked whenever nothing specific is picked.
  const selectedValues = value.length === 0 ? [ALL_CHANNELS_VALUE] : value;

  const handleMultiSelect = (next: string[]): void => {
    const wasAllChecked = selectedValues.includes(ALL_CHANNELS_VALUE);
    if (next.includes(ALL_CHANNELS_VALUE) && !wasAllChecked) {
      onChange([]); // user just picked "All channels" — clear any specific picks
      return;
    }
    onChange(next.filter(id => id !== ALL_CHANNELS_VALUE));
  };

  return (
    <EntityMultiSelector
      options={options}
      selectedValues={selectedValues}
      onMultiSelect={handleMultiSelect}
      placeholder='Channel'
      searchPlaceholder='Search channels…'
      onSearchChange={setSearch}
      disableClientFiltering
      showSearch
      inputIcon={<Hash className='size-3.5' aria-hidden='true' />}
      collapseSelectedAfter={2}
      collapsedLabel='channels'
    />
  );
}

/** Created-by multi-picker — same assignee-style EntityMultiSelector used for ticket assignment, but searches every workspace user so deactivated creators stay selectable (e.g. in archived history). */
function CreatedByField({
  value,
  onChange,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
}): React.ReactElement {
  const [search, setSearch] = useState('');
  const users = useUserSearch(search, 30);
  const usersById = useUsersById();

  const options: SelectorOption[] = useMemo(() => {
    const base = users.map(u => ({
      value: u.id,
      label: getUserDisplayName(u),
      subtitle: u.email,
      icon: <UserAvatar userId={u.id} size={AvatarSize.SM} shape={AvatarShape.CIRCULAR} />,
      isDeactivated: isUserDeactivated(u),
    }));
    const present = new Set(base.map(o => o.value));
    const selectedExtra: SelectorOption[] = value
      .filter(id => !present.has(id))
      .map(id => {
        const u = usersById.get(id);
        return u
          ? {
              value: id,
              label: getUserDisplayName(u),
              subtitle: u.email,
              icon: <UserAvatar userId={id} size={AvatarSize.SM} shape={AvatarShape.CIRCULAR} />,
              isDeactivated: isUserDeactivated(u),
            }
          : {
              value: id,
              label: id,
              icon: <UserAvatar userId={id} size={AvatarSize.SM} shape={AvatarShape.CIRCULAR} />,
            };
      });
    return [...selectedExtra, ...base];
  }, [users, usersById, value]);

  return (
    <EntityMultiSelector
      options={options}
      selectedValues={value}
      onMultiSelect={onChange}
      placeholder='Created by'
      searchPlaceholder='Search users…'
      onSearchChange={setSearch}
      disableClientFiltering
      showSearch
      inputIcon={<UserIcon className='size-3.5' aria-hidden='true' />}
      collapseSelectedAfter={2}
      collapsedLabel='people'
    />
  );
}

type FilterKey = 'trigger' | 'status';

export function AutomationFiltersBar({
  query,
  filters,
  onChange,
  onClearQuery,
}: AutomationFiltersBarProps): React.ReactElement {
  const [openFilter, setOpenFilter] = useState<FilterKey | null>(null);
  const active = hasActiveFilters(query, filters);

  const popover = (key: FilterKey, trigger: React.ReactNode, children: React.ReactNode) => (
    <Popover
      open={openFilter === key}
      onOpenChange={v => setOpenFilter(v ? key : null)}
      align='start'
      side='bottom'
      sideOffset={4}
      className='p-0'
      trigger={trigger}
    >
      {children}
    </Popover>
  );

  return (
    <div className='flex flex-wrap items-center gap-2'>
      {popover(
        'trigger',
        <FilterTriggerButton
          icon={<Radio className='size-3.5' aria-hidden='true' />}
          label='Trigger'
          count={filters.triggerTypes.length}
          data-track-category='automations-list'
          data-track-name='filter-trigger'
        />,
        <OptionsChecklist
          options={TRIGGER_TYPE_OPTIONS}
          selectedValues={filters.triggerTypes}
          onChange={values => onChange({ ...filters, triggerTypes: values })}
        />,
      )}

      {popover(
        'status',
        <FilterTriggerButton
          icon={<CircleDot className='size-3.5' aria-hidden='true' />}
          label='Status'
          count={filters.statuses.length}
          data-track-category='automations-list'
          data-track-name='filter-status'
        />,
        <OptionsChecklist
          options={STATUS_OPTIONS}
          selectedValues={filters.statuses}
          onChange={values => onChange({ ...filters, statuses: values })}
        />,
      )}

      <ChannelsField
        value={filters.channelIds}
        onChange={ids => onChange({ ...filters, channelIds: ids })}
      />

      <CreatedByField
        value={filters.createdByUserIds}
        onChange={ids => onChange({ ...filters, createdByUserIds: ids })}
      />

      <div className='inline-flex items-center gap-1 rounded-full border border-border px-1'>
        {DATE_FIELD_OPTIONS.map(opt => (
          <button
            key={opt.value}
            type='button'
            data-track-category='automations-list'
            data-track-name={`filter-date-field-${opt.value}`}
            onClick={() => onChange({ ...filters, dateField: opt.value })}
            className={cn(
              'rounded-full px-2 py-1 text-xs font-medium transition-colors',
              filters.dateField === opt.value
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {opt.label}
          </button>
        ))}
        <DateRangeFilter
          dateRange={filters.dateRange}
          onChange={range => onChange({ ...filters, dateRange: range })}
          className='border-0'
        />
      </div>

      {active && (
        <Button
          variant='ghost'
          size='sm'
          onClick={() => {
            onChange(EMPTY_AUTOMATION_FILTERS);
            onClearQuery();
          }}
          data-track-category='automations-list'
          data-track-name='filter-clear'
          className='text-xs text-muted-foreground'
        >
          <X className='size-3.5' />
          Clear filters
        </Button>
      )}
    </div>
  );
}
