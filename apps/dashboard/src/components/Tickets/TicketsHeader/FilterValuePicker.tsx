import { ReactElement, useMemo } from 'react';
import { BaseTicketType, LookupType, parseFieldOptionValues } from '@xyne/shared';
import type { TicketPriority } from '@xyne/shared';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { queries } from '../../../zero/queries';
import {
  DateRangeSubmenu,
  DynamicFieldSubmenu,
  PrioritySubmenu,
  RoleSubmenu,
  SourceChannelsSubmenu,
  StagesSubmenu,
  TagsSubmenu,
  MerchantIdSubmenu,
  TicketTypeSubmenu,
  UserGroupSubmenu,
  UserSubmenu,
} from '../TicketFilters/Submenus';
import type { DateRange, TicketFilters } from '../TicketFilters/types';
import type { FilterFieldDef } from './filterChips';
import type { FilterPickerContext } from './TicketsHeader.types';

// Stable identity: a fresh [] on each render would change the prop identity every render
// and invalidate the submenu's memoised list.
const NO_MERCHANTS: string[] = [];

interface FilterValuePickerProps {
  field: FilterFieldDef;
  filters: TicketFilters;
  onFiltersChange: (filters: TicketFilters) => void;
  ctx: FilterPickerContext;
  onClose: () => void;
}

const TicketTypePicker = ({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (types: string[]) => void;
}): ReactElement => {
  const [ticketTypesResult] = useCachedQuery(
    queries.lookupValuesByType({ type: LookupType.TICKET_TYPE }),
  );
  const availableTypes = useMemo(() => {
    const values = new Set<string>(Object.values(BaseTicketType));
    ticketTypesResult?.forEach(t => {
      if (t.value) values.add(t.value);
    });
    return Array.from(values);
  }, [ticketTypesResult]);
  return (
    <TicketTypeSubmenu
      selectedTypes={selected}
      onChange={onChange}
      availableTypes={availableTypes}
    />
  );
};

