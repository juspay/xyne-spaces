import {
  BarchartDefault,
  CalendarDefault,
  Circle,
  ClockDefault,
  Hashtag,
  LayerTwo,
  Tag,
  UserDefault,
  UserTwo,
} from '@xyne/icons';
import { FormFieldType } from '@xyne/shared';
import type { FormFields } from '@xyne/shared';
import { ASSIGNEE_INVERT_MARKER, UNASSIGNED_FILTER_VALUE } from '../../../zero/queries';
import {
  resolveDisplayFormFields,
  type ResolvedDisplayFormField,
} from '../../../utils/board/resolveDisplayFormFields';
import { getIconForFieldType } from '../TicketFilters/fieldTypeIcons';
import type { TicketFilters } from '../TicketFilters/types';
import type { FilterChipNames, FilterPickerContext } from './TicketsHeader.types';

type IconComponent = typeof BarchartDefault;

export interface FilterFieldDef {
  id: string;
  label: string;
  icon: IconComponent;
  noun: string;
  isFlag?: boolean;
  field?: ResolvedDisplayFormField;
  trackName?: string;
}

export interface FilterChipDef extends FilterFieldDef {
  operator: string;
  value: string;
  mono?: boolean;
}

const STATIC_FIELDS: FilterFieldDef[] = [
  { id: 'assignee', label: 'Assignee', icon: UserDefault, noun: 'people' },
  { id: 'priority', label: 'Priority', icon: BarchartDefault, noun: 'priorities' },
  { id: 'userGroups', label: 'User Groups', icon: UserTwo, noun: 'groups' },
  { id: 'createdBy', label: 'Created by', icon: UserDefault, noun: 'people' },
  { id: 'roleAssignments', label: 'Roles', icon: UserDefault, noun: 'roles' },
  { id: 'dueDate', label: 'Due Date', icon: CalendarDefault, noun: 'dates' },
  { id: 'createdAt', label: 'Created At', icon: CalendarDefault, noun: 'dates' },
  { id: 'tags', label: 'Labels', icon: Tag, noun: 'labels' },
  { id: 'stages', label: 'Stages', icon: Circle, noun: 'stages' },
  { id: 'ticketTypes', label: 'Type', icon: LayerTwo, noun: 'types' },
  { id: 'merchantIds', label: 'Merchant ID', icon: Hashtag, noun: 'merchant IDs' },
  { id: 'sourceChannels', label: 'Source channels', icon: Hashtag, noun: 'channels' },
];

const FLAG_FIELDS = {
  overdue: {
    id: 'overdue',
    label: 'Overdue',
    icon: ClockDefault,
    noun: 'values',
    isFlag: true,
    trackName: 'ToggleOverdueFilter',
  },
  assigned: {
    id: 'assigned',
    label: 'Assignee',
    icon: UserDefault,
    noun: 'people',
    isFlag: true,
    trackName: 'ToggleAssignedToMeFilter',
  },
  created: {
    id: 'created',
    label: 'Created by',
    icon: UserDefault,
    noun: 'people',
    isFlag: true,
    trackName: 'ToggleCreatedByMeFilter',
  },
} satisfies Record<string, FilterFieldDef>;

export const resolveDynamicFields = (
  formMappings: readonly unknown[] | undefined,
): ResolvedDisplayFormField[] => {
  if (!formMappings || formMappings.length === 0) return [];
  const byId = new Map<string, ResolvedDisplayFormField>();
  formMappings.forEach(mapping => {
    const m = mapping as { formId?: string; formFields?: FormFields[] };
    const fields = m.formId ? resolveDisplayFormFields(m.formId, m.formFields ?? []) : [];
    fields.forEach(field => {
      if (!byId.has(field.id)) byId.set(field.id, field);
    });
  });
  return Array.from(byId.values());
};

export const summarize = (labels: string[], noun: string): string => {
  if (labels.length === 0) return 'any';
  if (labels.length === 1) return labels[0] ?? 'any';
  const joined = labels.join(', ');
  if (labels.length === 2 && joined.length <= 24) return joined;
  return `${labels.length} ${noun}`;
};

const formatChipDate = (ms: number): string =>
  new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

