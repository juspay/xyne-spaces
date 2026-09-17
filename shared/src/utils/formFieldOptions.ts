export type FieldEnumOption = { id: string; value: string };

const generateOptionId = (): string => crypto.randomUUID();

// Tolerant fieldEnum parser: normalizes {id,value}[], legacy string[], and a legacy
// JSON-stringified-string shape, all to {id,value}[].
export const parseFieldOptions = (fieldEnum: unknown): FieldEnumOption[] => {
  let value = fieldEnum;

  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(value)) return [];

  return value
    .map((entry): FieldEnumOption | undefined => {
      if (typeof entry === 'string') {
        const trimmed = entry.trim();
        return trimmed ? { id: generateOptionId(), value: trimmed } : undefined;
      }
      if (
        entry &&
        typeof entry === 'object' &&
        typeof (entry as { id?: unknown }).id === 'string' &&
        typeof (entry as { value?: unknown }).value === 'string'
      ) {
        const trimmed = (entry as { value: string }).value.trim();
        return trimmed ? { id: (entry as { id: string }).id, value: trimmed } : undefined;
      }
      return undefined;
    })
    .filter((option): option is FieldEnumOption => option !== undefined);
};

// Serializes the canonical {id,value}[] shape for the fieldOptions TEXT column.
// Null-safe; an empty/absent list persists as null rather than "[]".
export const serializeFieldOptions = (
  value: readonly FieldEnumOption[] | null | undefined,
): string | null => {
  if (!value || value.length === 0) return null;
  return JSON.stringify(value);
};

export const parseFieldOptionValues = (fieldEnum: unknown): string[] =>
  parseFieldOptions(fieldEnum).map(option => option.value);

export const toSelectOptions = (
  fieldEnum: unknown,
): Array<{ label: string; value: string }> =>
  parseFieldOptions(fieldEnum).map(option => ({ label: option.value, value: option.value }));

// Finds which field owns the option with this id — scans every field's fieldEnum, so
// branching only needs to store the option id, not a separate parent field id.
export const resolveParentOption = <TField extends { fieldEnum?: unknown }>(
  allFields: readonly TField[],
  optionId: string,
): { parentField: TField; option: FieldEnumOption } | undefined => {
  for (const field of allFields) {
    const match = parseFieldOptions(field.fieldEnum).find(option => option.id === optionId);
    if (match) return { parentField: field, option: match };
  }
  return undefined;
};
