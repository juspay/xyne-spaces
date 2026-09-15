import { forwardRef, useMemo, useState } from 'react';
import { ChannelScopeType, ChannelType } from '@xyne/shared';
import {
  CheckTickSingle,
  ChevronDown,
  CircleDot,
  EnvelopeDefault,
  Hashtag,
  LightningThunderElectricOn,
  MultipleCrossCancelDefault,
  SearchDefault,
  UserDefault,
} from '@xyne/icons';
import { Button } from '../../../ui/Button/Button';
import { Popover } from '../../../ui/Popover/Popover';
import { DateRangeFilter } from '../../../ui/DateRangeFilter/DateRangeFilter';
import UserAvatar, { AvatarShape, AvatarSize } from '../../../UserAvatar/UserAvatar';
import { cn } from '../../../../utils/classNames';
import { getUserDisplayName, isUserDeactivated } from '../../../../utils/userDisplayName';
import { useAllChannels } from '../../../../hooks/useChannels';
import { useUserSearch, useUsersById } from '../../../../hooks/useUsers';
import type { Automation } from '../../Automation.types';
import {
  TRIGGER_TYPE_OPTIONS,
  STATUS_OPTIONS,
  DEFAULT_AUTOMATION_FILTERS,
  countAutomationsByStatus,
  countAutomationsByTriggerType,
  hasActiveFilters,
  type AutomationDateField,
  type AutomationFilters,
} from './filters';