export const FilterValuePicker = ({
  field,
  filters,
  onFiltersChange,
  ctx,
  onClose,
}: FilterValuePickerProps): ReactElement | null => {
  const setKey = (key: keyof TicketFilters, value: unknown): void => {
    const next = { ...filters, [key]: value };
    Object.keys(next).forEach(k => {
      const v = next[k as keyof TicketFilters];
      if (v === undefined || v === null || (Array.isArray(v) && v.length === 0)) {
        delete next[k as keyof TicketFilters];
      }
    });
    onFiltersChange(next);
  };
  const setDateRange = (range: DateRange, created: boolean): void => {
    const next = { ...filters };
    const startKey = created ? 'createdDateStart' : 'dueDateStart';
    const endKey = created ? 'createdDateEnd' : 'dueDateEnd';
    if (range.start !== undefined) next[startKey] = range.start;
    else delete next[startKey];
    if (range.end !== undefined) next[endKey] = range.end;
    else delete next[endKey];
    onFiltersChange(next);
  };
  const setDynamic = (
    fieldId: string,
    value: string[] | { start?: number; end?: number },
  ): void => {
    const next = { ...filters };
    const dynamicFields = { ...(next.dynamicFields ?? {}) };
    const isEmpty = Array.isArray(value) ? value.length === 0 : !value.start && !value.end;
    if (isEmpty) delete dynamicFields[fieldId];
    else dynamicFields[fieldId] = value;
    if (Object.keys(dynamicFields).length === 0) delete next.dynamicFields;
    else next.dynamicFields = dynamicFields;
    onFiltersChange(next);
  };

  switch (field.id) {
    case 'priority':
      return (
        <PrioritySubmenu
          selectedPriorities={filters.priority || []}
          onChange={(priorities: TicketPriority[]) => setKey('priority', priorities)}
          availablePriorities={ctx.availablePriorities || []}
        />
      );
    case 'assignee':
      return (
        <UserSubmenu
          key='assignee-submenu'
          selectedUsers={filters.assignee || []}
          onChange={(users: string[]) => setKey('assignee', users)}
          label='Assignee'
          includeUnassigned
          allowInvert
          channelId={ctx.channelId}
          priorityUserIds={ctx.availableUsers}
          demoteDeactivated
        />
      );
    case 'userGroups':
      return (
        <UserGroupSubmenu
          selectedGroups={filters.userGroups || []}
          onChange={(groups: string[]) => setKey('userGroups', groups)}
          onClose={onClose}
        />
      );
    case 'roleAssignments':
      return (
        <RoleSubmenu
          key='role-assignments-submenu'
          selectedRoles={filters.roleAssignments || []}
          onChange={value => setKey('roleAssignments', value)}
          availableUsers={ctx.availableUsers || []}
        />
      );
    case 'createdBy':
      return (
        <UserSubmenu
          key='created-by-submenu'
          selectedUsers={filters.createdBy || []}
          onChange={(users: string[]) => setKey('createdBy', users)}
          label='Created by'
        />
      );
    case 'dueDate': {
      const range: DateRange = {};
      if (filters.dueDateStart !== undefined) range.start = filters.dueDateStart;
      if (filters.dueDateEnd !== undefined) range.end = filters.dueDateEnd;
      return (
        <DateRangeSubmenu
          key='due-date-submenu'
          dateRange={range}
          onChange={(next: DateRange) => setDateRange(next, false)}
          onClose={onClose}
          label='Due Date'
          allowFutureDates={true}
        />
      );
    }
    case 'createdAt': {
      const range: DateRange = {};
      if (filters.createdDateStart !== undefined) range.start = filters.createdDateStart;
      if (filters.createdDateEnd !== undefined) range.end = filters.createdDateEnd;
      return (
        <DateRangeSubmenu
          key='created-at-submenu'
          dateRange={range}
          onChange={(next: DateRange) => setDateRange(next, true)}
          onClose={onClose}
          label='Created At'
        />
      );
    }
    case 'tags':
      return (
        <TagsSubmenu
          selectedTags={filters.tags || []}
          onChange={(tags: string[]) => setKey('tags', tags)}
          availableTags={ctx.availableTags || []}
          onLoadMore={ctx.onLoadMoreTags}
          hasMore={ctx.hasMoreTags}
          onSearch={ctx.onSearchTags}
        />
      );
    case 'stages':
      return (
        <StagesSubmenu
          selectedStages={filters.stages || []}
          onChange={(stages: string[]) => setKey('stages', stages)}
          availableStages={ctx.availableStages ?? []}
        />
      );
    case 'ticketTypes':
      return (
        <TicketTypePicker
          selected={filters.ticketTypes || []}
          onChange={types => setKey('ticketTypes', types)}
        />
      );
    case 'merchantIds':
      return (
        <MerchantIdSubmenu
          selectedMerchantIds={filters.merchantIds ?? NO_MERCHANTS}
          onChange={(merchantIds: string[]) => setKey('merchantIds', merchantIds)}
        />
      );
    case 'sourceChannels':
      return (
        <SourceChannelsSubmenu
          projectIds={ctx.projectId ? [ctx.projectId] : (ctx.sourceChannelProjectIds ?? [])}
          selectedChannels={filters.sourceChannels || []}
          onChange={(channels: string[]) => setKey('sourceChannels', channels)}
        />
      );
    default: {
      const formField = field.field;
      if (!formField) return null;
      const currentValue = filters.dynamicFields?.[formField.id] as
        | string[]
        | { start?: number; end?: number }
        | undefined;
      return (
        <DynamicFieldSubmenu
          fieldId={formField.id}
          fieldName={formField.fieldName}
          fieldType={formField.fieldType}
          fieldEnum={parseFieldOptionValues(formField.fieldEnum)}
          selectedValue={currentValue}
          onChange={value => setDynamic(formField.id, value)}
          onClose={onClose}
        />
      );
    }
  }
};