const dateClause = (
  start: number | undefined,
  end: number | undefined,
): { operator: string; value: string } => {
  if (start !== undefined && end !== undefined) {
    return { operator: 'is between', value: `${formatChipDate(start)} — ${formatChipDate(end)}` };
  }
  if (start !== undefined) return { operator: 'is on or after', value: formatChipDate(start) };
  if (end !== undefined) return { operator: 'is on or before', value: formatChipDate(end) };
  return { operator: 'is', value: 'any' };
};

const capitalize = (value: string): string =>
  value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();

const dynamicValue = (
  field: ResolvedDisplayFormField,
  raw: string[] | { start?: number; end?: number } | undefined,
): { operator: string; value: string; mono?: boolean } => {
  if (!raw) return { operator: 'is', value: 'any' };
  if (!Array.isArray(raw)) return { ...dateClause(raw.start, raw.end), mono: true };
  if (field.fieldType === FormFieldType.STRING) {
    return { operator: 'contains', value: raw[0] ?? 'any', mono: true };
  }
  if (field.fieldType === FormFieldType.NUMBER) {
    return { operator: 'equals', value: raw[0] ?? 'any', mono: true };
  }
  if (field.fieldType === FormFieldType.BOOLEAN) {
    return {
      operator: 'is',
      value: raw[0] === 'true' ? 'Yes' : raw[0] === 'false' ? 'No' : (raw[0] ?? 'any'),
    };
  }
  const operator =
    field.fieldType === FormFieldType.MULTI_SELECT
      ? 'has any of'
      : raw.length > 1
        ? 'is any of'
        : 'is';
  return { operator, value: summarize(raw, 'values') };
};

export const getFilterFields = (
  filters: TicketFilters,
  ctx: FilterPickerContext,
  options: {
    hideAssigneeFilter: boolean;
    showFlagFilters: boolean;
    dynamicFields: ResolvedDisplayFormField[];
  },
): FilterFieldDef[] => {
  const hasBoardScope = (filters.boards?.length ?? 0) > 0;
  const fields = STATIC_FIELDS.filter(
    field =>
      (field.id !== 'assignee' || !options.hideAssigneeFilter) &&
      (field.id !== 'stages' || hasBoardScope) &&
      (field.id !== 'sourceChannels' || !ctx.channelId),
  );
  const dynamic: FilterFieldDef[] = hasBoardScope
    ? options.dynamicFields
        .filter(
          field =>
            field.fieldType !== FormFieldType.DOC && field.fieldType !== FormFieldType.TICKET,
        )
        .map(field => ({
          id: `dynamic-${field.id}`,
          label: field.fieldName,
          icon: getIconForFieldType(field.fieldType),
          noun: 'values',
          field,
        }))
    : [];
  const flags: FilterFieldDef[] = options.showFlagFilters
    ? [FLAG_FIELDS.assigned, FLAG_FIELDS.created, FLAG_FIELDS.overdue]
    : [FLAG_FIELDS.overdue];
  return [...fields, ...dynamic, ...flags];
};

