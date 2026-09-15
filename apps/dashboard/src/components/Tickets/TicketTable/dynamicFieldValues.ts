import { FormFieldType } from '@xyne/shared';

export const isMultiValueField = (fieldType: FormFieldType): boolean =>
  fieldType === FormFieldType.MULTI_SELECT || fieldType === FormFieldType.USER;

export const stringifyValue = (raw: unknown): string => {
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  return JSON.stringify(raw) ?? '';
};

const toTrimmedStrings = (values: readonly unknown[]): string[] =>
  values
    .map(stringifyValue)
    .map(value => value.trim())
    .filter(value => value.length > 0);

/** Returns null for anything that isn't a JSON array, including unparseable input. */
const parseJsonArray = (raw: string): unknown[] | null => {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

/** Normalizes any stored/edited value to the `string[]` the mutators accept. */
export const toStringArray = (raw: unknown): string[] => {
  if (raw === null || raw === undefined || raw === '') return [];
  if (Array.isArray(raw)) return toTrimmedStrings(raw);
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[')) {
      const parsed = parseJsonArray(trimmed);
      if (parsed) return toTrimmedStrings(parsed);
    }
    return [trimmed];
  }
  if (typeof raw === 'number' || typeof raw === 'boolean') return [String(raw)];
  return [];
};

/** The shape the grid holds for this field type: array for multi-value, string otherwise. */
export const toGridValue = (fieldType: FormFieldType, values: string[]): string | string[] =>
  isMultiValueField(fieldType) ? values : (values[0] ?? '');

export const sameValues = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);

export const dynamicValuesEqual = (a: unknown, b: unknown): boolean =>
  sameValues(toStringArray(a), toStringArray(b));
