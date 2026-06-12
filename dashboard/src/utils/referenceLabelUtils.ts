import { detectFieldType } from './queryBuilderFieldMappings';

export type ReferenceLabels = Record<string, Record<string, string>>;

export function isUserReferenceField(fieldName: string): boolean {
  return detectFieldType(fieldName) === 'user';
}

export function formatUnknownValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

export function formatReferenceDisplayValue(
  fieldName: string,
  rawValue: unknown,
  referenceLabels?: ReferenceLabels,
): { display: string; tooltip?: string } {
  if (rawValue === null || rawValue === undefined) {
    return { display: '' };
  }

  if (Array.isArray(rawValue)) {
    const ids = rawValue.filter(
      (item): item is string => typeof item === 'string' && item.length > 0,
    );
    if (ids.length === 0) {
      return { display: '' };
    }
    const display = ids
      .map(id => referenceLabels?.[fieldName]?.[id] ?? id)
      .slice(0, 3)
      .join(', ');
    return { display, tooltip: ids.slice(0, 3).join(', ') };
  }

  if (typeof rawValue !== 'string') {
    return { display: formatUnknownValue(rawValue) };
  }

  const label = referenceLabels?.[fieldName]?.[rawValue];
  if (label && label !== rawValue) {
    return { display: label, tooltip: rawValue };
  }

  return { display: rawValue };
}

export function collectReferenceIdsFromRows(
  rows: Record<string, unknown>[],
  fieldNames: string[],
): Record<string, Set<string>> {
  const idsByField: Record<string, Set<string>> = {};

  for (const fieldName of fieldNames) {
    idsByField[fieldName] = new Set<string>();
  }

  for (const row of rows) {
    for (const fieldName of fieldNames) {
      const value = row[fieldName];
      if (value === null || value === undefined) continue;

      if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === 'string' && item.length > 0) {
            idsByField[fieldName]?.add(item);
          }
        }
        continue;
      }

      if (typeof value === 'string' && value.length > 0) {
        idsByField[fieldName]?.add(value);
      }
    }
  }

  return idsByField;
}