export const buildFilterChips = (
  fields: FilterFieldDef[],
  filters: TicketFilters,
  names: FilterChipNames,
  showOverdueOnly: boolean,
): FilterChipDef[] => {
  const chips: FilterChipDef[] = [];
  const userLabel = (id: string): string =>
    id === UNASSIGNED_FILTER_VALUE ? 'No assignee' : (names.userNamesById.get(id) ?? 'Unknown');
  const push = (
    field: FilterFieldDef,
    clause: { operator: string; value: string; mono?: boolean } | null,
  ): void => {
    if (!clause) return;
    chips.push({ ...field, ...clause });
  };
  fields.forEach(field => {
    switch (field.id) {
      case 'assignee': {
        const raw = filters.assignee ?? [];
        if (raw.length === 0) return;
        const inverted = raw.includes(ASSIGNEE_INVERT_MARKER);
        const ids = raw.filter(v => v !== ASSIGNEE_INVERT_MARKER);
        const labels = ids.map(userLabel);
        const operator = inverted
          ? ids.length > 1
            ? 'is none of'
            : 'is not'
          : ids.length > 1
            ? 'is any of'
            : 'is';
        push(field, { operator, value: summarize(labels, field.noun) });
        return;
      }
      case 'priority': {
        const values = filters.priority ?? [];
        if (values.length === 0) return;
        push(field, {
          operator: values.length > 1 ? 'is any of' : 'is',
          value: summarize(values.map(capitalize), field.noun),
        });
        return;
      }
      case 'userGroups': {
        const values = filters.userGroups ?? [];
        if (values.length === 0) return;
        push(field, {
          operator: values.length > 1 ? 'is any of' : 'is',
          value: summarize(
            values.map(id => names.userGroupNamesById.get(id) ?? 'Unknown'),
            field.noun,
          ),
        });
        return;
      }
      case 'createdBy': {
        const values = filters.createdBy ?? [];
        if (values.length === 0) return;
        push(field, {
          operator: values.length > 1 ? 'is any of' : 'is',
          value: summarize(values.map(userLabel), field.noun),
        });
        return;
      }
      case 'roleAssignments': {
        const values = (filters.roleAssignments ?? []).filter(ra => ra.userIds.length > 0);
        if (values.length === 0) return;
        push(field, {
          operator: 'has',
          value: `${values.length} ${values.length === 1 ? 'role' : 'roles'}`,
        });
        return;
      }
      case 'dueDate': {
        if (filters.dueDateStart === undefined && filters.dueDateEnd === undefined) return;
        push(field, { ...dateClause(filters.dueDateStart, filters.dueDateEnd), mono: true });
        return;
      }
      case 'createdAt': {
        if (filters.createdDateStart === undefined && filters.createdDateEnd === undefined) return;
        push(field, {
          ...dateClause(filters.createdDateStart, filters.createdDateEnd),
          mono: true,
        });
        return;
      }
      case 'tags': {
        const values = filters.tags ?? [];
        if (values.length === 0) return;
        push(field, { operator: 'include any of', value: summarize(values, field.noun) });
        return;
      }
      case 'stages': {
        const values = filters.stages ?? [];
        if (values.length === 0) return;
        push(field, { operator: 'include any of', value: summarize(values, field.noun) });
        return;
      }
      case 'ticketTypes': {
        const values = filters.ticketTypes ?? [];
        if (values.length === 0) return;
        push(field, { operator: 'include any of', value: summarize(values, field.noun) });
        return;
      }
      case 'merchantIds': {
        const values = filters.merchantIds ?? [];
        if (values.length === 0) return;
        push(field, {
          operator: 'include any of',
          value: summarize(values, field.noun),
          mono: true,
        });
        return;
      }
      case 'sourceChannels': {
        const values = filters.sourceChannels ?? [];
        if (values.length === 0) return;
        push(field, {
          operator: 'include any of',
          value: summarize(
            values.map(id => `#${names.channelNamesById.get(id) ?? 'unknown'}`),
            field.noun,
          ),
        });
        return;
      }
      case 'overdue':
        if (!showOverdueOnly) return;
        push(field, { operator: 'is', value: 'Yes' });
        return;
      case 'assigned':
        if (!filters.assigned) return;
        push(field, { operator: 'is', value: 'Me' });
        return;
      case 'created':
        if (!filters.created) return;
        push(field, { operator: 'is', value: 'Me' });
        return;
      default: {
        if (!field.field) return;
        const raw = filters.dynamicFields?.[field.field.id];
        if (!raw) return;
        push(field, dynamicValue(field.field, raw));
      }
    }
  });
  return chips;
};

export const removeFilterField = (
  fieldId: string,
  filters: TicketFilters,
  dynamicFieldId?: string,
): TicketFilters => {
  const next = { ...filters };
  switch (fieldId) {
    case 'dueDate':
      delete next.dueDateStart;
      delete next.dueDateEnd;
      break;
    case 'createdAt':
      delete next.createdDateStart;
      delete next.createdDateEnd;
      break;
    case 'assigned':
      delete next.assigned;
      break;
    case 'created':
      delete next.created;
      break;
    default:
      if (dynamicFieldId) {
        if (next.dynamicFields) {
          const dynamicFields = { ...next.dynamicFields };
          delete dynamicFields[dynamicFieldId];
          if (Object.keys(dynamicFields).length === 0) delete next.dynamicFields;
          else next.dynamicFields = dynamicFields;
        }
      } else {
        delete next[fieldId as keyof TicketFilters];
      }
  }
  return next;
};

export const hasAnyFilterChip = (filters: TicketFilters, showOverdueOnly: boolean): boolean =>
  showOverdueOnly ||
  (Object.entries(filters) as [string, unknown][]).some(([key, value]) => {
    if (key === 'boards') return false;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'object' && value !== null) return Object.keys(value).length > 0;
    return value !== undefined && value !== null && value !== false;
  });
