import { FormFieldType, type TypedFormEntityValueRow } from '@xyne/shared';

export type DynamicFieldFilterValue = string[] | { start?: number; end?: number };

export interface DynamicFieldFilterEntry {
  fieldId: string;
  fieldType?: FormFieldType;
  value: DynamicFieldFilterValue;
}

export interface DynamicFieldQueryFilter {
  fieldId: string;
  values?: (string | number | boolean)[];
  // The query matches on this type's value columns (textHash / textValue, numberValue, items, ...).
  fieldType: FormFieldType;
  dateRange?: { start?: number; end?: number };
}

export const getTimestampValue = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    const numericValue = Number(trimmed);
    return Number.isFinite(numericValue) ? numericValue : null;
  }

  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
};

export const matchesDynamicFieldValue = (
  fieldType: FormFieldType,
  filterValue: DynamicFieldFilterValue,
  rawValue: unknown,
): boolean => {
  if (Array.isArray(filterValue)) {
    if (fieldType === FormFieldType.MULTI_SELECT) {
      const ticketValues = (rawValue as string[]) || [];
      return ticketValues.some(v => filterValue.includes(v));
    }
    if (fieldType === FormFieldType.STRING) {
      let ticketValue = '';
      if (typeof rawValue === 'string') {
        ticketValue = rawValue;
      } else if (typeof rawValue === 'number' || typeof rawValue === 'boolean') {
        ticketValue = String(rawValue);
      }
      // Whole-value match against any selected value, case-insensitive — the rule the column
      // itself is fetched with. `formFields.fieldValue` is an uncased Vespa attribute, so its
      // token match folds case and compares the entire value; a substring rule here (what a
      // lone value used to get, back when every value was typed) counted tickets the column
      // could never list. Mirrored by kanbanCountsService.matchesDynamicFilter and by
      // matchesRequest in useKanbanCounts, so a filter counts the same tickets it shows.
      const needle = ticketValue.toLowerCase();
      return filterValue.some(value => value.toLowerCase() === needle);
    }
    if (fieldType === FormFieldType.NUMBER) {
      const ticketValue =
        typeof rawValue === 'number' || typeof rawValue === 'string' ? String(rawValue) : '';
      if (filterValue.length > 1) return filterValue.some(value => String(value) === ticketValue);
      return ticketValue === String(filterValue[0] || '');
    }
    if (fieldType === FormFieldType.USER) {
      const userIds = Array.isArray(rawValue) ? rawValue : [];
      return userIds.some(userId => typeof userId === 'string' && filterValue.includes(userId));
    }
    const ticketValue =
      typeof rawValue === 'string' || typeof rawValue === 'number' || typeof rawValue === 'boolean'
        ? String(rawValue)
        : '';
    return filterValue.includes(ticketValue);
  }

  if (typeof filterValue === 'object' && ('start' in filterValue || 'end' in filterValue)) {
    const ticketDate = getTimestampValue(rawValue);
    if (ticketDate === null) return false;
    if (filterValue.start !== undefined && ticketDate < filterValue.start) return false;
    if (filterValue.end !== undefined && ticketDate > filterValue.end) return false;
  }

  return true;
};

export const buildDynamicFieldFilterEntries = (
  dynamicFields: Record<string, DynamicFieldFilterValue> | undefined,
  fieldTypesById: ReadonlyMap<string, FormFieldType>,
): DynamicFieldFilterEntry[] => {
  if (!dynamicFields) return [];
  return Object.entries(dynamicFields).flatMap(([fieldId, value]) => {
    const isEmpty = Array.isArray(value)
      ? value.length === 0
      : value.start === undefined && value.end === undefined;
    if (isEmpty) return [];
    const fieldType = fieldTypesById.get(fieldId);
    return [{ fieldId, ...(fieldType !== undefined ? { fieldType } : {}), value }];
  });
};

export const toDynamicFieldQueryFilters = (
  entries: readonly DynamicFieldFilterEntry[],
): DynamicFieldQueryFilter[] | undefined => {
  // A field whose type isn't known (definitions still loading, or the field is gone) can't be
  // matched, so it is left out.
  const filters = entries.flatMap((entry): DynamicFieldQueryFilter[] => {
    if (entry.fieldType === undefined) return [];
    if (Array.isArray(entry.value)) {
      return [{ fieldId: entry.fieldId, fieldType: entry.fieldType, values: [...entry.value] }];
    }
    const { start, end } = entry.value;
    return [
      {
        fieldId: entry.fieldId,
        fieldType: entry.fieldType,
        dateRange: { ...(start !== undefined && { start }), ...(end !== undefined && { end }) },
      },
    ];
  });
  return filters.length > 0 ? filters : undefined;
};

export type FormEntityValueLike = TypedFormEntityValueRow & { fieldId: string };
