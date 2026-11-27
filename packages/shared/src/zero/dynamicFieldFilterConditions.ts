import { FormFieldType } from './types.js';

export type TypedDynamicFieldFilter = {
  fieldType: string;
  values?: ReadonlyArray<string | number | boolean>;
  dateRange?: { start?: number; end?: number };
};

const uniqueStrings = (values: ReadonlyArray<string | number | boolean>): string[] =>
  [...new Set(values.map(value => String(value).trim()).filter(Boolean))];

/**
 * Narrows a form_entity_values subquery (already scoped to one field) to the values a typed
 * filter selects, using the typed columns. STRING matches on textHash, which needs the
 * backend's key: callers without it pass `hashText = null` and the STRING filter only
 * requires the field to be set, leaving the exact match to the caller.
 */
export const applyTypedDynamicFieldFilter = (
  fev: any,
  filter: TypedDynamicFieldFilter,
  hashText: ((text: string) => string) | null,
): any => {
  const values = filter.values ?? [];
  switch (filter.fieldType) {
    case FormFieldType.STRING: {
      const texts = uniqueStrings(values);
      if (!hashText || texts.length === 0) return fev;
      return fev.where('textHash', 'IN', [...new Set(texts.map(hashText))]);
    }
    case FormFieldType.NUMBER: {
      const numbers = [...new Set(values.map(Number).filter(Number.isFinite))];
      return numbers.length > 0 ? fev.where('numberValue', 'IN', numbers) : fev;
    }
    case FormFieldType.BOOLEAN: {
      const booleans = [
        ...new Set(
          values.flatMap(value => {
            const normalized = String(value).trim().toLowerCase();
            return normalized === 'true' ? [true] : normalized === 'false' ? [false] : [];
          }),
        ),
      ];
      if (booleans.length === 0) return fev;
      return fev.where(({ or, cmp }: any) => or(...booleans.map(value => cmp('boolValue', value))));
    }
    case FormFieldType.SINGLE_SELECT:
    case FormFieldType.TICKET:
    case FormFieldType.DOC: {
      const options = uniqueStrings(values);
      return options.length > 0 ? fev.where('plainValue', 'IN', options) : fev;
    }
    case FormFieldType.MULTI_SELECT:
    case FormFieldType.USER: {
      const items = uniqueStrings(values);
      return items.length > 0 ? fev.whereExists('items', (item: any) => item.where('item', 'IN', items)) : fev;
    }
    case FormFieldType.DATE: {
      let query = fev;
      if (filter.dateRange?.start !== undefined) query = query.where('dateValue', '>=', filter.dateRange.start);
      if (filter.dateRange?.end !== undefined) query = query.where('dateValue', '<=', filter.dateRange.end);
      return query;
    }
    default:
      return fev;
  }
};
