import { FormFieldType } from '@xyne/shared';

export type DynamicFieldFilterValue = string[] | { start?: number; end?: number };

export interface DynamicFieldFilterEntry {
  fieldId: string;
  fieldType?: FormFieldType;
  value: DynamicFieldFilterValue;
}

export interface DynamicFieldQueryFilter {
  fieldId: string;
  values?: (string | number | boolean)[];
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
  actualFieldValue: unknown,
): boolean => {
  if (Array.isArray(filterValue)) {
    if (fieldType === FormFieldType.MULTI_SELECT) {
      const ticketValues = (actualFieldValue as string[]) || [];
      return ticketValues.some(v => filterValue.includes(v));
    }
    if (fieldType === FormFieldType.STRING) {
      let ticketValue = '';
      if (typeof actualFieldValue === 'string') {
        ticketValue = actualFieldValue;
      } else if (typeof actualFieldValue === 'number' || typeof actualFieldValue === 'boolean') {
        ticketValue = String(actualFieldValue);
      }
      ticketValue = ticketValue.toLowerCase();
      const searchTerm = (filterValue[0] || '').toLowerCase();
      return ticketValue.includes(searchTerm);
    }
    if (fieldType === FormFieldType.NUMBER) {
      const ticketValue =
        typeof actualFieldValue === 'number' || typeof actualFieldValue === 'string'
          ? String(actualFieldValue)
          : '';
      return ticketValue === String(filterValue[0] || '');
    }
    if (fieldType === FormFieldType.USER) {
      const userIds = Array.isArray(actualFieldValue) ? actualFieldValue : [];
      return userIds.some(userId => typeof userId === 'string' && filterValue.includes(userId));
    }
    const ticketValue =
      typeof actualFieldValue === 'string' ||
      typeof actualFieldValue === 'number' ||
      typeof actualFieldValue === 'boolean'
        ? String(actualFieldValue)
        : '';
    return filterValue.includes(ticketValue);
  }

  if (typeof filterValue === 'object' && ('start' in filterValue || 'end' in filterValue)) {
    const ticketDate = getTimestampValue(actualFieldValue);
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

const SCALAR_EQUALITY_FIELD_TYPES = new Set<FormFieldType>([
  FormFieldType.SINGLE_SELECT,
  FormFieldType.BOOLEAN,
  FormFieldType.NUMBER,
]);

export const toDynamicFieldQueryFilters = (
  entries: readonly DynamicFieldFilterEntry[],
): DynamicFieldQueryFilter[] | undefined => {
  if (entries.length === 0) return undefined;
  return entries.map(entry => {
    if (
      entry.fieldType !== undefined &&
      SCALAR_EQUALITY_FIELD_TYPES.has(entry.fieldType) &&
      Array.isArray(entry.value) &&
      entry.value.length > 0
    ) {
      const values: (string | number | boolean)[] = [];
      for (const raw of entry.value) {
        values.push(raw);
        if (entry.fieldType === FormFieldType.NUMBER) {
          const numeric = Number(raw);
          if (Number.isFinite(numeric)) values.push(numeric);
        } else if (entry.fieldType === FormFieldType.BOOLEAN) {
          if (raw === 'true') values.push(true);
          else if (raw === 'false') values.push(false);
        }
      }
      return { fieldId: entry.fieldId, values };
    }
    return { fieldId: entry.fieldId };
  });
};

export interface FormEntityValueLike {
  fieldId: string;
  actualFieldValue?: unknown;
}

export const ticketMatchesDynamicFieldEntries = (
  formEntityValues: readonly FormEntityValueLike[] | null | undefined,
  entries: readonly DynamicFieldFilterEntry[],
): boolean => {
  for (const entry of entries) {
    if (entry.fieldType === undefined) continue;
    const fieldValue = formEntityValues?.find(v => v.fieldId === entry.fieldId);
    if (!fieldValue) return false;
    if (!matchesDynamicFieldValue(entry.fieldType, entry.value, fieldValue.actualFieldValue)) {
      return false;
    }
  }
  return true;
};

export interface VespaDynamicFieldFilters {
  /** `fieldId::value` tokens. */
  dynamicFieldValues?: string[];
  dynamicFieldDateRanges?: Record<string, { start?: number; end?: number }>;
}

/**
 * The dynamic-field filters pushed into Vespa. Vespa matches a form field with
 * `sameElement(fieldId contains X and fieldValue contains V)` — an exact whole-value
 * comparison — and must never be stricter than the app, or it drops rows Zero would keep.
 *
 * SINGLE_SELECT / BOOLEAN / NUMBER compare exactly on both sides. MULTI_SELECT / USER are
 * equivalent too: `buildFormFields` stores one struct element per selected value, so an OR
 * over sameElement is the any-of match `matchesDynamicFieldValue` performs.
 *
 * STRING is pushed as Kanban already does, but `matchesDynamicFieldValue` matches substrings
 * client-side, so the filter is exact with a search term active and substring without one.
 * That asymmetry is pre-existing and shared with the Kanban board, so it is left alone.
 */
export const toVespaDynamicFieldFilters = (
  entries: readonly DynamicFieldFilterEntry[],
): VespaDynamicFieldFilters => {
  const dynamicFieldValues: string[] = [];
  const dynamicFieldDateRanges: Record<string, { start?: number; end?: number }> = {};

  for (const entry of entries) {
    if (Array.isArray(entry.value)) {
      if (entry.fieldType === undefined) continue;
      for (const raw of entry.value) {
        const value = String(raw).trim();
        if (value) dynamicFieldValues.push(`${entry.fieldId}::${value}`);
      }
      continue;
    }

    const { start, end } = entry.value;
    if (start !== undefined || end !== undefined) {
      dynamicFieldDateRanges[entry.fieldId] = {
        ...(start !== undefined ? { start } : {}),
        ...(end !== undefined ? { end } : {}),
      };
    }
  }

  return {
    ...(dynamicFieldValues.length > 0 ? { dynamicFieldValues } : {}),
    ...(Object.keys(dynamicFieldDateRanges).length > 0 ? { dynamicFieldDateRanges } : {}),
  };
};
