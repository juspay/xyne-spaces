import { FormFieldType, type TypedFormEntityValueRow } from '@xyne/shared';

/** UI value for one dynamic field filter (dashboard TicketFilters.dynamicFields). */
export type DynamicFieldFilterValue = string[] | { start?: number; end?: number };

export type DynamicFieldFilterEntry = {
  fieldId: string;
  fieldType?: FormFieldType;
  value: DynamicFieldFilterValue;
};

/** Arg shape for supportTicketsPageV4 `dynamicFieldFilters`. */
export type DynamicFieldQueryFilter = {
  fieldId: string;
  values?: (string | number | boolean)[];
  // The query matches on this type's value columns (textHash / textValue, numberValue, items, ...).
  fieldType: FormFieldType;
  dateRange?: { start?: number; end?: number };
};

/**
 * Build Zero `dynamicFieldFilters` from UI entries (same as the dashboard's
 * `toDynamicFieldQueryFilters`); the query matches each one. A field whose type isn't known
 * (definitions still loading, or the field is gone) can't be matched, so it is left out.
 */
export function toDynamicFieldQueryFilters(
  entries: readonly DynamicFieldFilterEntry[],
): DynamicFieldQueryFilter[] | undefined {
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
        dateRange: { ...(start != null ? { start } : {}), ...(end != null ? { end } : {}) },
      },
    ];
  });
  return filters.length > 0 ? filters : undefined;
}

export type TicketDynamicFieldValueLike = TypedFormEntityValueRow & {
  fieldId?: string | null;
};

export type TicketWithDynamicFieldValuesLike = {
  formEntityValues?: ReadonlyArray<TicketDynamicFieldValueLike | null> | null;
};

export function buildDynamicFieldFilterEntries(
  dynamicFields: Record<string, DynamicFieldFilterValue> | undefined,
  fieldTypesById: ReadonlyMap<string, FormFieldType>,
): DynamicFieldFilterEntry[] {
  if (!dynamicFields) return [];
  const entries: DynamicFieldFilterEntry[] = [];
  for (const [fieldId, value] of Object.entries(dynamicFields)) {
    if (Array.isArray(value) && value.length === 0) continue;
    if (!Array.isArray(value) && value.start == null && value.end == null) {
      continue;
    }
    const fieldType = fieldTypesById.get(fieldId);
    entries.push({
      fieldId,
      ...(fieldType !== undefined ? { fieldType } : {}),
      value,
    });
  }
  return entries;
}
