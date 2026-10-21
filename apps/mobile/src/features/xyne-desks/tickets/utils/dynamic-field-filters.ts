import { FormFieldType } from '@xyne/shared';

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
};

const SCALAR_EQUALITY_FIELD_TYPES = new Set<FormFieldType>([
  FormFieldType.BOOLEAN,
  FormFieldType.NUMBER,
  FormFieldType.SINGLE_SELECT,
  FormFieldType.STRING,
]);

/**
 * Build Zero `dynamicFieldFilters` from UI entries (dashboard `toDynamicFieldQueryFilters`).
 * MULTI_SELECT is stored as an array, so V4 `actualFieldValue = value` cannot
 * match a picked option. Send `{ fieldId }` only and thin the page client-side.
 */
export function toDynamicFieldQueryFilters(
  entries: readonly DynamicFieldFilterEntry[],
): DynamicFieldQueryFilter[] | undefined {
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
}

export type DynamicFieldClientFilter = {
  fieldId: string;
  values: readonly string[];
};

export type TicketDynamicFieldValueLike = {
  fieldId?: string | null;
  actualFieldValue?: unknown;
};

export type TicketWithDynamicFieldValuesLike = {
  formEntityValues?: ReadonlyArray<TicketDynamicFieldValueLike | null> | null;
};

export function toDynamicFieldClientFilters(
  entries: readonly DynamicFieldFilterEntry[],
): DynamicFieldClientFilter[] {
  const filters: DynamicFieldClientFilter[] = [];
  for (const entry of entries) {
    if (entry.fieldType !== FormFieldType.MULTI_SELECT) continue;
    if (!Array.isArray(entry.value) || entry.value.length === 0) continue;
    filters.push({ fieldId: entry.fieldId, values: [...entry.value] });
  }
  return filters;
}

export function parseActualFieldValues(raw: unknown): string[] {
  // x != null              // skips both null and undefined
  // x !== undefined        // skips only undefined; null still passes
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'number' || typeof raw === 'boolean') return [String(raw)];
  if (typeof raw !== 'string') return [String(raw)];
  const trimmed = raw.trim();
  if (!trimmed) return [];
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed.map(String);
    if (parsed != null && typeof parsed !== 'object') return [String(parsed)];
  } catch {
    // stored as a plain enum string
  }
  return [trimmed];
}

export function ticketMatchesDynamicFieldClientFilters(
  row: TicketWithDynamicFieldValuesLike,
  filters: readonly DynamicFieldClientFilter[],
): boolean {
  if (filters.length === 0) return true;
  const valuesByField = new Map<string, string[]>();
  for (const mapping of row.formEntityValues ?? []) {
    const fieldId = mapping?.fieldId?.trim();
    if (!fieldId) continue;
    const existing = valuesByField.get(fieldId) ?? [];
    existing.push(...parseActualFieldValues(mapping?.actualFieldValue));
    valuesByField.set(fieldId, existing);
  }

  return filters.every(filter => {
    const wanted = new Set(filter.values.map(String));
    const actual = valuesByField.get(filter.fieldId) ?? [];
    return actual.some(value => wanted.has(value));
  });
}

export function filterSupportTicketsByDynamicFieldClientFilters<
  T extends TicketWithDynamicFieldValuesLike,
>(rows: readonly T[], filters: readonly DynamicFieldClientFilter[]): T[] {
  if (filters.length === 0) return [...rows];
  return rows.filter(row => ticketMatchesDynamicFieldClientFilters(row, filters));
}

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