interface AutomationFiltersBarProps {
  query: string;
  filters: AutomationFilters;
  onChange: (next: AutomationFilters) => void;
  onClearQuery: () => void;
  items: Automation[];
  /** Hides the Status pill — for views where every row already shares one status (e.g. the Approvals inbox). */
  hideStatus?: boolean;
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

/** Shared compact trigger for every multi-select filter popover in this bar. */
const FilterTriggerButton = forwardRef<HTMLButtonElement, TriggerButtonProps>(
  ({ icon, label, count, className, ...rest }, ref) => (
    <button
      ref={ref}
      type='button'
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium transition-colors',
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

interface ChecklistOption<T extends string> {
  value: T;
  label: string;
  icon?: React.ReactNode;
  subtitle?: string | null;
  isDeactivated?: boolean;
  count?: number;
}

/** Shared multi-select checklist popover body — fixed-option (Trigger/Status) and entity (Channel/Created by) filters alike. */
function OptionsChecklist<T extends string>({
  options,
  selectedValues,
  onChange,
  search,
}: {
  options: ChecklistOption<T>[];
  selectedValues: T[];
  onChange: (values: T[]) => void;
  search?: { value: string; onChange: (value: string) => void; placeholder: string; name: string };
}): React.ReactElement {
  return (
    <div className='w-64 py-1'>
      {search && (
        <div className='relative border-b border-border p-1.5'>
          <SearchDefault className='pointer-events-none absolute left-3.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground' />
          <input
            type='text'
            autoFocus
            value={search.value}
            onChange={e => search.onChange(e.target.value)}
            placeholder={search.placeholder}
            data-track-category='automations-list'
            data-track-name={`filter-search-${search.name}`}
            className='w-full rounded bg-transparent py-1 pl-7 pr-2 text-sm text-foreground outline-none placeholder:text-muted-foreground'
          />
        </div>
      )}
      <div className='max-h-72 overflow-y-auto py-1' role='listbox' aria-multiselectable='true'>
        {options.length === 0 && (
          <div className='px-3 py-2.5 text-center text-sm text-muted-foreground'>
            No results found
          </div>
        )}
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
              className={cn(
                'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors outline-none',
                isSelected ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-muted',
              )}
            >
              {option.icon}
              <span className='min-w-0 flex-1'>
                <span className={cn('truncate', option.isDeactivated && 'text-muted-foreground')}>
                  {option.label}
                  {option.isDeactivated && ' · Deactivated'}
                </span>
                {option.subtitle && (
                  <span className='block truncate text-xs text-muted-foreground'>
                    {option.subtitle}
                  </span>
                )}
              </span>
              {option.count !== undefined && (
                <span className='shrink-0 text-[11px] tabular-nums text-muted-foreground'>
                  {option.count}
                </span>
              )}
              {isSelected && <CheckTickSingle className='size-4 shrink-0 text-muted-foreground' />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function channelIcon(type: string | null | undefined): React.ReactElement {
  return type === ChannelType.EMAIL ? (
    <EnvelopeDefault className='size-4 text-muted-foreground' />
  ) : (
    <Hashtag className='size-4 text-muted-foreground' />
  );
}

/** Prepends options for `value` ids missing from `base` (e.g. a selected channel/user not in the current search results), via `resolve`. */
function withMissingSelected<T extends ChecklistOption<string>>(
  base: T[],
  value: string[],
  resolve: (id: string) => T,
): T[] {
  const present = new Set(base.map(o => o.value));
  const missing = value.filter(id => !present.has(id)).map(resolve);
  return [...missing, ...base];
}

function useChannelOptions(search: string, value: string[]): ChecklistOption<string>[] {
  const allChannels = useAllChannels();
  const channels = useMemo(
    () =>
      allChannels.filter(
        c => c.scopeType !== ChannelScopeType.DM && c.scopeType !== ChannelScopeType.GROUP_DM,
      ),
    [allChannels],
  );
  return useMemo(() => {
    const lower = search.trim().toLowerCase();
    const base = channels
      .filter(c => !lower || (c.name ?? '').toLowerCase().includes(lower))
      .map(c => ({ value: c.id, label: c.name || '(unnamed channel)', icon: channelIcon(c.type) }));
    return withMissingSelected(base, value, id => {
      const c = channels.find(ch => ch.id === id);
      return { value: id, label: c?.name || id, icon: channelIcon(c?.type) };
    });
  }, [channels, search, value]);
}

function useCreatedByOptions(search: string, value: string[]): ChecklistOption<string>[] {
  const users = useUserSearch(search, 30);
  const usersById = useUsersById();
  return useMemo(() => {
    const base = users.map(u => ({
      value: u.id,
      label: getUserDisplayName(u),
      subtitle: u.email,
      icon: <UserAvatar userId={u.id} size={AvatarSize.SM} shape={AvatarShape.CIRCULAR} />,
      isDeactivated: isUserDeactivated(u),
    }));
    return withMissingSelected(base, value, id => {
      const u = usersById.get(id);
      return {
        value: id,
        label: u ? getUserDisplayName(u) : id,
        subtitle: u?.email ?? null,
        icon: <UserAvatar userId={id} size={AvatarSize.SM} shape={AvatarShape.CIRCULAR} />,
        isDeactivated: u ? isUserDeactivated(u) : false,
      };
    });
  }, [users, usersById, value]);
}

type FilterKey = 'trigger' | 'status' | 'channels' | 'createdBy';

export function AutomationFiltersBar({
  query,
  filters,
  onChange,
  onClearQuery,
  items,
  hideStatus,
}: AutomationFiltersBarProps): React.ReactElement {
  const [openFilter, setOpenFilter] = useState<FilterKey | null>(null);
  const [channelSearch, setChannelSearch] = useState('');
  const [createdBySearch, setCreatedBySearch] = useState('');
  const active = hasActiveFilters(query, filters);

  const channelOptions = useChannelOptions(channelSearch, filters.channelIds);
  const createdByOptions = useCreatedByOptions(createdBySearch, filters.createdByUserIds);

  const triggerCounts = useMemo(
    () => countAutomationsByTriggerType(items, query, filters),
    [items, query, filters],
  );
  const statusCounts = useMemo(
    () => countAutomationsByStatus(items, query, filters),
    [items, query, filters],
  );
  const triggerOptions = useMemo(
    () => TRIGGER_TYPE_OPTIONS.map(o => ({ ...o, count: triggerCounts[o.value] ?? 0 })),
    [triggerCounts],
  );
  const statusOptions = useMemo(
    () => STATUS_OPTIONS.map(o => ({ ...o, count: statusCounts[o.value] ?? 0 })),
    [statusCounts],
  );

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
          icon={<LightningThunderElectricOn className='size-3.5' aria-hidden='true' />}
          label='Trigger'
          count={filters.triggerTypes.length}
          data-track-category='automations-list'
          data-track-name='filter-trigger'
        />,
        <OptionsChecklist
          options={triggerOptions}
          selectedValues={filters.triggerTypes}
          onChange={values => onChange({ ...filters, triggerTypes: values })}
        />,
      )}

      {!hideStatus &&
        popover(
          'status',
          <FilterTriggerButton
            icon={<CircleDot className='size-3.5' aria-hidden='true' />}
            label='Status'
            count={filters.statuses.length}
            data-track-category='automations-list'
            data-track-name='filter-status'
          />,
          <OptionsChecklist
            options={statusOptions}
            selectedValues={filters.statuses}
            onChange={values => onChange({ ...filters, statuses: values })}
          />,
        )}

      {popover(
        'channels',
        <FilterTriggerButton
          icon={<Hashtag className='size-3.5' aria-hidden='true' />}
          label='Channel'
          count={filters.channelIds.length}
          data-track-category='automations-list'
          data-track-name='filter-channels'
        />,
        <OptionsChecklist
          options={channelOptions}
          selectedValues={filters.channelIds}
          onChange={ids => onChange({ ...filters, channelIds: ids })}
          search={{
            value: channelSearch,
            onChange: setChannelSearch,
            placeholder: 'Search channels…',
            name: 'channels',
          }}
        />,
      )}

      {popover(
        'createdBy',
        <FilterTriggerButton
          icon={<UserDefault className='size-3.5' aria-hidden='true' />}
          label='Created by'
          count={filters.createdByUserIds.length}
          data-track-category='automations-list'
          data-track-name='filter-created-by'
        />,
        <OptionsChecklist
          options={createdByOptions}
          selectedValues={filters.createdByUserIds}
          onChange={ids => onChange({ ...filters, createdByUserIds: ids })}
          search={{
            value: createdBySearch,
            onChange: setCreatedBySearch,
            placeholder: 'Search users…',
            name: 'created-by',
          }}
        />,
      )}

      <div className='inline-flex items-center gap-1 rounded-md border border-border px-1'>
        {DATE_FIELD_OPTIONS.map(opt => (
          <button
            key={opt.value}
            type='button'
            data-track-category='automations-list'
            data-track-name={`filter-date-field-${opt.value}`}
            onClick={() => onChange({ ...filters, dateField: opt.value })}
            className={cn(
              'rounded px-2 py-1 text-xs font-medium transition-colors',
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
            onChange(DEFAULT_AUTOMATION_FILTERS);
            onClearQuery();
          }}
          data-track-category='automations-list'
          data-track-name='filter-clear'
          className='text-xs text-muted-foreground'
        >
          <MultipleCrossCancelDefault className='size-3.5' />
          Clear filters
        </Button>
      )}
    </div>
  );
}
